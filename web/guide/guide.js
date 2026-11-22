/**
 * 全球航空GHG排放計算器 (Ti · 22) — /guide 操作與實踐指引分頁控制器
 */

const CSV_TEMPLATE_TEXT = [
  "origin,destination,mode,weight_kg,passengers,cabin_class,ref_doc_id",
  "TPE,LAX,CARGO,1250,,CARGO_1KG,AWB-2026-001",
  "TPE,NRT,PASSENGER,,2,ECONOMY,TRV-2026-101",
].join("\n");

document.addEventListener("DOMContentLoaded", async () => {
  bindStatsRefresh();
  bindSubnavLinks();
  bindCopyCsvTemplate();
  bindFaqAccordion();

  await loadQueueStatus();
});

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

function bindSubnavLinks() {
  const links = document.querySelectorAll(".subnav-link");
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

function bindCopyCsvTemplate() {
  const btn = document.getElementById("btnCopyCsvHeader");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(CSV_TEMPLATE_TEXT);
        copied = true;
      } catch (_) {
        copied = false;
      }
    }

    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = CSV_TEMPLATE_TEXT;
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
      showToast("✅ 已複製批次 CSV 範本欄位與範例列至剪貼簿！");
    } else {
      showToast("⚠️ 無法自動存取剪貼簿，請手動複製表格欄位。");
    }
  });
}

function bindFaqAccordion() {
  const items = document.querySelectorAll(".faq-item");
  items.forEach((item) => {
    const btn = item.querySelector(".faq-question");
    const icon = item.querySelector(".faq-icon");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const isOpen = item.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(isOpen));
      if (icon) icon.textContent = isOpen ? "−" : "+";
    });
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
