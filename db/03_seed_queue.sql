WITH target_hubs AS (
    SELECT icao_code, iata_code
    FROM airports
    WHERE is_major_hub = TRUE
      AND country_code != 'TW'
      AND icao_code ~ '^[A-Z]{4}$'
      AND iata_code ~ '^[A-Z]{3}$'
),
modes AS (
    SELECT 'CARGO'::VARCHAR(15) AS transport_mode
    UNION ALL
    SELECT 'PASSENGER'::VARCHAR(15) AS transport_mode
),
bidirectional_routes AS (
    SELECT 'RCTP' AS origin_icao, h.icao_code AS dest_icao, m.transport_mode
    FROM target_hubs h CROSS JOIN modes m
    UNION ALL
    SELECT h.icao_code AS origin_icao, 'RCTP' AS dest_icao, m.transport_mode
    FROM target_hubs h CROSS JOIN modes m
)
INSERT INTO scrape_queue (origin_icao, dest_icao, transport_mode, status, request_count)
SELECT origin_icao, dest_icao, transport_mode, 'PENDING', 10
FROM bidirectional_routes
ON CONFLICT (origin_icao, dest_icao, transport_mode) DO NOTHING;

CREATE OR REPLACE VIEW v_scrape_queue_tasks AS
SELECT 
    q.id AS queue_id,
    q.transport_mode,
    q.status,
    q.request_count,
    q.origin_icao,
    ao.iata_code AS origin_iata,
    ao.name_zh AS origin_name_zh,
    q.dest_icao,
    ad.iata_code AS dest_iata,
    ad.name_zh AS dest_name_zh
FROM scrape_queue q
JOIN airports ao ON q.origin_icao = ao.icao_code
JOIN airports ad ON q.dest_icao = ad.icao_code
WHERE q.status = 'PENDING'
  AND q.retry_count < 3
ORDER BY q.request_count DESC, q.created_at ASC;
