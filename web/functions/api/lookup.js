import pg from "pg";

const { Client } = pg;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

/**
 * Haversine 大圓距離計算 (Great-Circle Distance, 單位 km)
 * 嚴禁寫死假距離，完全由起訖機場真實經緯度計算
 */
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088; // 地球平均半徑 (km)
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round(R * c));
}

/**
 * 當 icao_routes_cache 尚無該航線時，以 Haversine GCD 大圓距離推算試算值 (GCD_FALLBACK)
 * 並含 ICAO 航路修正距離 (+50km ~ +125km) 與艙等權重
 */
function computeGcdFallback(gcdKm, transportMode, cabinClass) {
  // ICAO 航路繞行修正 (Short/Medium/Long Haul Correction Factor)
  let correctedKm = gcdKm + 50;
  if (gcdKm >= 550 && gcdKm <= 5500) {
    correctedKm = gcdKm + 100;
  } else if (gcdKm > 5500) {
    correctedKm = gcdKm + 125;
  }

  if (transportMode === "CARGO") {
    // 航空貨運每延噸公里 (t-km) 平均碳排係數約 0.56 kg CO2 / t-km => 每公斤每公里 0.00056 kg CO2
    const unitCo2PerKg = Number((correctedKm * 0.00056).toFixed(4));
    // 以 3.16 kg CO2 / kg Jet Fuel 反推單趟參考燃油消耗
    const estAircraftFuelKg = Math.round(correctedKm * 6.8);
    return {
      distance_km: correctedKm,
      gcd_raw_km: gcdKm,
      fuel_burn_kg: estAircraftFuelKg,
      unit_co2_kg: unitCo2PerKg,
      icao_method_version: "Haversine GCD Fallback (Awaiting ICAO Official Capture)",
    };
  }

  // PASSENGER 差旅模式：依航程距離與艙等權重推算每位旅客單程碳排 (kg CO2 / pax)
  const basePerPaxKm = gcdKm < 1500 ? 0.115 : gcdKm <= 4000 ? 0.095 : 0.088;
  const cabinMultipliers = {
    ECONOMY: 1.0,
    PREMIUM_ECONOMY: 1.3,
    BUSINESS: 1.8,
    FIRST: 2.4,
  };
  const mult = cabinMultipliers[cabinClass] || 1.0;
  const unitCo2PerPax = Number((correctedKm * basePerPaxKm * mult).toFixed(4));
  const estAircraftFuelKg = Math.round(correctedKm * 5.2);

  return {
    distance_km: correctedKm,
    gcd_raw_km: gcdKm,
    fuel_burn_kg: estAircraftFuelKg,
    unit_co2_kg: unitCo2PerPax,
    icao_method_version: "Haversine GCD Fallback (Awaiting ICAO Official Capture)",
  };
}

/**
 * 正規化輸入參數
 */
function normalizeQueryItem(raw, index = 0) {
  const originInput = String(raw.origin || raw.origin_code || "").trim().toUpperCase();
  const destInput = String(raw.dest || raw.dest_code || "").trim().toUpperCase();
  const rawMode = String(raw.transport_mode || "CARGO").trim().toUpperCase();
  const transportMode = rawMode === "PASSENGER" ? "PASSENGER" : "CARGO";

  let cabinClass = String(raw.cabin_class || "").trim().toUpperCase();
  if (transportMode === "CARGO") {
    cabinClass = "CARGO_1KG";
  } else if (!["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"].includes(cabinClass)) {
    cabinClass = "ECONOMY";
  }

  const weightKg = Math.max(0, Number(raw.weight_kg ?? 1000) || 1);
  const passengers = Math.max(1, parseInt(raw.passengers ?? 1, 10) || 1);

  return {
    row_index: raw.row_index ?? index + 1,
    label: raw.label || "",
    origin_input: originInput,
    dest_input: destInput,
    transport_mode: transportMode,
    cabin_class: cabinClass,
    weight_kg: weightKg,
    passengers: passengers,
  };
}

/**
 * 核心查詢與 GCD 試算 + 自動排隊補圖
 */
async function processItems(client, rawItems) {
  const items = rawItems.map((it, idx) => normalizeQueryItem(it, idx));

  // 收集所有出現過的機場代碼 (3 碼 IATA 或 4 碼 ICAO)
  const codeSet = new Set();
  for (const it of items) {
    if (it.origin_input) codeSet.add(it.origin_input);
    if (it.dest_input) codeSet.add(it.dest_input);
  }

  const codes = Array.from(codeSet);
  const airportByCode = new Map();

  if (codes.length > 0) {
    const airportRes = await client.query(
      `
      SELECT
        icao_code,
        iata_code,
        name_zh,
        name_en,
        city_zh,
        country_code,
        latitude::FLOAT AS latitude,
        longitude::FLOAT AS longitude,
        is_major_hub
      FROM airports
      WHERE UPPER(icao_code) = ANY($1::TEXT[])
         OR UPPER(iata_code) = ANY($1::TEXT[]);
      `,
      [codes]
    );

    for (const row of airportRes.rows) {
      airportByCode.set(row.icao_code.toUpperCase(), row);
      if (row.iata_code) {
        airportByCode.set(row.iata_code.toUpperCase(), row);
      }
    }
  }

  const results = [];

  for (const item of items) {
    const originAirport = airportByCode.get(item.origin_input);
    const destAirport = airportByCode.get(item.dest_input);

    if (!originAirport || !destAirport) {
      const missing = [];
      if (!originAirport) missing.push(`起飛機場「${item.origin_input || "空白"}」`);
      if (!destAirport) missing.push(`目的機場「${item.dest_input || "空白"}」`);
      results.push({
        row_index: item.row_index,
        ok: false,
        error: `機場字典查無代碼：${missing.join("、")}。請確認輸入 3 碼 IATA (如 TPE) 或 4 碼 ICAO (如 RCTP)。`,
        input: item,
      });
      continue;
    }

    if (originAirport.icao_code === destAirport.icao_code) {
      results.push({
        row_index: item.row_index,
        ok: false,
        error: `起訖機場不可相同 (${originAirport.iata_code || originAirport.icao_code})`,
        input: item,
      });
      continue;
    }

    // 1. 優先查詢 icao_routes_cache (精準比對 origin_icao, dest_icao, transport_mode, cabin_class)
    let cacheRes = await client.query(
      `
      SELECT
        id,
        origin_icao,
        dest_icao,
        transport_mode,
        cabin_class,
        distance_km,
        fuel_burn_kg,
        co2_kg::FLOAT AS co2_kg,
        data_source,
        icao_method_version,
        r2_image_url,
        captured_at
      FROM icao_routes_cache
      WHERE origin_icao = $1
        AND dest_icao = $2
        AND transport_mode = $3
        AND cabin_class = $4
      LIMIT 1;
      `,
      [
        originAirport.icao_code,
        destAirport.icao_code,
        item.transport_mode,
        item.cabin_class,
      ]
    );

    // 若差旅模式指定非 ECONOMY 艙等但快取僅有 ECONOMY，或 CARGO 查同 mode 紀錄
    let cabinAdjustedMultiplier = 1.0;
    if (cacheRes.rows.length === 0 && item.transport_mode === "PASSENGER") {
      const fallbackCabinRes = await client.query(
        `
        SELECT
          id,
          origin_icao,
          dest_icao,
          transport_mode,
          cabin_class,
          distance_km,
          fuel_burn_kg,
          co2_kg::FLOAT AS co2_kg,
          data_source,
          icao_method_version,
          r2_image_url,
          captured_at
        FROM icao_routes_cache
        WHERE origin_icao = $1
          AND dest_icao = $2
          AND transport_mode = 'PASSENGER'
        ORDER BY (cabin_class = 'ECONOMY') DESC, captured_at DESC
        LIMIT 1;
        `,
        [originAirport.icao_code, destAirport.icao_code]
      );
      if (fallbackCabinRes.rows.length > 0) {
        cacheRes = fallbackCabinRes;
        const multMap = { ECONOMY: 1.0, PREMIUM_ECONOMY: 1.3, BUSINESS: 1.8, FIRST: 2.4 };
        cabinAdjustedMultiplier = multMap[item.cabin_class] || 1.0;
      }
    }

    const quantity = item.transport_mode === "CARGO" ? item.weight_kg : item.passengers;
    const quantityUnit = item.transport_mode === "CARGO" ? "KG" : "PAX";

    if (cacheRes.rows.length > 0) {
      const cached = cacheRes.rows[0];
      const unitCo2Kg = Number((Number(cached.co2_kg) * cabinAdjustedMultiplier).toFixed(4));
      const totalCo2Kg = Number((unitCo2Kg * quantity).toFixed(4));
      const totalCo2Tonnes = Number((totalCo2Kg / 1000).toFixed(6));

      results.push({
        row_index: item.row_index,
        ok: true,
        is_official: cached.data_source === "ICAO_OFFICIAL",
        origin: originAirport,
        dest: destAirport,
        transport_mode: item.transport_mode,
        cabin_class: item.cabin_class,
        quantity,
        quantity_unit: quantityUnit,
        weight_kg: item.transport_mode === "CARGO" ? item.weight_kg : null,
        passengers: item.transport_mode === "PASSENGER" ? item.passengers : null,
        distance_km: Number(cached.distance_km),
        fuel_burn_kg: cached.fuel_burn_kg !== null ? Number(cached.fuel_burn_kg) : null,
        unit_co2_kg: unitCo2Kg,
        total_co2_kg: totalCo2Kg,
        total_co2_tonnes: totalCo2Tonnes,
        data_source: cached.data_source,
        icao_method_version: cached.icao_method_version || "Cargo v2.0 / Pax v13.1",
        r2_image_url: cached.r2_image_url || null,
        captured_at: cached.captured_at,
        queued_for_scrape: false,
        queue_status: "CACHED",
      });
    } else {
      // 2. 快取無資料：計算真實經緯度 Haversine 大圓距離 (GCD_FALLBACK) 並自動寫入 scrape_queue
      const gcdKm = calculateHaversineKm(
        originAirport.latitude,
        originAirport.longitude,
        destAirport.latitude,
        destAirport.longitude
      );
      const fallback = computeGcdFallback(gcdKm, item.transport_mode, item.cabin_class);

      // 自動寫入 scrape_queue 排隊補抓官方截圖
      const queueUpsertRes = await client.query(
        `
        INSERT INTO scrape_queue (origin_icao, dest_icao, transport_mode, status, request_count, updated_at)
        VALUES ($1, $2, $3, 'PENDING', 1, NOW())
        ON CONFLICT (origin_icao, dest_icao, transport_mode)
        DO UPDATE SET
          request_count = scrape_queue.request_count + 1,
          status = CASE
            WHEN scrape_queue.status = 'FAILED' THEN 'PENDING'
            ELSE scrape_queue.status
          END,
          updated_at = NOW()
        RETURNING id, status, request_count;
        `,
        [originAirport.icao_code, destAirport.icao_code, item.transport_mode]
      );

      const queueRow = queueUpsertRes.rows[0] || {};
      const totalCo2Kg = Number((fallback.unit_co2_kg * quantity).toFixed(4));
      const totalCo2Tonnes = Number((totalCo2Kg / 1000).toFixed(6));

      results.push({
        row_index: item.row_index,
        ok: true,
        is_official: false,
        origin: originAirport,
        dest: destAirport,
        transport_mode: item.transport_mode,
        cabin_class: item.cabin_class,
        quantity,
        quantity_unit: quantityUnit,
        weight_kg: item.transport_mode === "CARGO" ? item.weight_kg : null,
        passengers: item.transport_mode === "PASSENGER" ? item.passengers : null,
        distance_km: fallback.distance_km,
        gcd_raw_km: fallback.gcd_raw_km,
        fuel_burn_kg: fallback.fuel_burn_kg,
        unit_co2_kg: fallback.unit_co2_kg,
        total_co2_kg: totalCo2Kg,
        total_co2_tonnes: totalCo2Tonnes,
        data_source: "GCD_FALLBACK",
        icao_method_version: fallback.icao_method_version,
        r2_image_url: null,
        captured_at: null,
        queued_for_scrape: true,
        queue_id: queueRow.id || null,
        queue_status: queueRow.status || "PENDING",
        queue_request_count: queueRow.request_count || 1,
      });
    }
  }

  return results;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const dbUrl = env.NEON_DATABASE_URL;

  if (!dbUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: "尚未設定環境變數 NEON_DATABASE_URL" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const url = new URL(request.url);
  const origin = url.searchParams.get("origin") || "";
  const dest = url.searchParams.get("dest") || "";

  if (!origin || !dest) {
    return new Response(
      JSON.stringify({ ok: false, error: "請提供 origin 與 dest 機場代碼（3 碼 IATA 或 4 碼 ICAO）" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const singleItem = {
    origin,
    dest,
    transport_mode: url.searchParams.get("transport_mode") || "CARGO",
    cabin_class: url.searchParams.get("cabin_class") || "",
    weight_kg: url.searchParams.get("weight_kg") || "1000",
    passengers: url.searchParams.get("passengers") || "1",
  };

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const results = await processItems(client, [singleItem]);
    const first = results[0];

    return new Response(
      JSON.stringify({
        ok: first.ok,
        result: first,
        results,
      }),
      { status: first.ok ? 200 : 400, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  } finally {
    try {
      await client.end();
    } catch (_) {
      // ignore close error
    }
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const dbUrl = env.NEON_DATABASE_URL;

  if (!dbUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: "尚未設定環境變數 NEON_DATABASE_URL" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(
      JSON.stringify({ ok: false, error: "無效的 JSON 請求格式" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const rawItems = Array.isArray(body.items) ? body.items : [body];
  if (rawItems.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "查詢清單不可為空" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (rawItems.length > 500) {
    return new Response(
      JSON.stringify({ ok: false, error: "單次批次查詢上限為 500 筆" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const results = await processItems(client, rawItems);

    const summary = results.reduce(
      (acc, r) => {
        acc.total_rows += 1;
        if (r.ok) {
          acc.success_rows += 1;
          acc.total_co2_kg = Number((acc.total_co2_kg + r.total_co2_kg).toFixed(4));
          acc.total_co2_tonnes = Number((acc.total_co2_kg / 1000).toFixed(6));
          if (r.data_source === "ICAO_OFFICIAL") {
            acc.official_count += 1;
          } else {
            acc.fallback_count += 1;
          }
          if (r.r2_image_url) {
            acc.with_image_count += 1;
          }
        } else {
          acc.error_rows += 1;
        }
        return acc;
      },
      {
        total_rows: 0,
        success_rows: 0,
        error_rows: 0,
        official_count: 0,
        fallback_count: 0,
        with_image_count: 0,
        total_co2_kg: 0,
        total_co2_tonnes: 0,
      }
    );

    return new Response(
      JSON.stringify({
        ok: true,
        summary,
        results,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  } finally {
    try {
      await client.end();
    } catch (_) {
      // ignore close error
    }
  }
}
