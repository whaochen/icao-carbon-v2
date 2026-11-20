# ICAO 航空碳排與官方憑證系統 (v2 - Neon + R2 + Cloudflare)

## 快速啟動 3 步驟
1. **建立資料庫**：將 `db/01_schema.sql`、`02_seed_airports.sql`、`03_seed_queue.sql` 依序貼入 Neon SQL Editor 執行。
2. **填入環境變數**：複製 `.env.example` 為 `.env`（本機用），並將同樣的 6 個變數設定到 GitHub Repository 的 `Settings -> Secrets and variables -> Actions`。
3. **啟動背景抓圖**：推送至 GitHub 後，進入 `Actions -> Scrape Real ICAO Data to Neon & R2 -> Run workflow` 即可自動抓取官方原圖存入 Cloudflare R2 並寫入 Neon。
