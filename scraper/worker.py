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

BATCH_LIMIT = int(os.getenv("BATCH_LIMIT", "15"))
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
    await page.goto("https://icec.icao.int/calculator", timeout=45000, wait_until="networkidle")
    await page.wait_for_timeout(1500)

    inputs = await page.locator("input").all()
    if len(inputs) < 2:
        raise RuntimeError("無法定位 ICAO 貨運計算機輸入框")

    await inputs[0].click()
    await inputs[0].fill(origin_icao)
    await page.wait_for_timeout(1000)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await inputs[1].click()
    await inputs[1].fill(dest_icao)
    await page.wait_for_timeout(1000)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    for inp in inputs[2:]:
        placeholder = (await inp.get_attribute("placeholder") or "").lower()
        t_type = (await inp.get_attribute("type") or "").lower()
        if "weight" in placeholder or t_type == "number":
            await inp.fill("1")
            break

    calc_btn = page.locator("button:has-text('Calculate'), button:has-text('CALCULATE')").first
    if await calc_btn.count() > 0:
        await calc_btn.click()
    else:
        await page.keyboard.press("Enter")

    await page.wait_for_selector("text=Summary", timeout=20000)
    await page.wait_for_timeout(1500)

    metric_btn = page.locator("button:has-text('Metric')").first
    if await metric_btn.count() > 0:
        await metric_btn.click()
        await page.wait_for_timeout(800)

    body_text = await page.inner_text("body")
    dist_m = re.search(r"Total Trip Distance[\s\S]*?([\d,]+)\s*KM", body_text, re.I)
    fuel_m = re.search(r"Total Aircraft Fuel Burn[\s\S]*?([\d,]+)\s*KG", body_text, re.I)
    co2_m = re.search(r"Total shipment CO[\s\S]*?([\d\.]+)\s*KG", body_text, re.I)

    if not (dist_m and fuel_m and co2_m):
        raise RuntimeError("無法解析 ICAO 官網回傳之距離/油耗/碳排數值")

    dist_km = int(dist_m.group(1).replace(",", ""))
    fuel_kg = int(fuel_m.group(1).replace(",", ""))
    co2_kg = float(co2_m.group(1))

    summary_box = page.locator("text=Summary").locator("..").locator("..")
    if await summary_box.count() > 0:
        await summary_box.first.screenshot(path=local_img_path)
    else:
        await page.screenshot(path=local_img_path, clip={"x": 20, "y": 200, "width": 1200, "height": 360})

    return [{
        "cabin_class": "CARGO_1KG",
        "distance_km": dist_km,
        "fuel_burn_kg": fuel_kg,
        "co2_kg": co2_kg,
    }]


async def process_queue():
    conn = psycopg2.connect(NEON_URL)
    conn.autocommit = False

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM v_scrape_queue_tasks WHERE transport_mode = 'CARGO' LIMIT %s;", (BATCH_LIMIT,))
        tasks = cur.fetchall()

    if not tasks:
        print("✅ 目前佇列中沒有待處理的航線。")
        conn.close()
        return

    print(f"🚀 本次預計抓取 {len(tasks)} 條官方航線...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_ratio=2)
        page = await context.new_page()

        for task in tasks:
            qid = task["queue_id"]
            orig = task["origin_icao"]
            dest = task["dest_icao"]
            mode = task["transport_mode"]
            local_img = os.path.join(TMP_DIR, f"{mode}_{orig}_{dest}.png")
            r2_key = f"{mode.lower()}/{orig}_{dest}_1KG.png"

            try:
                print(f"⏳ 處理中: {orig} -> {dest} ({mode})...")
                results = await scrape_cargo_route(page, orig, dest, local_img)
                r2_url = upload_to_r2(local_img, r2_key)

                with conn.cursor() as cur:
                    for item in results:
                        cur.execute(
                            '''
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
                            ''',
                            (orig, dest, mode, item["cabin_class"], item["distance_km"], item["fuel_burn_kg"], item["co2_kg"], r2_url),
                        )
                    cur.execute("UPDATE scrape_queue SET status = 'COMPLETED', updated_at = NOW() WHERE id = %s;", (qid,))
                conn.commit()
                print(f"✅ 完成: {orig} -> {dest} | R2: {r2_url}")

            except Exception as e:
                conn.rollback()
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE scrape_queue SET retry_count = retry_count + 1, error_log = %s, updated_at = NOW() WHERE id = %s;",
                        (str(e)[:500], qid),
                    )
                conn.commit()
                print(f"❌ 失敗 ({orig} -> {dest}): {e}")
            finally:
                if os.path.exists(local_img):
                    os.remove(local_img)

        await browser.close()
    conn.close()


if __name__ == "__main__":
    asyncio.run(process_queue())
