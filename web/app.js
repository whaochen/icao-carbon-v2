/**
 * ICAO 航空碳排 MRV 查證與批次憑證系統 v2.0 - 前端核心控制器
 * 遵循原則：
 * 1. 零假預設值：所有距離與碳排皆由後端查閱 icao_routes_cache 或透過 airports 經緯度計算 Haversine GCD
 * 2. 零 AI Token 消耗：純演算法與 JSZip 批次打包
 * 3. MRV 查證可追溯：完整呈現 data_source、captured_at 與 r2_image_url
 */

const state = {
  airports: [],
  airportMap: new Map(),
  singleMode: "CARGO",
  lastSingleResult: null,
  batchItems: [], // 儲存原始查詢條件與後端回傳結果
};

// 一鍵示範資料：空運貨運範例 (TPE -> LAX / PVG / FRA 等)
const DEMO_CARGO_ITEMS = [
  { label: "AWB-2026-001 伺服器機櫃出口", origin: "TPE", dest: "LAX", transport_mode: "CARGO", weight_kg: 1250, cabin_class: "CARGO_1KG" },
  { label: "AWB-2026-002 晶圓測試設備", origin: "TPE", dest: "PVG", transport_mode: "CARGO", weight_kg: 680, cabin_class: "CARGO_1KG" },
  { label: "AWB-2026-003 車用電子模組", origin: "TPE", dest: "FRA", transport_mode: "CARGO", weight_kg: 920, cabin_class: "CARGO_1KG" },
  { label: "AWB-2026-004 精密光學元件", origin: "TPE", dest: "NRT", transport_mode: "CARGO", weight_kg: 450, cabin_class: "CARGO_1KG" },
  { label: "AWB-2026-005 東南亞急件調撥", origin: "TPE", dest: "SIN", transport_mode: "CARGO", weight_kg: 310, cabin_class: "CARGO_1KG" },
];

// 一鍵示範資料：商務差旅範例
const DEMO_PAX_ITEMS = [
  { label: "TRV-2026-101 東京客戶技術會議", origin: "TPE", dest: "NRT", transport_mode: "PASSENGER", passengers: 2, cabin_class: "ECONOMY" },
  { label: "TRV-2026-102 新加坡亞太永續展", origin: "TPE", dest: "SIN", transport_mode: "PASSENGER", passengers: 3, cabin_class: "ECONOMY" },
  { label: "TRV-2026-103 矽谷總部季度審查", origin: "TPE", dest: "SFO", transport_mode: "PASSENGER", passengers: 1, cabin_class: "BUSINESS" },
  { label: "TRV-2026-104 歐洲供應鏈稽核", origin: "TPE", dest: "AMS", transport_mode: "PASSENGER", passengers: 2, cabin_class: "ECONOMY" },
];

// ==================== 初始化 ====================
document.addEventListener("DOMContentLoaded", async () => {
  bindTabEvents();
  bindSingleLookupEvents();
  bindBatchEvents();
  bindDemoButtons();
  bindModalEvents();

  await Promise.all([loadQueueStatus(), loadAirportsDictionary()]);
});

// ==================== 頂部狀態列與機場字典 ====================
async function loadQueueStatus() {
  const btn = document.getElementById("btnRefreshStats");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/queue-status");
    const data = await res.json();
    if (data.ok && data.stats) {
      document.getElementById("statAirports").textContent = `${data.stats.total_airports} 座`;
      document.getElementById("statCached").textContent = `${data.stats.cached_routes} 條`;
      document.getElementById("statR2Images").textContent = `${data.stats.with_r2_image} 張`;
      document.getElementById("statQueuePending").textContent = `${data.stats.queue_pending} 條`;
    }
  } catch (err) {
    console.warn("無法載入狀態統計:", err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadAirportsDictionary() {
  try {
    const res = await fetch("/api/airports?limit=200");
    const data = await res.json();
    if (data.ok && Array.isArray(data.airports)) {
      state.airports = data.airports;
      state.airportMap.clear();

      const datalist = document.getElementById("airportDatalist");
      datalist.innerHTML = "";

      for (const ap of data.airports) {
        state.airportMap.set(ap.icao_code.toUpperCase(), ap);
        if (ap.iata_code) {
          state.airportMap.set(ap.iata_code.toUpperCase(), ap);
        }

        const opt = document.createElement("option");
        const codeLabel = ap.iata_code ? `${ap.iata_code} (${ap.icao_code})` : ap.icao_code;
        opt.value = ap.iata_code || ap.icao_code;
        opt.label = `${codeLabel} - ${ap.city_zh || ""} ${ap.name_zh || ap.name_en}`;
        datalist.appendChild(opt);
      }

      updateAirportHint("singleOrigin", "singleOriginHint");
      updateAirportHint("singleDest", "singleDestHint");
    }
  } catch (err) {
    console.warn("無法載入機場字典:", err);
  }
}

function resolveAirportCode(rawVal) {
  const cleaned = String(rawVal || "").trim().toUpperCase();
  // 若使用者從 datalist 選取或輸入 "TPE (RCTP)"，擷取前段代碼
  const match = cleaned.match(/^([A-Z]{3,4})\b/);
  return match ? match[1] : cleaned;
}

function updateAirportHint(inputId, hintId) {
  const inputEl = document.getElementById(inputId);
  const hintEl = document.getElementById(hintId);
  if (!inputEl || !hintEl) return;

  const code = resolveAirportCode(inputEl.value);
  const ap = state.airportMap.get(code);
  if (ap) {
    hintEl.textContent = `${ap.city_zh || ""} · ${ap.name_zh || ap.name_en} (${ap.iata_code || "--"} / ${ap.icao_code})`;
    hintEl.style.color = "#059669";
  } else if (code.length >= 3) {
    hintEl.textContent = `將以代碼 "${code}" 查詢資料庫`;
    hintEl.style.color = "#64748b";
  } else {
    hintEl.textContent = "請輸入 3 碼 IATA (如 TPE) 或 4 碼 ICAO (如 RCTP)";
    hintEl.style.color = "#64748b";
  }
}

// ==================== Tabs 切換 ====================
function bindTabEvents() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      switchTab(target);
    });
  });

  document.getElementById("btnRefreshStats").addEventListener("click", () => {
    loadQueueStatus();
  });
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabName);
  });
  document.getElementById("panelSingle").classList.toggle("active", tabName === "single");
  document.getElementById("panelBatch").classList.toggle("active", tabName === "batch");
}

// ==================== 單筆即時查詢 ====================
function bindSingleLookupEvents() {
  // 貨運 / 差旅切換
  const modeBtns = document.querySelectorAll("#singleModeSwitch .seg-btn");
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.singleMode = btn.getAttribute("data-mode");

      const isCargo = state.singleMode === "CARGO";
      document.getElementById("cargoFields").hidden = !isCargo;
      document.getElementById("passengerFields").hidden = isCargo;
    });
  });

  // 起訖機場輸入提示與交換
  const originInput = document.getElementById("singleOrigin");
  const destInput = document.getElementById("singleDest");
  originInput.addEventListener("input", () => updateAirportHint("singleOrigin", "singleOriginHint"));
  destInput.addEventListener("input", () => updateAirportHint("singleDest", "singleDestHint"));

  document.getElementById("btnSwapAirports").addEventListener("click", () => {
    const tmp = originInput.value;
    originInput.value = destInput.value;
    destInput.value = tmp;
    updateAirportHint("singleOrigin", "singleOriginHint");
    updateAirportHint("singleDest", "singleDestHint");
  });

  // 熱門航線快捷鍵
  document.querySelectorAll(".quick-routes .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      originInput.value = chip.getAttribute("data-origin");
      destInput.value = chip.getAttribute("data-dest");
      updateAirportHint("singleOrigin", "singleOriginHint");
      updateAirportHint("singleDest", "singleDestHint");
      document.getElementById("singleLookupForm").requestSubmit();
    });
  });

  // 重量快捷鍵
  document.querySelectorAll(".preset-btns .chip-sm").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("singleWeightKg").value = chip.getAttribute("data-weight");
    });
  });

  // 表單送出查詢
  document.getElementById("singleLookupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await executeSingleLookup();
  });

  // 單張截圖下載
  document.getElementById("btnDownloadSingleImg").addEventListener("click", async () => {
    if (!state.lastSingleResult || !state.lastSingleResult.r2_image_url) return;
    const r = state.lastSingleResult;
    const filename = `ICAO_${r.transport_mode}_${r.origin.iata_code || r.origin.icao_code}_${r.dest.iata_code || r.dest.icao_code}.png`;
    await downloadImageFile(r.r2_image_url, filename);
  });

  // 加入批次清單
  const addSingleHandler = () => {
    if (!state.lastSingleResult) return;
    const r = state.lastSingleResult;
    state.batchItems.push({
      checked: true,
      label: `單筆查詢 (${r.origin.iata_code || r.origin.icao_code}→${r.dest.iata_code || r.dest.icao_code})`,
      origin: r.origin.iata_code || r.origin.icao_code,
      dest: r.dest.iata_code || r.dest.icao_code,
      transport_mode: r.transport_mode,
      cabin_class: r.cabin_class,
      weight_kg: r.weight_kg || 1000,
      passengers: r.passengers || 1,
      result: r,
    });
    renderBatchTable();
    switchTab("batch");
  };

  document.getElementById("btnAddSingleToBatch").addEventListener("click", addSingleHandler);
  document.getElementById("btnAddFallbackToBatch").addEventListener("click", addSingleHandler);
}

async function executeSingleLookup() {
  const btn = document.getElementById("btnSingleSubmit");
  const origin = resolveAirportCode(document.getElementById("singleOrigin").value);
  const dest = resolveAirportCode(document.getElementById("singleDest").value);
  const mode = state.singleMode;
  const weightKg = Number(document.getElementById("singleWeightKg").value) || 1000;
  const passengers = parseInt(document.getElementById("singlePassengers").value, 10) || 1;
  const cabinClass = mode === "CARGO" ? "CARGO_1KG" : document.getElementById("singleCabinClass").value;

  btn.disabled = true;
  btn.textContent = "⏳ 正在查詢 Neon 資料庫與 R2 憑證...";

  try {
    const params = new URLSearchParams({
      origin,
      dest,
      transport_mode: mode,
      cabin_class: cabinClass,
      weight_kg: String(weightKg),
      passengers: String(passengers),
    });

    const res = await fetch(`/api/lookup?${params.toString()}`);
    const data = await res.json();

    if (!data.ok || !data.result || !data.result.ok) {
      alert(data.result?.error || data.error || "查詢失敗，請檢查機場代碼是否正確");
      return;
    }

    state.lastSingleResult = data.result;
    renderSingleResult(data.result);
    loadQueueStatus(); // 更新佇列統計
  } catch (err) {
    alert(`連線發生錯誤：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ 立即查詢碳排與官方截圖憑證";
  }
}

function renderSingleResult(r) {
  document.getElementById("singleEmptyState").hidden = true;
  document.getElementById("singleResultContent").hidden = false;

  const badge = document.getElementById("singleSourceBadge");
  if (r.data_source === "ICAO_OFFICIAL") {
    badge.textContent = "✅ ICAO_OFFICIAL (官方快取憑證)";
    badge.className = "source-badge badge-official";
  } else {
    badge.textContent = "📐 GCD_FALLBACK (大圓距離試算 · 已排隊補圖)";
    badge.className = "source-badge badge-fallback";
  }

  // 起訖機場標頭
  document.getElementById("resOriginCode").textContent = r.origin.iata_code || r.origin.icao_code;
  document.getElementById("resOriginIcao").textContent = r.origin.icao_code;
  document.getElementById("resOriginName").textContent = `${r.origin.city_zh || ""} ${r.origin.name_zh || r.origin.name_en}`;

  document.getElementById("resDestCode").textContent = r.dest.iata_code || r.dest.icao_code;
  document.getElementById("resDestIcao").textContent = r.dest.icao_code;
  document.getElementById("resDestName").textContent = `${r.dest.city_zh || ""} ${r.dest.name_zh || r.dest.name_en}`;

  document.getElementById("resModeTag").textContent =
    r.transport_mode === "CARGO" ? `CARGO · ${formatNumber(r.weight_kg)} KG` : `PASSENGER · ${r.passengers} PAX (${r.cabin_class})`;
  document.getElementById("resDistanceKm").textContent = `${formatNumber(r.distance_km)} km`;

  // KPI 數值
  document.getElementById("resTotalCo2Kg").textContent = `${formatNumber(r.total_co2_kg, 2)} kg CO₂`;
  document.getElementById("resTotalCo2Tonnes").textContent = `約 ${r.total_co2_tonnes} 公噸 (tCO₂)`;
  document.getElementById("resUnitCo2").textContent = `${r.unit_co2_kg} kg CO₂`;
  document.getElementById("resUnitLabel").textContent =
    r.transport_mode === "CARGO" ? "每公斤貨物 (per kg cargo)" : `每位旅客 (${r.cabin_class})`;

  const fuelStr = r.fuel_burn_kg ? `${formatNumber(r.fuel_burn_kg)} kg 油耗` : "未提供";
  document.getElementById("resDistAndFuel").textContent = `${formatNumber(r.distance_km)} km / ${fuelStr}`;
  document.getElementById("resMethodVersion").textContent = r.icao_method_version || "ICAO Methodology";

  // MRV 元資料
  document.getElementById("resDataSource").textContent = r.data_source;
  document.getElementById("resCapturedAt").textContent = r.captured_at ? formatDateTime(r.captured_at) : "尚無官方截圖 (已加入 scrape_queue 排隊)";

  const urlBox = document.getElementById("resR2UrlBox");
  if (r.r2_image_url) {
    urlBox.innerHTML = `<a href="${escapeHtml(r.r2_image_url)}" target="_blank" rel="noopener">${escapeHtml(r.r2_image_url)}</a>`;
  } else {
    urlBox.textContent = "待 GitHub Actions Worker 抓圖上傳至 Cloudflare R2";
  }

  // 截圖預覽或排隊提示
  const imgWrap = document.getElementById("singleImageWrap");
  const fallbackNotice = document.getElementById("singleFallbackNotice");

  if (r.r2_image_url) {
    imgWrap.hidden = false;
    fallbackNotice.hidden = true;
    document.getElementById("singlePreviewImg").src = r.r2_image_url;
    document.getElementById("btnOpenOriginalImg").href = r.r2_image_url;
  } else {
    imgWrap.hidden = true;
    fallbackNotice.hidden = false;
    const gcdNote = r.gcd_raw_km ? `（起訖經緯度 Haversine 純大圓距離 ${formatNumber(r.gcd_raw_km)} km，加計 ICAO 航路繞行修正後為 ${formatNumber(r.distance_km)} km）` : "";
    document.getElementById("singleFallbackDesc").innerHTML =
      `系統已依起訖機場真實經緯度計算大圓距離${gcdNote}，並自動寫入 <code>scrape_queue</code>（目前累計請求次數：<strong>${r.queue_request_count || 1}</strong> 次，狀態：<code>${r.queue_status || "PENDING"}</code>）。待背景 Worker 執行完畢後即可取得 R2 官方截圖。`;
  }
}

// ==================== 一鍵示範按鈕 ====================
function bindDemoButtons() {
  document.getElementById("btnDemoCargo").addEventListener("click", async () => {
    // 同時更新單筆查詢與載入批次範例
    document.getElementById("singleOrigin").value = "TPE";
    document.getElementById("singleDest").value = "LAX";
    updateAirportHint("singleOrigin", "singleOriginHint");
    updateAirportHint("singleDest", "singleDestHint");

    await loadBatchFromRawList(DEMO_CARGO_ITEMS);
    switchTab("batch");
  });

  document.getElementById("btnDemoPax").addEventListener("click", async () => {
    await loadBatchFromRawList(DEMO_PAX_ITEMS);
    switchTab("batch");
  });
}

// ==================== 批次查詢、CSV 解析與 ZIP 打包 ====================
function bindBatchEvents() {
  // 下載 CSV 範本
  document.getElementById("btnDownloadTemplate").addEventListener("click", () => {
    const csvContent = [
      "\uFEFFlabel,origin,dest,transport_mode,weight_kg,passengers,cabin_class",
      "AWB-2026-001 空運出口洛杉磯,TPE,LAX,CARGO,1250,,CARGO_1KG",
      "AWB-2026-002 空運出口上海浦東,TPE,PVG,CARGO,680,,CARGO_1KG",
      "AWB-2026-003 空運出口法蘭克福,TPE,FRA,CARGO,920,,CARGO_1KG",
      "TRV-2026-101 東京商務出差,TPE,NRT,PASSENGER,,2,ECONOMY",
      "TRV-2026-102 舊金山總部出差,TPE,SFO,PASSENGER,,1,BUSINESS",
    ].join("\r\n");

    triggerBlobDownload(new Blob([csvContent], { type: "text/csv;charset=utf-8;" }), "icao_carbon_batch_template.csv");
  });

  // 新增一列
  document.getElementById("btnAddManualRow").addEventListener("click", async () => {
    const newItem = {
      label: `手動新增-${state.batchItems.length + 1}`,
      origin: "TPE",
      dest: "LAX",
      transport_mode: "CARGO",
      weight_kg: 1000,
      passengers: 1,
      cabin_class: "CARGO_1KG",
    };
    await appendAndQueryBatchItems([newItem]);
  });

  // 清空清單
  document.getElementById("btnClearBatch").addEventListener("click", () => {
    state.batchItems = [];
    renderBatchTable();
  });

  // 重新查詢
  document.getElementById("btnRecalculateBatch").addEventListener("click", async () => {
    if (state.batchItems.length === 0) return;
    const rawList = state.batchItems.map((it) => ({
      label: it.label,
      origin: it.origin,
      dest: it.dest,
      transport_mode: it.transport_mode,
      weight_kg: it.weight_kg,
      passengers: it.passengers,
      cabin_class: it.cabin_class,
    }));
    await loadBatchFromRawList(rawList);
  });

  // 全選 / 取消全選
  document.getElementById("checkAllRows").addEventListener("change", (e) => {
    const checked = e.target.checked;
    state.batchItems.forEach((it) => {
      it.checked = checked;
    });
    renderBatchTable();
  });

  // CSV 拖曳與選取上傳
  const dropzone = document.getElementById("csvDropzone");
  const fileInput = document.getElementById("csvFileInput");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleCsvFileUpload(file);
  });

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await handleCsvFileUpload(file);
    fileInput.value = "";
  });

  // 僅下載 CSV 報表
  document.getElementById("btnExportCsvOnly").addEventListener("click", () => {
    const selected = getSelectedBatchItems();
    if (selected.length === 0) {
      alert("請至少勾選一筆航線資料！");
      return;
    }
    const csvText = generateCarbonReportCsv(selected);
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(new Blob([csvText], { type: "text/csv;charset=utf-8;" }), `carbon_report_${stamp}.csv`);
  });

  // 一鍵打包下載 ZIP (R2 官方原圖 + carbon_report.csv + MRV 查證說明)
  document.getElementById("btnDownloadZip").addEventListener("click", async () => {
    await exportBatchZipPackage();
  });
}

async function handleCsvFileUpload(file) {
  const text = await file.text();
  const parsedItems = parseCsvText(text);
  if (parsedItems.length === 0) {
    alert("無法從 CSV 解析出有效航線，請確認包含 origin 與 dest 欄位（可先下載 CSV 範本參考）。");
    return;
  }
  await loadBatchFromRawList(parsedItems);
}

/**
 * 純前端 CSV 解析器（零 Token 消耗，支援引號轉義與中英欄位名稱自動對應）
 */
function parseCsvText(csvText) {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const cols = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  const findCol = (candidates) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const idxLabel = findCol(["label", "備註", "單號", "提單", "note", "id"]);
  const idxOrigin = findCol(["origin", "起飛", "起點", "from", "dep"]);
  const idxDest = findCol(["dest", "目的", "終點", "to", "arr"]);
  const idxMode = findCol(["transport_mode", "mode", "模式", "類別"]);
  const idxWeight = findCol(["weight", "重量", "kg"]);
  const idxPax = findCol(["passengers", "pax", "人數", "旅客"]);
  const idxCabin = findCol(["cabin", "艙等", "class"]);

  if (idxOrigin === -1 || idxDest === -1) return [];

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseLine(lines[i]);
    const origin = resolveAirportCode(row[idxOrigin] || "");
    const dest = resolveAirportCode(row[idxDest] || "");
    if (!origin || !dest) continue;

    const rawMode = (idxMode !== -1 ? row[idxMode] : "CARGO").toUpperCase();
    const transport_mode = rawMode.includes("PAX") || rawMode.includes("PASSENGER") || rawMode.includes("差旅") ? "PASSENGER" : "CARGO";

    items.push({
      label: idxLabel !== -1 && row[idxLabel] ? row[idxLabel] : `CSV-#${i}`,
      origin,
      dest,
      transport_mode,
      weight_kg: idxWeight !== -1 && row[idxWeight] ? Number(row[idxWeight]) || 1000 : 1000,
      passengers: idxPax !== -1 && row[idxPax] ? parseInt(row[idxPax], 10) || 1 : 1,
      cabin_class: idxCabin !== -1 && row[idxCabin] ? row[idxCabin].toUpperCase() : transport_mode === "CARGO" ? "CARGO_1KG" : "ECONOMY",
    });
  }

  return items;
}

async function loadBatchFromRawList(rawList) {
  try {
    const res = await fetch("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: rawList }),
    });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.results)) {
      alert(data.error || "批次查詢失敗");
      return;
    }

    state.batchItems = rawList.map((raw, idx) => ({
      checked: true,
      label: raw.label || `航線 #${idx + 1}`,
      origin: raw.origin,
      dest: raw.dest,
      transport_mode: raw.transport_mode || "CARGO",
      weight_kg: raw.weight_kg ?? 1000,
      passengers: raw.passengers ?? 1,
      cabin_class: raw.cabin_class || (raw.transport_mode === "PASSENGER" ? "ECONOMY" : "CARGO_1KG"),
      result: data.results[idx],
    }));

    renderBatchTable();
    loadQueueStatus();
  } catch (err) {
    alert(`批次查詢發生錯誤：${err.message}`);
  }
}

async function appendAndQueryBatchItems(newRawItems) {
  try {
    const res = await fetch("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: newRawItems }),
    });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.results)) return;

    newRawItems.forEach((raw, idx) => {
      state.batchItems.push({
        checked: true,
        label: raw.label,
        origin: raw.origin,
        dest: raw.dest,
        transport_mode: raw.transport_mode,
        weight_kg: raw.weight_kg,
        passengers: raw.passengers,
        cabin_class: raw.cabin_class,
        result: data.results[idx],
      });
    });

    renderBatchTable();
    loadQueueStatus();
  } catch (err) {
    alert(`新增航線查詢失敗：${err.message}`);
  }
}

function renderBatchTable() {
  const tbody = document.getElementById("batchTableBody");
  const badge = document.getElementById("batchCountBadge");

  if (state.batchItems.length === 0) {
    badge.hidden = true;
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="14">尚無批次資料。請點擊上方「📦 載入空運範例」、「✈️ 載入差旅範例」或上傳 CSV 檔案。</td>
      </tr>
    `;
    updateBatchSummaryMetrics();
    return;
  }

  badge.hidden = false;
  badge.textContent = String(state.batchItems.length);

  tbody.innerHTML = "";

  state.batchItems.forEach((item, idx) => {
    const r = item.result || {};
    const tr = document.createElement("tr");

    const originDisplay = r.ok
      ? `<strong>${r.origin.iata_code || r.origin.icao_code}</strong> <small>(${r.origin.icao_code})</small><br/><small>${escapeHtml(r.origin.city_zh || r.origin.name_zh || "")}</small>`
      : escapeHtml(item.origin);

    const destDisplay = r.ok
      ? `<strong>${r.dest.iata_code || r.dest.icao_code}</strong> <small>(${r.dest.icao_code})</small><br/><small>${escapeHtml(r.dest.city_zh || r.dest.name_zh || "")}</small>`
      : escapeHtml(item.dest);

    const modeDisplay =
      item.transport_mode === "CARGO"
        ? `<span class="source-badge">📦 CARGO</span>`
        : `<span class="source-badge">🧳 PAX (${escapeHtml(item.cabin_class)})</span>`;

    const qtyDisplay =
      item.transport_mode === "CARGO"
        ? `<input type="number" class="table-input row-qty-input" data-idx="${idx}" min="0.1" step="0.1" value="${item.weight_kg}" /> <small>KG</small>`
        : `<input type="number" class="table-input row-qty-input" data-idx="${idx}" min="1" step="1" value="${item.passengers}" /> <small>人</small>`;

    const distDisplay = r.ok ? `${formatNumber(r.distance_km)} km` : "--";
    const unitCo2Display = r.ok ? `${r.unit_co2_kg} kg` : "--";
    const totalCo2Display = r.ok
      ? `<strong>${formatNumber(r.total_co2_kg, 2)} kg</strong><br/><small>${r.total_co2_tonnes} tCO₂</small>`
      : `<span style="color:#dc2626">${escapeHtml(r.error || "查詢錯誤")}</span>`;

    const sourceBadge = !r.ok
      ? `<span class="source-badge">❌ 錯誤</span>`
      : r.data_source === "ICAO_OFFICIAL"
      ? `<span class="source-badge badge-official">✅ ICAO_OFFICIAL</span>`
      : `<span class="source-badge badge-fallback">📐 GCD_FALLBACK</span>`;

    const capturedDisplay = r.ok && r.captured_at ? `<small>${formatDateTime(r.captured_at)}</small>` : `<small style="color:#94a3b8">排隊補圖中</small>`;

    const r2Display =
      r.ok && r.r2_image_url
        ? `<button type="button" class="thumb-btn btn-preview-modal" data-idx="${idx}">🖼️ 檢視 R2 原圖</button>`
        : `<small style="color:#d97706">尚無 R2 原圖 (已排隊)</small>`;

    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="row-check" data-idx="${idx}" ${item.checked ? "checked" : ""} />
      </td>
      <td>${idx + 1}</td>
      <td>
        <input type="text" class="table-input row-label-input" data-idx="${idx}" value="${escapeHtml(item.label)}" />
      </td>
      <td>${originDisplay}</td>
      <td>${destDisplay}</td>
      <td>${modeDisplay}</td>
      <td>${qtyDisplay}</td>
      <td>${distDisplay}</td>
      <td>${unitCo2Display}</td>
      <td>${totalCo2Display}</td>
      <td>${sourceBadge}</td>
      <td>${capturedDisplay}</td>
      <td>${r2Display}</td>
      <td>
        <button type="button" class="btn btn-sm btn-danger-outline btn-remove-row" data-idx="${idx}">刪除</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // 綁定列內互動事件
  tbody.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const i = Number(e.target.getAttribute("data-idx"));
      state.batchItems[i].checked = e.target.checked;
      updateBatchSummaryMetrics();
    });
  });

  tbody.querySelectorAll(".row-label-input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.getAttribute("data-idx"));
      state.batchItems[i].label = e.target.value;
    });
  });

  tbody.querySelectorAll(".row-qty-input").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const i = Number(e.target.getAttribute("data-idx"));
      const val = Math.max(0.1, Number(e.target.value) || 1);
      const item = state.batchItems[i];
      if (item.transport_mode === "CARGO") {
        item.weight_kg = val;
      } else {
        item.passengers = Math.max(1, Math.round(val));
      }
      if (item.result && item.result.ok) {
        const qty = item.transport_mode === "CARGO" ? item.weight_kg : item.passengers;
        item.result.quantity = qty;
        item.result.weight_kg = item.transport_mode === "CARGO" ? item.weight_kg : null;
        item.result.passengers = item.transport_mode === "PASSENGER" ? item.passengers : null;
        item.result.total_co2_kg = Number((item.result.unit_co2_kg * qty).toFixed(4));
        item.result.total_co2_tonnes = Number((item.result.total_co2_kg / 1000).toFixed(6));
      }
      renderBatchTable();
    });
  });

  tbody.querySelectorAll(".btn-preview-modal").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.currentTarget.getAttribute("data-idx"));
      const r = state.batchItems[i]?.result;
      if (r && r.r2_image_url) {
        openImageModal(r);
      }
    });
  });

  tbody.querySelectorAll(".btn-remove-row").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.currentTarget.getAttribute("data-idx"));
      state.batchItems.splice(i, 1);
      renderBatchTable();
    });
  });

  updateBatchSummaryMetrics();
}

function getSelectedBatchItems() {
  return state.batchItems.filter((it) => it.checked);
}

function updateBatchSummaryMetrics() {
  const selected = getSelectedBatchItems();
  let officialCount = 0;
  let fallbackCount = 0;
  let totalCo2Kg = 0;

  for (const it of selected) {
    const r = it.result;
    if (r && r.ok) {
      totalCo2Kg += Number(r.total_co2_kg) || 0;
      if (r.data_source === "ICAO_OFFICIAL") {
        officialCount++;
      } else {
        fallbackCount++;
      }
    }
  }

  const totalTonnes = (totalCo2Kg / 1000).toFixed(4);
  document.getElementById("batchTotalRows").textContent = `${selected.length} / ${state.batchItems.length}`;
  document.getElementById("batchOfficialRows").textContent = String(officialCount);
  document.getElementById("batchFallbackRows").textContent = String(fallbackCount);
  document.getElementById("batchTotalCo2").textContent = `${formatNumber(totalCo2Kg, 2)} kg CO₂ (${totalTonnes} t)`;
}

/**
 * 產生包含完整 MRV 查證欄位的 carbon_report.csv
 */
function generateCarbonReportCsv(selectedItems) {
  const headers = [
    "序號",
    "提單或差旅單號備註",
    "起飛機場_IATA",
    "起飛機場_ICAO",
    "起飛機場名稱",
    "目的機場_IATA",
    "目的機場_ICAO",
    "目的機場名稱",
    "運輸模式(transport_mode)",
    "艙等(cabin_class)",
    "貨重_KG或人數_PAX",
    "單位",
    "航程距離_KM",
    "整機參考油耗_KG",
    "單位碳排係數_kgCO2",
    "總碳排量_kgCO2",
    "總碳排量_公噸tCO2",
    "資料來源(data_source)",
    "方法學版本(icao_method_version)",
    "官方截圖時間(captured_at)",
    "Cloudflare_R2官方憑證網址(r2_image_url)",
    "ZIP包內對應截圖檔名",
    "MRV查證備註",
  ];

  const rows = [headers.join(",")];

  selectedItems.forEach((item, idx) => {
    const r = item.result || {};
    if (!r.ok) {
      rows.push(
        [
          idx + 1,
          csvEscape(item.label),
          csvEscape(item.origin),
          "",
          "",
          csvEscape(item.dest),
          "",
          "",
          item.transport_mode,
          item.cabin_class,
          item.transport_mode === "CARGO" ? item.weight_kg : item.passengers,
          item.transport_mode === "CARGO" ? "KG" : "PAX",
          "",
          "",
          "",
          "",
          "",
          "ERROR",
          "",
          "",
          "",
          "無圖檔",
          csvEscape(r.error || "查詢失敗"),
        ].join(",")
      );
      return;
    }

    const zipImgName = r.r2_image_url ? getZipImageFilename(r, idx + 1) : "尚無R2官方截圖(GCD試算並已排隊)";
    const mrvNote =
      r.data_source === "ICAO_OFFICIAL"
        ? "已附 ICAO 官方計算機原始截圖憑證 (Cloudflare R2)"
        : "目前無官方快取，採機場真實經緯度 Haversine 大圓距離試算 (GCD_FALLBACK)，已自動加入 scrape_queue 排隊補抓";

    rows.push(
      [
        idx + 1,
        csvEscape(item.label),
        csvEscape(r.origin.iata_code || ""),
        csvEscape(r.origin.icao_code),
        csvEscape(r.origin.name_zh || r.origin.name_en),
        csvEscape(r.dest.iata_code || ""),
        csvEscape(r.dest.icao_code),
        csvEscape(r.dest.name_zh || r.dest.name_en),
        r.transport_mode,
        r.cabin_class,
        r.quantity,
        r.quantity_unit,
        r.distance_km,
        r.fuel_burn_kg ?? "",
        r.unit_co2_kg,
        r.total_co2_kg,
        r.total_co2_tonnes,
        r.data_source,
        csvEscape(r.icao_method_version || ""),
        csvEscape(r.captured_at || ""),
        csvEscape(r.r2_image_url || ""),
        csvEscape(zipImgName),
        csvEscape(mrvNote),
      ].join(",")
    );
  });

  return "\uFEFF" + rows.join("\r\n");
}

function getZipImageFilename(r, seqNum) {
  const orig = r.origin.iata_code || r.origin.icao_code;
  const dest = r.dest.iata_code || r.dest.icao_code;
  const numStr = String(seqNum).padStart(3, "0");
  return `screenshots/${numStr}_${r.transport_mode}_${orig}_${dest}_${r.cabin_class}.png`;
}

/**
 * 使用 JSZip 將勾選結果的 R2 官方原圖 (.png) + carbon_report.csv + MRV_README.txt 一鍵打包下載
 */
async function exportBatchZipPackage() {
  const selected = getSelectedBatchItems();
  if (selected.length === 0) {
    alert("請至少勾選一筆航線資料！");
    return;
  }

  if (typeof JSZip === "undefined") {
    alert("JSZip 套件尚未載入完成，請檢查網路連線或重新整理頁面。");
    return;
  }

  const btnZip = document.getElementById("btnDownloadZip");
  const progressBox = document.getElementById("zipProgressBox");
  const progressText = document.getElementById("zipProgressText");
  const progressPercent = document.getElementById("zipProgressPercent");
  const progressFill = document.getElementById("zipProgressFill");

  btnZip.disabled = true;
  progressBox.hidden = false;
  updateProgress(5, "正在產生 carbon_report.csv 碳排查證報表...");

  function updateProgress(pct, msg) {
    progressPercent.textContent = `${pct}%`;
    progressFill.style.width = `${pct}%`;
    if (msg) progressText.textContent = msg;
  }

  try {
    const zip = new JSZip();

    // 1. 加入 CSV 報表
    const csvText = generateCarbonReportCsv(selected);
    zip.file("carbon_report.csv", csvText);

    // 2. 下載每一筆有 R2 官方原圖的 .png 並寫入 screenshots/ 資料夾
    const imageLogs = [];
    const missingLogs = [];

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const r = item.result || {};
      const seq = i + 1;
      const pct = Math.min(85, Math.round(10 + ((i + 1) / selected.length) * 75));

      if (r.ok && r.r2_image_url) {
        const orig = r.origin.iata_code || r.origin.icao_code;
        const dest = r.dest.iata_code || r.dest.icao_code;
        updateProgress(pct, `正在下載 R2 官方截圖 (${seq}/${selected.length})：${orig} → ${dest}...`);

        const zipImgPath = getZipImageFilename(r, seq);
        try {
          const imgRes = await fetch(r.r2_image_url, { mode: "cors" });
          if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
          const blob = await imgRes.blob();
          zip.file(zipImgPath, blob);
          imageLogs.push(
            `[已收錄原圖] #${seq} ${item.label} (${orig} -> ${dest}) | 檔案: ${zipImgPath} | 擷取時間: ${r.captured_at} | R2網址: ${r.r2_image_url}`
          );
        } catch (fetchErr) {
          missingLogs.push(
            `[R2圖檔連線受限或跨域阻擋] #${seq} ${item.label} (${orig} -> ${dest}) | 請直接點擊報表內 R2 公開網址下載: ${r.r2_image_url} (${fetchErr.message})`
          );
        }
      } else if (r.ok) {
        const orig = r.origin.iata_code || r.origin.icao_code;
        const dest = r.dest.iata_code || r.dest.icao_code;
        missingLogs.push(
          `[尚無R2官方原圖 - 採大圓距離試算 GCD_FALLBACK] #${seq} ${item.label} (${orig} -> ${dest}) | 系統已自動排入 scrape_queue 佇列待補抓官方截圖`
        );
      } else {
        missingLogs.push(`[無效航線] #${seq} ${item.label} (${item.origin} -> ${item.dest}) | 原因: ${r.error || "未知錯誤"}`);
      }
    }

    // 3. 加入 MRV_查證憑證說明書.txt
    const nowStr = new Date().toISOString();
    const readmeLines = [
      "=========================================================================",
      "ICAO 航空碳排 MRV 查證憑證包 (ISO 14064-1 / 範疇三類別 4 & 6 查證附件)",
      "=========================================================================",
      `匯出時間 (UTC)：${nowStr}`,
      `總勾選筆數：${selected.length} 筆`,
      `成功打包 R2 官方截圖數：${imageLogs.length} 張`,
      `尚無 R2 圖檔 / 試算筆數：${missingLogs.length} 筆`,
      "",
      "【檔案結構說明】",
      "1. carbon_report.csv：完整碳排明細報表（可用 Excel 直接開啟，含 UTF-8 BOM）。",
      "   - 內含起訖機場 IATA/ICAO 代碼、距離(km)、油耗(kg)、單位係數、總碳排(kg / tCO2)、",
      "     data_source (ICAO_OFFICIAL 或 GCD_FALLBACK)、captured_at 截圖時間與 r2_image_url。",
      "2. screenshots/：存放從 Cloudflare R2 下載之 ICAO 官網計算機原始截圖 (.png)。",
      "",
      "-------------------------------------------------------------------------",
      "【一、已收錄於 screenshots/ 之官方截圖清單 (ICAO_OFFICIAL)】",
      "-------------------------------------------------------------------------",
      ...(imageLogs.length > 0 ? imageLogs : ["（本次勾選項目中無已收錄之 R2 圖檔）"]),
      "",
      "-------------------------------------------------------------------------",
      "【二、尚無 R2 官方圖檔或採 Haversine 大圓距離試算清單 (GCD_FALLBACK)】",
      "-------------------------------------------------------------------------",
      ...(missingLogs.length > 0 ? missingLogs : ["（全部航線皆已具備 R2 官方截圖！）"]),
      "",
    ];
    zip.file("MRV_查證憑證說明書.txt", readmeLines.join("\r\n"));

    updateProgress(92, "正在壓縮產生 ZIP 檔案...");
    const zipBlob = await zip.generateAsync({ type: "blob" });

    updateProgress(100, "✅ ZIP 憑證包打包完成！");
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(zipBlob, `ICAO_MRV_Carbon_Package_${dateStamp}.zip`);
  } catch (err) {
    alert(`打包 ZIP 發生錯誤：${err.message}`);
  } finally {
    btnZip.disabled = false;
    setTimeout(() => {
      progressBox.hidden = true;
    }, 2500);
  }
}

// ==================== 截圖預覽 Modal & 工具函式 ====================
function bindModalEvents() {
  const modal = document.getElementById("imageModal");
  document.getElementById("btnCloseModal").addEventListener("click", () => {
    modal.hidden = true;
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

function openImageModal(r) {
  const modal = document.getElementById("imageModal");
  const orig = r.origin.iata_code || r.origin.icao_code;
  const dest = r.dest.iata_code || r.dest.icao_code;

  document.getElementById("modalTitle").textContent = `ICAO 官方截圖憑證：${orig} (${r.origin.icao_code}) → ${dest} (${r.dest.icao_code})`;
  document.getElementById("modalImage").src = r.r2_image_url;
  document.getElementById("modalMetaText").textContent = `資料來源：${r.data_source} ｜ 擷取時間：${formatDateTime(r.captured_at)} ｜ 航程：${formatNumber(r.distance_km)} km ｜ 單位碳排：${r.unit_co2_kg} kg CO₂`;
  document.getElementById("modalOpenUrl").href = r.r2_image_url;
  modal.hidden = false;
}

async function downloadImageFile(url, filename) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    triggerBlobDownload(blob, filename);
  } catch (_) {
    // 若跨域受限則開新分頁讓使用者直接另存
    window.open(url, "_blank", "noopener");
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatNumber(val, decimals = 0) {
  const num = Number(val);
  if (Number.isNaN(num)) return "--";
  return num.toLocaleString("zh-TW", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDateTime(isoStr) {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("zh-TW", { hour12: false });
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
