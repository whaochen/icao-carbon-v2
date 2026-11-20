import pg from "pg";

const { Client } = pg;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

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
  const q = (url.searchParams.get("q") || "").trim();
  const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 200);

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    let result;
    if (!q) {
      result = await client.query(
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
        ORDER BY is_major_hub DESC, country_code = 'TW' DESC, iata_code ASC
        LIMIT $1;
        `,
        [limit]
      );
    } else {
      const exactCode = q.toUpperCase();
      const pattern = `%${q}%`;
      result = await client.query(
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
        WHERE iata_code ILIKE $1
           OR icao_code ILIKE $1
           OR name_zh ILIKE $1
           OR name_en ILIKE $1
           OR city_zh ILIKE $1
        ORDER BY
          (UPPER(iata_code) = $2 OR UPPER(icao_code) = $2) DESC,
          is_major_hub DESC,
          iata_code ASC
        LIMIT $3;
        `,
        [pattern, exactCode, limit]
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        count: result.rows.length,
        airports: result.rows,
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
