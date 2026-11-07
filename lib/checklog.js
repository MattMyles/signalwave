// Saves each station's latest check result to Supabase (station_checks) for
// the dashboard's "Station checks" panel. Best-effort: if the secret key
// isn't set or Supabase is slow, picking stations carries on unaffected.
const { serviceEnv, sbHeaders } = require('./supabase-env');

async function recordChecks(rows) {
  const env = serviceEnv();
  if (!env || !rows.length) return;
  try {
    await fetch(`${env.url}/rest/v1/rpc/record_checks`, {
      method: 'POST',
      headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows.slice(0, 500) }),
      signal: AbortSignal.timeout(2500),
    });
  } catch (_) { /* stats only */ }
}

module.exports = { recordChecks };
