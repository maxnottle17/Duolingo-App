// All settings come from environment variables (see .env.example).
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env = process.env) {
  return {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    dbPath: env.DB_PATH || './data/tracker.db',
    // Protects adding/removing friends and manual refreshes. Strongly recommended
    // once the app is reachable from the internet.
    adminToken: env.ADMIN_TOKEN || '',
    // How often to pull fresh XP from Duolingo.
    fetchIntervalHours: num(env.FETCH_INTERVAL_HOURS, 3),
    // Pause between friends during a refresh, to stay gentle on Duolingo.
    fetchDelayMs: env.FETCH_DELAY_MS !== undefined ? Number(env.FETCH_DELAY_MS) : 2000,
    // DUO_MOCK=1 generates fake profiles instead of calling Duolingo (for trying the app out).
    mock: env.DUO_MOCK === '1' || env.DUO_MOCK === 'true',
  };
}
