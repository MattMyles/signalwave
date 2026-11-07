// GET /api/keepalive — run once a day by Vercel (see "crons" in vercel.json).
// Free Supabase projects pause after 7 days without activity; this small
// query counts as activity. Row-level security means it reads no user data.
const { supabaseEnv } = require('../lib/supabase-env');
const { sendJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const env = supabaseEnv();
  if (!env) return sendJson(res, 200, { ok: false, reason: 'Supabase not configured' });
  try {
    const r = await fetch(`${env.url}/rest/v1/user_settings?select=user_id&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      signal: AbortSignal.timeout(8000),
    });
    sendJson(res, 200, { ok: r.status < 500, status: r.status });
  } catch (e) {
    sendJson(res, 200, { ok: false, reason: 'unreachable' });
  }
};
