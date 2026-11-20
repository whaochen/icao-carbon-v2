import os
import re
import asyncio
import boto3
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from playwright.async_api import async_playwright

load_dotenv()

NEON_URL = os.getenv("NEON_DATABASE_URL")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.getenv("R2_BUCKET_NAME", "icao-screenshots")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "").rstrip("/")

BATCH_LIMIT = int(os.getenv("BATCH_LIMIT", "20"))
TMP_DIR = "tmp_screenshots"
os.makedirs(TMP_DIR, exist_ok=True)


def get_r2_client():
    return boto3.client(
        service_name="s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )


def upload_to_r2(local_path: str, object_key: str) -> str:
    s3 = get_r2_client()
    s3.upload_file(
        local_path,
        R2_BUCKET,
        object_key,
        ExtraArgs={"ContentType": "image/png"},
    )
    return f"{R2_PUBLIC_URL}/{object_key}"


async def scrape_cargo_route(page, origin_icao: str, dest_icao: str, local_img_path: str):
    """
    透過 ICAO 官方計算機 (Freighter 模式) 抓取真實距離、整機油耗、每公斤碳排與完整 Flight Stage Detail 截圖
    """
    await page.goto("https://icec.icao.int/calculator", timeout=60000, wait_until="domcontentloaded")
    await page.wait_for_selector("#freighterButton", timeout=30000)

    # 1. 切換至 Freighter (CARGO) 分頁
    await page.click("#freighterButton")
    await page.wait_for_timeout(500)

    # 2. 使用 jQuery Select2 API 直接設定起訖 ICAO 4 碼並觸發 change 事件
    has_airports = await page.evaluate(
        """([orig, dest]) => {
            const $dep = $('#SelectFreighterDeparture');
            const $dst = $('#SelectFreighterDestination');
            if ($dep.find(`option[value="${orig}"]`).length === 0) return { ok: false, missing: orig };
            $dep.val(orig).trigger('change');
            if ($dst.find(`option[value="${dest}"]`).length === 0) return { ok: false, missing: dest };
            $dst.val(dest).trigger('change');
            $('#freighterWeightTextBox').val('1000').trigger('input').trigger('change');
            $('#activeTabHidden').val('Freighter');
            return { ok: true };
        }""",
        [origin_icao, dest_icao],
    )

    if not has_airports.get("ok"):
        raise RuntimeError(f"ICAO 官網 Freighter 清單無此機場代碼: {has_airports.get('missing')}")

    # 3. 點擊 Calculate 按鈕並等待結果區塊 #ResultDivFreighterMetric 渲染完成
    await page.click("#calculateButton")

    await page.wait_for_function(
        """() => {
            const el = document.querySelector('#ResultDivFreighterMetric');
            return el && el.innerText && el.innerText.includes('Total Trip Distance');
        }""",
        timeout=30000,
    )

    # 確保切換在 Metric (KG / KM) 分頁且顯示完整區塊
    await page.evaluate(
        """() => {
            $('#metricButton').trigger('click');
            $('#ResultDivFreighterMetric').show();
        }"""
    )
    await page.wait_for_timeout(800)

    result_locator = page.locator("#ResultDivFreighterMetric")
    result_text = await result_locator.inner_text()

    # 解析 ICAO 官網回傳數值 (支援千分位逗號與小數點)
    dist_m = re.search(r"Total Trip Distance[\s\S]*?([\d,]+)\s*KM", result_text, re.I)
    fuel_m = re.search(r"Total Aircraft Fuel Burn[\s\S]*?([\d,]+)\s*KG", result_text, re.I)
    co2_m = re.search(r"Total shipment CO[\s\S]*?([\d,]+\.?\d*)\s*KG", result_text, re.I)

    if not (dist_m and fuel_m and co2_m):
        raise RuntimeError(f"無法解析 ICAO 官網 Freighter 數值: {result_text[:300]}")

    dist_km = int(float(dist_m.group(1).replace(",", "")))
    fuel_kg = int(float(fuel_m.group(1).replace(",", "")))
    # 我們輸入 1000 KG 以獲得更高精度的官方總碳排，再除以 1000 存入每 1 KG 單位係數 (例如 5030.00 / 1000 = 5.0300)
    co2_for_1000kg = float(co2_m.group(1).replace(",", ""))
    unit_co2_per_kg = round(co2_for_1000kg / 1000.0, 4)

    # 4. 截取包含 Summary 與下方 Flight Stage Detail (轉機航段、機型、分段油耗) 的完整官方憑證圖
    await result_locator.screenshot(path=local_img_path)

    return [
        {
            "cabin_class": "CARGO_1KG",
            "distance_km": dist_km,
            "fuel_burn_kg": fuel_kg,
            "co2_kg": unit_co2_per_kg,
        }
    ]


async def scrape_passenger_route(page, origin_iata: str, dest_iata: str, local_img_path: str):
    """
    透過 ICAO 官方計算機 (Passenger 模式) 抓取單程 (One Way) 客運距離、油耗、碳排與完整 Flight Stage Detail 截圖
    """
    await page.goto("https://icec.icao.int/calculator", timeout=60000, wait_until="domcontentloaded")
    await page.wait_for_selector("#passengerButton", timeout=30000)

    await page.click("#passengerButton")
    await page.wait_for_timeout(500)

    # 1. 設定起飛機場 (IATA 3 碼) 並呼叫官網 PassengerGetAirportsByDeparture 載入目的機場清單
    dep_ok = await page.evaluate(
        """(orig) => {
            const $dep = $('#SelectPassengerDeparture');
            const $opt = $dep.find(`option[value="${orig}"]`);
            if ($opt.length === 0) return false;
            const isSaf = $opt.data('saf');
            $dep.val(orig).trigger('change');
            PassengerGetAirportsByDeparture(orig, isSaf, 'Departure');
            return true;
        }""",
        origin_iata,
    )
    if not dep_ok:
        raise RuntimeError(f"ICAO 官網 Passenger 起飛清單無此機場: {origin_iata}")

    # 等待目的機場選單 #SelectPassengerDestination1 載入完成
    await page.wait_for_function(
        """(dest) => {
            const $dst = $('#SelectPassengerDestination1');
            return $dst.find('option').length > 1;
        }""",
        dest_iata,
        timeout=20000,
    )

    dest_ok = await page.evaluate(
        """(dest) => {
            const $dst = $('#SelectPassengerDestination1');
            if ($dst.find(`option[value="${dest}"]`).length === 0) return false;
            $dst.val(dest).trigger('change');
            $('#numberPassengersTextBox').val('1');
            $('#inputCabinClassSelect').val('Economy').trigger('change');
            $('#tripSelect .trip-button[data-value="One Way"]').trigger('click');
            $('#activeTabHidden').val('Passenger');
            return true;
        }""",
        dest_iata,
    )
    if not dest_ok:
        raise RuntimeError(f"ICAO 官網 Passenger 航線不支援從 {origin_iata} 飛往 {dest_iata}")

    await page.click("#calculateButton")

    await page.wait_for_function(
        """() => {
            const el = document.querySelector('#ResultDivPassengerEconomyMetric');
            return el && el.innerText && el.innerText.includes('KM');
        }""",
        timeout=30000,
    )

    await page.evaluate(
        """() => {
            $('#metricButton').trigger('click');
            $('#resultCabinClassSelect').val('Economy').trigger('change');
            $('#ResultDivPassengerEconomyMetric').show();
        }"""
    )
    await page.wait_for_timeout(800)

    result_locator = page.locator("#ResultDivPassengerEconomyMetric")
    result_text = await result_locator.inner_text()

    dist_m = re.search(r"Total Trip Distance[\s\S]*?([\d,]+)\s*KM", result_text, re.I) or re.search(
        r"([\d,]+)\s*KM", result_text, re.I
    )
    fuel_m = re.search(r"Fuel Burn[\s\S]*?([\d,]+\.?\d*)\s*KG", result_text, re.I)
    co2_m = re.search(r"CO2[\s\S]*?([\d,]+\.?\d*)\s*KG", result_text, re.I)

    if not (dist_m and co2_m):
        raise RuntimeError(f"無法解析 ICAO 官網 Passenger 數值: {result_text[:300]}")

    dist_km = int(float(dist_m.group(1).replace(",", "")))
    fuel_kg = int(float(fuel_m.group(1).replace(",", ""))) if fuel_m else None
    co2_kg = round(float(co2_m.group(1).replace(",", "")), 4)

    await result_locator.screenshot(path=local_img_path)

    return [
        {
            "cabin_class": "ECONOMY",
            "distance_km": dist_km,
            "fuel_burn_kg": fuel_kg,
            "co2_kg": co2_kg,
        }
    ]


async def process_queue():
    conn = psycopg2.connect(NEON_URL)
    conn.autocommit = False

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT * FROM v_scrape_queue_tasks
            ORDER BY (transport_mode = 'CARGO') DESC, request_count DESC
            LIMIT %s;
            """,
            (BATCH_LIMIT,),
        )
        tasks = cur.fetchall()

    if not tasks:
        print("✅ 目前佇列中沒有待處理的航線。")
        conn.close()
        return

    print(f"🚀 本次預計抓取 {len(tasks)} 條 ICAO 官方航線與原圖...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1360, "height": 1200}, device_scale_factor=2)
        page = await context.new_page()

        for task in tasks:
            qid = task["queue_id"]
            orig_icao = task["origin_icao"]
            dest_icao = task["dest_icao"]
            orig_iata = task.get("origin_iata") or orig_icao
            dest_iata = task.get("dest_iata") or dest_icao
            mode = task["transport_mode"]

            local_img = os.path.join(TMP_DIR, f"{mode}_{orig_icao}_{dest_icao}.png")
            suffix = "1000KG" if mode == "CARGO" else "ECONOMY"
            r2_key = f"{mode.lower()}/{orig_icao}_{dest_icao}_{suffix}.png"

            try:
                print(f"⏳ 處理中: {orig_icao} ({orig_iata}) -> {dest_icao} ({dest_iata}) [{mode}]...")
                if mode == "CARGO":
                    results = await scrape_cargo_route(page, orig_icao, dest_icao, local_img)
                else:
                    results = await scrape_passenger_route(page, orig_iata, dest_iata, local_img)

                r2_url = upload_to_r2(local_img, r2_key)

                with conn.cursor() as cur:
                    for item in results:
                        cur.execute(
                            """
                            INSERT INTO icao_routes_cache
                                (origin_icao, dest_icao, transport_mode, cabin_class, distance_km, fuel_burn_kg, co2_kg, data_source, r2_image_url, captured_at)
                            VALUES
                                (%s, %s, %s, %s, %s, %s, %s, 'ICAO_OFFICIAL', %s, NOW())
                            ON CONFLICT (origin_icao, dest_icao, transport_mode, cabin_class)
                            DO UPDATE SET
                                distance_km = EXCLUDED.distance_km,
                                fuel_burn_kg = EXCLUDED.fuel_burn_kg,
                                co2_kg = EXCLUDED.co2_kg,
                                data_source = 'ICAO_OFFICIAL',
                                r2_image_url = EXCLUDED.r2_image_url,
                                captured_at = NOW();
                            """,
                            (
                                orig_icao,
                                dest_icao,
                                mode,
                                item["cabin_class"],
                                item["distance_km"],
                                item["fuel_burn_kg"],
                                item["co2_kg"],
                                r2_url,
                            ),
                        )
                    cur.execute("UPDATE scrape_queue SET status = 'COMPLETED', error_log = NULL, updated_at = NOW() WHERE id = %s;", (qid,))
                conn.commit()
                print(f"✅ 完成: {orig_icao} -> {dest_icao} | 距離: {results[0]['distance_km']} KM | 單位CO2: {results[0]['co2_kg']} KG | R2: {r2_url}")

            except Exception as e:
                conn.rollback()
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE scrape_queue SET retry_count = retry_count + 1, error_log = %s, updated_at = NOW() WHERE id = %s;",
                        (str(e)[:500], qid),
                    )
                conn.commit()
                print(f"❌ 失敗 ({orig_icao} -> {dest_icao}): {e}")
            finally:
                if os.path.exists(local_img):
                    os.remove(local_img)

        await browser.close()
    conn.close()


if __name__ == "__main__":
    asyncio.run(process_queue())
