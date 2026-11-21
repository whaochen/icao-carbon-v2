import os
import re
import sys
import psycopg2

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def resolve_neon_url() -> str:
    env_url = os.getenv("NEON_DATABASE_URL", "")
    if env_url and "ep-xxx" not in env_url and env_url.startswith("postgresql://"):
        return env_url.split("&channel_binding")[0]

    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                m = re.search(r"(postgresql://[^\s\"']+)", line)
                if m and "ep-xxx" not in m.group(1):
                    return m.group(1).split("&channel_binding")[0]

    raise RuntimeError("找不到有效的 NEON_DATABASE_URL，請檢查 .env 檔案。")


def main():
    dry_run = "--dry-run" in sys.argv
    sql_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "db",
        "04_seed_tw_and_cn_hubs.sql",
    )

    with open(sql_path, "r", encoding="utf-8") as f:
        full_sql = f.read()

    # 依分段標記切割 SQL 以統計各階段新增數量
    _, rest1 = full_sql.split("-- [SECTION_1_AIRPORTS]", 1)
    sql_airports, rest2 = rest1.split("-- [SECTION_2_RULE_A]", 1)
    sql_rule_a, sql_rule_b = rest2.split("-- [SECTION_3_RULE_B]", 1)

    db_url = resolve_neon_url()
    conn = psycopg2.connect(db_url)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM airports;")
            before_airports = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM icao_routes_cache;")
            cached_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM scrape_queue;")
            before_queue = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM scrape_queue WHERE status = 'PENDING';")
            before_pending = cur.fetchone()[0]

            # 1. 執行擴充 airports
            cur.execute(sql_airports)
            cur.execute("SELECT COUNT(*) FROM airports;")
            after_airports = cur.fetchone()[0]
            added_airports = after_airports - before_airports

            # 2. 執行規則 A (台灣三機場完整雙向航線, request_count = 50)
            cur.execute(sql_rule_a)
            cur.execute("SELECT COUNT(*) FROM scrape_queue;")
            after_rule_a_queue = cur.fetchone()[0]
            added_rule_a = after_rule_a_queue - before_queue

            # 3. 執行規則 B (中國大陸核心機場 + HKG 雙向航線, request_count = 20)
            cur.execute(sql_rule_b)
            cur.execute("SELECT COUNT(*) FROM scrape_queue;")
            after_rule_b_queue = cur.fetchone()[0]
            added_rule_b = after_rule_b_queue - after_rule_a_queue

            cur.execute("SELECT COUNT(*) FROM scrape_queue WHERE status = 'PENDING';")
            after_pending = cur.fetchone()[0]

            print("==========================================================")
            print(f"📊 04_seed_tw_and_cn_hubs.sql 執行統計 ({'DRY-RUN 預覽 (未提交)' if dry_run else '已正式寫入 Neon'})")
            print("==========================================================")
            print(f"✈️ 全球機場字典 (airports)：原本 {before_airports} 座 -> 擴充後 {after_airports} 座 (本次新增 +{added_airports} 座)")
            print(f"✅ 已收錄官方快取 (icao_routes_cache)：{cached_count} 條 (已排除不重複排隊)")
            print(f"🔥 規則 A [台灣三機場 TPE/KHH/TSA 雙向航線, priority=50]：新增 +{added_rule_a} 條待抓航線")
            print(f"🏭 規則 B [大陸 26 座核心樞紐 + HKG 雙向航線, priority=20]：新增 +{added_rule_b} 條待抓航線")
            print(f"📌 佇列總計 (scrape_queue)：原本 {before_queue} 條 (待抓 {before_pending}) -> 擴充後 {after_rule_b_queue} 條 (待抓 {after_pending})")
            print("==========================================================")

            if dry_run:
                conn.rollback()
            else:
                conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


if __name__ == "__main__":
    main()
