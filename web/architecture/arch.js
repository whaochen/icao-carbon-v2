/**
 * 全球航空GHG排放計算器 (Ti · 22) — /architecture 系統架構與合規透明分頁控制器
 * 遵循原則：
 * 1. 頂部 KPI 數據動態呼叫既有 /api/queue-status 載入，不寫死靜態數字
 * 2. Block 01 互動資料流採用常綠文案（不寫死機場數量、不揭露底層雲端或套件名稱）
 * 3. Block 04 動態同步晧脈元素庫主站 JSON（含離線靜態備援與層級篩選）
 * 4. Block 05 支援一鍵複製與非阻斷式 Toast 提示（禁止 alert）
 */

const FLOW_NODES = {
  input: {
    code: "01 · INPUT",
    title: "公開方法學與機場字典",
    tag: "ISO 14064-1 類別 3 ／ GHG Protocol 範疇三類別 4 & 6",
    desc: "系統以全球與亞太樞紐機場座標字典（持續擴充）為基礎，支援 3 碼 IATA 與 4 碼 ICAO 代碼自動正規化比對，並對齊國際民航組織（ICAO）公開碳排方法學。",
    specs: [
      { label: "對應盤查標準", value: "ISO 14064-1 類別 3 ／ GHG Protocol 範疇三類別 4 & 6" },
      { label: "機場字典涵蓋規模", value: "全球與亞太樞紐機場座標字典（持續擴充）" },
      { label: "方法學引用原則", value: "一律以 ICAO 原出處最新公告為準" },
    ],
  },
  sync: {
    code: "02 · SYNC & R2",
    title: "排程檢核與原圖存證",
    tag: "每 6 小時自動維護 · 異常不覆寫",
    desc: "透過定時排程檢核機制維護待補圖佇列，將官方計算結果與原始憑證圖檔封存於原圖存證區；若上游回應異常，系統自動保留既有有效快取，絕不覆寫污染資料。",
    specs: [
      { label: "排程檢核頻率", value: "每 6 小時定期維護快取佇列" },
      { label: "異常保護機制", value: "異常回應不覆寫既有有效快取" },
      { label: "冷門航線排隊", value: "依實務查詢熱度自動提升補圖優先序" },
    ],
  },
  engine: {
    code: "03 · ENGINE",
    title: "零 AI 確定性計算引擎",
    tag: "0% 生成式 AI · 零假預設值",
    desc: "查詢時優先比對結構化官方快取；若尚未收錄，即依起訖機場真實經緯度啟動 Haversine 球面大圓距離（GCD_FALLBACK）零假值試算，全程 0% AI 數值推估。",
    specs: [
      { label: "第一順位查詢", value: "官方快取精準比對（ICAO_OFFICIAL）" },
      { label: "第二順位試算", value: "Haversine 球面大圓距離（GCD_FALLBACK）" },
      { label: "運算確定性", value: "全程 0% AI 數值推估、零 AI Token 消耗" },
    ],
  },
  mrv: {
    code: "04 · MRV ZIP",
    title: "憑證預覽與一鍵 ZIP 查證包",
    tag: "瀏覽器端零留存 · MRV 可追溯",
    desc: "支援單筆結果與原始截圖即時預覽；批次上傳 CSV 後可一鍵將明細報表、查證說明書與所有對應原圖憑證打包下載，全程於瀏覽器端完成、關閉即清空零留存。",
    specs: [
      { label: "單筆即時查證", value: "呈現 data_source、captured_at 與原圖預覽" },
      { label: "批次憑證匯出", value: "一鍵打包明細報表、說明書與原圖 ZIP" },
      { label: "隱私安全邊界", value: "瀏覽器端即時打包，伺服器端零留存" },
    ],
  },
};

// 離線備援清單（當主站 projects.json 無法連線時自動啟用）
const FALLBACK_MATRIX_PROJECTS = {
  C: {
    shortName: "碳足跡查詢",
    title: "環境部碳足跡查詢系統",
    description: "整合環境部碳足跡排放係數與碳標籤產品查詢，支援 ISO 14067 查核。",
    url: "https://cfp-query-web.carbon-factor-search.workers.dev/",
    statusLabel: "LIVE 上線中",
    accessTier: "L0",
  },
  O: {
    shortName: "環策晧脈",
    title: "環策晧脈 · 環境政策觀測站",
    description: "追蹤環境部新聞與法規演進，整合政策版圖關聯地圖與時間軸。",
    url: "https://moenv-policy-pulse.pages.dev/",
    statusLabel: "LIVE 上線中",
    accessTier: "L0",
  },
  P: {
    shortName: "碳規則",
    title: "CFP-PCR 規則學習與解析中心",
    description: "收錄環境部現行有效 PCR 與雙範本解剖，結合系統界限圖工作台。",
    url: "https://cfp-pcr-hub.pages.dev/",
    statusLabel: "LIVE 上線中",
    accessTier: "L0+L1",
  },
  Ti: {
    shortName: "航程碳排",
    title: "全球航空GHG排放計算器",
    description: "依循 ICAO 方法學估算全球航線大圓距離、貨運與商務差旅航空碳足跡。",
    url: "https://icao-carbon-v2.pages.dev/",
    statusLabel: "LIVE 上線中",
    accessTier: "L0+L1",
  },
  Fe: {
    shortName: "軌道碳算",
    title: "臺灣軌道運輸GHG排放計算器",
    description: "整合高鐵、台鐵、北高桃中捷運與輕軌里程資料，依官方碳標籤精算碳排。",
    url: "https://tw-track-carbon.pages.dev/",
    statusLabel: "BETA 測試中",
    accessTier: "L0+L1",
  },
  Zn: {
    shortName: "海運碳排",
    title: "全球航海GHG排放計算器",
    description: "純前端全球海運最短航線與碳排估算工具，支援類别三盤查佐證匯出。",
    url: "https://sea-route-carbon.pages.dev/",
    statusLabel: "LIVE 上線中",
    accessTier: "L0+L1",
  },
};

const L0_ONLY_SYMBOLS = new Set(["C", "O"]);
const L1_PRO_SYMBOLS = new Set(["Ti", "P", "Fe", "Zn", "Cr"]);

let matrixProjects = {};
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", async () => {
  bindStatsRefresh();
  bindSubnavLinks();
  bindFlowNodes();
  bindMeshFilters();
  bindCopyCitation();

  renderFlowDetail("input");
  await Promise.all([loadQueueStatus(), loadMatrixEcosystem()]);
});

// ==================== 1. 動態載入 Banner KPI 數據 ====================
function bindStatsRefresh() {
  const btn = document.getElementById("btnRefreshStats");
  if (btn) {
    btn.addEventListener("click", () => loadQueueStatus());
  }
}

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
  } catch (_) {
    // 保持 -- 狀態，不寫死假數字
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==================== 2. 導覽錨點切換 ====================
function bindSubnavLinks() {
  const links = document.querySelectorAll(".subnav-link");
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

// ==================== 3. Block 01 互動式資料流節點 ====================
function bindFlowNodes() {
  const nodeBtns = document.querySelectorAll(".flow-node");
  nodeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      nodeBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      renderFlowDetail(btn.getAttribute("data-node"));
    });
  });
}

function renderFlowDetail(nodeKey) {
  const panel = document.getElementById("flowDetailPanel");
  const info = FLOW_NODES[nodeKey] || FLOW_NODES.input;

  const specsHtml = info.specs
    .map(
      (s) => `
      <div class="spec-item">
        <span>${escapeHtml(s.label)}</span>
        <strong>${escapeHtml(s.value)}</strong>
      </div>`
    )
    .join("");

  panel.innerHTML = `
    <div class="detail-head">
      <h3>${escapeHtml(info.code)} — ${escapeHtml(info.title)}</h3>
      <span class="detail-tag">${escapeHtml(info.tag)}</span>
    </div>
    <p class="detail-desc">${escapeHtml(info.desc)}</p>
    <div class="detail-specs">${specsHtml}</div>
  `;
}

// ==================== 4. Block 04 晧脈元素庫動態串聯 ====================
async function loadMatrixEcosystem() {
  try {
    const res = await fetch("https://hao-element-matrix.pages.dev/data/projects.json", {
      mode: "cors",
    });
    if (!res.ok) throw new Error("HTTP error");
    const json = await res.json();
    if (json && typeof json === "object" && Object.keys(json).length > 0) {
      matrixProjects = normalizeProjects(json);
    } else {
      matrixProjects = normalizeProjects(FALLBACK_MATRIX_PROJECTS);
    }
  } catch (_) {
    matrixProjects = normalizeProjects(FALLBACK_MATRIX_PROJECTS);
  }
  renderMatrixGrid();
}

function normalizeProjects(rawObj) {
  const normalized = {};
  for (const [symbol, item] of Object.entries(rawObj)) {
    if (!item || typeof item !== "object") continue;
    let tier = item.accessTier;
    if (!tier) {
      if (L0_ONLY_SYMBOLS.has(symbol)) tier = "L0";
      else if (L1_PRO_SYMBOLS.has(symbol)) tier = "L0+L1";
      else tier = "L0+L1";
    }
    normalized[symbol] = { ...item, accessTier: tier };
  }
  return normalized;
}

function bindMeshFilters() {
  const btns = document.querySelectorAll(".filter-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.getAttribute("data-filter") || "all";
      renderMatrixGrid();
    });
  });
}

function renderMatrixGrid() {
  const grid = document.getElementById("meshGrid");
  if (!grid) return;

  const entries = Object.entries(matrixProjects).filter(([symbol, item]) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "L0") return item.accessTier === "L0" || L0_ONLY_SYMBOLS.has(symbol);
    if (activeFilter === "L0+L1") return item.accessTier === "L0+L1" || L1_PRO_SYMBOLS.has(symbol);
    return true;
  });

  if (entries.length === 0) {
    grid.innerHTML = `<p style="color:#64748b;font-size:0.86rem;">目前此分類尚無已點亮元素模組。</p>`;
    return;
  }

  grid.innerHTML = entries
    .map(([symbol, item]) => {
      const isCurrent = symbol === "Ti";
      const targetUrl = item.url || "https://hao-element-matrix.pages.dev/";
      const tierLabel = item.accessTier === "L0" ? "純 L0 公共服務" : "L0 + L1 專業工具";
      return `
        <a
          href="${escapeHtml(targetUrl)}"
          target="${isCurrent ? "_self" : "_blank"}"
          rel="noopener noreferrer"
          class="mesh-card ${isCurrent ? "is-current" : ""}"
        >
          <div class="mesh-card-top">
            <div class="mesh-symbol-box">
              <span class="mesh-symbol">${escapeHtml(symbol)}</span>
              <span class="mesh-tier-pill">${escapeHtml(tierLabel)}</span>
            </div>
            <span class="mesh-tier-pill">${isCurrent ? "★ 當前所在模組" : escapeHtml(item.statusLabel || "LIVE")}</span>
          </div>
          <h3>${escapeHtml(item.title || symbol)}</h3>
          <p>${escapeHtml(item.description || "")}</p>
          <span class="mesh-card-footer">${isCurrent ? "目前檢視中（Ti · 22）" : "前往模組 ↗"}</span>
        </a>
      `;
    })
    .join("");
}

// ==================== 5. Block 05 一鍵複製引用文案與 Toast ====================
function bindCopyCitation() {
  const btn = document.getElementById("btnCopyCitation");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const textEl = document.getElementById("citationText");
    const text = textEl ? textEl.textContent.trim() : "";
    if (!text) return;

    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (_) {
        copied = false;
      }
    }

    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch (_) {
        copied = false;
      }
      textarea.remove();
    }

    if (copied) {
      showToast("✅ 已複製 MRV 查證引用聲明至剪貼簿！");
    } else {
      showToast("⚠️ 無法自動存取剪貼簿，請手動選取上方文字複製。");
    }
  });
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toastNotice");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
