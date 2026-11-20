-- ==========================================
-- 1. 全球機場字典表 (供前端模糊搜尋與 GCD 試算)
-- ==========================================
CREATE TABLE IF NOT EXISTS airports (
    icao_code VARCHAR(4) PRIMARY KEY,
    iata_code VARCHAR(3),
    name_zh VARCHAR(100),
    name_en VARCHAR(150) NOT NULL,
    city_zh VARCHAR(50),
    country_code VARCHAR(2) NOT NULL,
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    is_major_hub BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata_code);
CREATE INDEX IF NOT EXISTS idx_airports_hub ON airports(is_major_hub) WHERE is_major_hub = TRUE;

-- ==========================================
-- 2. 核心航線碳排與 R2 憑證主表 (貨運 + 差旅合一)
-- ==========================================
CREATE TABLE IF NOT EXISTS icao_routes_cache (
    id BIGSERIAL PRIMARY KEY,
    origin_icao VARCHAR(4) NOT NULL REFERENCES airports(icao_code),
    dest_icao VARCHAR(4) NOT NULL REFERENCES airports(icao_code),
    transport_mode VARCHAR(15) NOT NULL CHECK (transport_mode IN ('CARGO', 'PASSENGER')),
    cabin_class VARCHAR(50) NOT NULL DEFAULT 'CARGO_1KG',
    distance_km INTEGER NOT NULL,
    fuel_burn_kg INTEGER,
    co2_kg NUMERIC(10, 4) NOT NULL,
    data_source VARCHAR(50) NOT NULL DEFAULT 'ICAO_OFFICIAL',
    icao_method_version VARCHAR(100) DEFAULT 'Cargo v2.0 / Pax v13.1',
    r2_image_url TEXT,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_route_mode_cabin UNIQUE (origin_icao, dest_icao, transport_mode, cabin_class)
);

CREATE INDEX IF NOT EXISTS idx_routes_lookup 
ON icao_routes_cache(origin_icao, dest_icao, transport_mode);

-- ==========================================
-- 3. 冷門航線「排隊補圖」佇列表 (On-Demand Queue)
-- ==========================================
CREATE TABLE IF NOT EXISTS scrape_queue (
    id BIGSERIAL PRIMARY KEY,
    origin_icao VARCHAR(4) NOT NULL REFERENCES airports(icao_code),
    dest_icao VARCHAR(4) NOT NULL REFERENCES airports(icao_code),
    transport_mode VARCHAR(15) NOT NULL CHECK (transport_mode IN ('CARGO', 'PASSENGER')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    request_count INTEGER NOT NULL DEFAULT 1,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_log TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_queue_route UNIQUE (origin_icao, dest_icao, transport_mode)
);

CREATE INDEX IF NOT EXISTS idx_queue_priority 
ON scrape_queue(status, request_count DESC, created_at ASC) 
WHERE status = 'PENDING';
