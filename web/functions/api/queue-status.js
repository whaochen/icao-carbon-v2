import pg from "pg";

const { Client } = pg;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { env } = context;
  const dbUrl = env.NEON_DATABASE_URL;

  if (!dbUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: "尚未設定環境變數 NEON_DATABASE_URL" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const [cacheRes, queueRes, airportsRes, recentRes] = await Promise.all([
      client.query(`
        SELECT
          COUNT(*)::INT AS total_cached,
          COUNT(*) FILTER (WHERE transport_mode = 'CARGO')::INT AS cargo_cached,
          COUNT(*) FILTER (WHERE transport_mode = 'PASSENGER')::INT AS passenger_cached,
          COUNT(*) FILTER (WHERE r2_image_url IS NOT NULL AND r2_image_url <> '')::INT AS with_r2_image,
          MAX(captured_at) AS last_captured_at
        FROM icao_routes_cache;
      `),
      client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'PENDING')::INT AS pending_count,
          COUNT(*) FILTER (WHERE status = 'PROCESSING')::INT AS processing_count,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::INT AS completed_count,
          COUNT(*) FILTER (WHERE status = 'FAILED')::INT AS failed_count,
          COUNT(*)::INT AS total_queue
        FROM scrape_queue;
      `),
      client.query(`
        SELECT COUNT(*)::INT AS total_airports FROM airports;
      `),
      client.query(`
        SELECT
          c.origin_icao,
          ao.iata_code AS origin_iata,
          ao.city_zh AS origin_city_zh,
          c.dest_icao,
          ad.iata_code AS dest_iata,
          ad.city_zh AS dest_city_zh,
          c.transport_mode,
          c.cabin_class,
          c.distance_km,
          c.co2_kg::FLOAT AS co2_kg,
          c.r2_image_url,
          c.captured_at
        FROM icao_routes_cache c
        LEFT JOIN airports ao ON c.origin_icao = ao.icao_code
        LEFT JOIN airports ad ON c.dest_icao = ad.icao_code
        ORDER BY c.captured_at DESC
        LIMIT 8;
      `),
    ]);

    const cacheStats = cacheRes.rows[0] || {};
    const queueStats = queueRes.rows[0] || {};
    const airportStats = airportsRes.rows[0] || {};

    return new Response(
      JSON.stringify({
        ok: true,
        stats: {
          total_airports: airportStats.total_airports || 0,
          cached_routes: cacheStats.total_cached || 0,
          cargo_cached: cacheStats.cargo_cached || 0,
          passenger_cached: cacheStats.passenger_cached || 0,
          with_r2_image: cacheStats.with_r2_image || 0,
          last_captured_at: cacheStats.last_captured_at || null,
          queue_pending: queueStats.pending_count || 0,
          queue_processing: queueStats.processing_count || 0,
          queue_completed: queueStats.completed_count || 0,
          queue_failed: queueStats.failed_count || 0,
          queue_total: queueStats.total_queue || 0,
        },
        recent_routes: recentRes.rows,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  } finally {
    try {
      await client.end();
    } catch (_) {
      // ignore close error
    }
  }
}
