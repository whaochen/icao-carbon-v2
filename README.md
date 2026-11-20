# ICAO 航空碳排與官方憑證系統 (v2.0 - Neon + R2 + Cloudflare Pages)

本系統為符合 **ISO 14064-1 範疇三（類別 4 上下游運輸與配送、類別 6 商務差旅）** 查證需求所設計之航空碳排 MRV 查證平台。

## 核心架構與設計鐵律
1. **零假預設值**：所有航線優先查詢 `icao_routes_cache` 官方快取；若尚未收錄，系統自動以 `airports` 真實經緯度計算 **Haversine 大圓距離 (Great-Circle Distance)** 並明確標示 `GCD_FALLBACK`，同時自動寫入 `scrape_queue` 排隊補抓官方截圖。
2. **零 AI Token 消耗**：所有查詢、試算、CSV 解析與 ZIP 憑證包打包皆由純演算法與前端 `JSZip` 完成，不呼叫任何 LLM API。
3. **MRV 查證可追溯**：每筆結果完整呈現 `data_source`、`captured_at`（官方截圖時間戳記）與 `r2_image_url`（Cloudflare R2 公開網址），支援一鍵打包下載官方原圖 `.png` + `carbon_report.csv` + `MRV_查證憑證說明書.txt`。

---

## 專案目錄結構

```text
icao-carbon-v2/
├── .github/workflows/
│   └── scrape_icao.yml          # GitHub Actions 自動排程與手動觸發 Playwright 抓圖 Worker
├── db/
│   ├── 01_schema.sql            # 資料表結構 (airports, icao_routes_cache, scrape_queue)
│   ├── 02_seed_airports.sql     # 全球主要貨運與差旅樞紐機場字典 (含真實經緯度)
│   └── 03_seed_queue.sql        # 初始熱門航線佇列與 v_scrape_queue_tasks 檢視表
├── scraper/
│   ├── requirements.txt         # Python 爬蟲依賴 (playwright, psycopg2-binary, boto3)
│   └── worker.py                # ICAO 官網計算機自動截圖並上傳 Cloudflare R2 與 Neon
└── web/                         # Cloudflare Pages 前端與 Pages Functions 後端
    ├── functions/api/
    │   ├── airports.js          # GET /api/airports (IATA/ICAO/中英機場模糊搜尋)
    │   ├── lookup.js            # GET & POST /api/lookup (單筆/批次查詢 + GCD 試算 + 自動入列)
    │   └── queue-status.js      # GET /api/queue-status (快取覆蓋率與待抓佇列統計)
    ├── index.html               # 雙模式互動介面 (單筆查詢預覽 + 批次 CSV & ZIP 一鍵打包)
    ├── styles.css               # 專業高對比永續查證介面樣式
    ├── app.js                   # 純前端控制器、CSV 解析器與 JSZip 打包引擎
    ├── package.json             # Node.js 依賴 (pg, wrangler)
    └── wrangler.toml            # Cloudflare Pages 本地開發與 nodejs_compat 設定
```

---

## 快速啟動與部署步驟

### 步驟 1：初始化 Neon PostgreSQL 資料庫
將 `db/01_schema.sql`、`db/02_seed_airports.sql`、`db/03_seed_queue.sql` 依序貼入 Neon SQL Editor 執行。

### 步驟 2：背景抓圖 Worker (GitHub Actions)
1. 於 GitHub Repository 的 `Settings -> Secrets and variables -> Actions` 設定：
   - `NEON_DATABASE_URL`
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET_NAME`
   - `R2_PUBLIC_URL`
2. 進入 GitHub `Actions -> Scrape Real ICAO Data to Neon & R2 -> Run workflow` 即可自動抓取 ICAO 官網原圖存入 Cloudflare R2 並寫入 Neon。

### 步驟 3：本機啟動 `web/` 前端與 API 測試
在終端機 (PowerShell) 執行：

```powershell
cd D:\Projects\icao-carbon-v2\web
npm install

# 建立本機 Wrangler 測試用的環境變數檔 .dev.vars (已被 .gitignore 排除不進 Git)
"NEON_DATABASE_URL=您的Neon資料庫連線字串" | Out-File -FilePath .dev.vars -Encoding utf8

# 啟動 Cloudflare Pages 本地開發伺服器 (http://localhost:8788)
npm run dev
```

### 步驟 4：部署至 Cloudflare Pages
#### 方法 A：連結 GitHub 自動部署（推薦）
1. 登入 Cloudflare Dashboard -> **Workers & Pages** -> **Create** -> **Pages** -> **Connect to Git**，選擇 `whaochen/icao-carbon-v2`。
2. **Build settings**：
   - **Root directory (根目錄)**：`web`
   - **Build command**：留空（或填 `npm install`）
   - **Build output directory**：`.`
3. **Environment variables & Compatibility flags**（於 Pages 專案 `Settings -> Functions` 及 `Environment variables`）：
   - 新增環境變數：`NEON_DATABASE_URL` = `您的 Neon PostgreSQL 連線字串`
   - 於 `Settings -> Functions -> Compatibility flags`（Production 與 Preview）加入：`nodejs_compat`

#### 方法 B：使用 Wrangler CLI 直接部署
```powershell
cd D:\Projects\icao-carbon-v2\web
npx wrangler pages deploy . --project-name icao-carbon-v2
```
*(首次部署後請至 Cloudflare Pages 後台設定 `NEON_DATABASE_URL` 環境變數與 `nodejs_compat` flag)*
