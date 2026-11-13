// GET /api/admin-stats — numbers for the private dashboard (/admin).
// POST /api/admin-stats { action: 'review', ids: [1, 2], status: 'approved' | 'rejected' | 'pending' }
// — the admin's verdict on WRONG GENRE? reports (approved = agree, the station
// stops being served for that genre; rejected = dismiss).
// Requires a signed-in user whose email is listed in the ADMIN_EMAILS
// environment variable. Everyone else gets 403 and no data.
const { serviceEnv, adminEmails, sbHeaders, verifyUser } = require('../lib/supabase-env');
const { query, sendJson, readJson, bearer } = require('../lib/http');
const { forget } = require('../lib/reports');
const { directoryStats } = require('../lib/radio');

module.exports = async function handler(req, res) {
  const user = await verifyUser(bearer(req));
  if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
  const admins = adminEmails();
  if (!admins.length) return sendJson(res, 503, { error: 'No admin set. Add ADMIN_EMAILS in Vercel, then redeploy.' });
  if (!admins.includes(user.email)) return sendJson(res, 403, { error: 'This account is not allowed to view the dashboard.' });

  const env = serviceEnv();
  if (!env) return sendJson(res, 503, { error: 'Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.' });

  if (req.method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body && body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : [];
    const status = body && body.status;
    if (!body || body.action !== 'review' || !ids.length || !['approved', 'rejected', 'pending'].includes(status)) {
      return sendJson(res, 400, { error: 'Bad review.' });
    }
    try {
      const r = await fetch(`${env.url}/rest/v1/genre_reports?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status, reviewed_at: status === 'pending' ? null : new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return sendJson(res, 502, { error: `Supabase answered ${r.status}.` });
      forget();
      return sendJson(res, 200, { ok: true });
    } catch (_) {
      return sendJson(res, 502, { error: 'Supabase did not answer. Try again.' });
    }
  }

  const tz = (query(req).get('tz') || 'America/New_York').replace(/[^A-Za-z0-9_+\-/]/g, '').slice(0, 64);
  const rpc = (fn, body) => fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  try {
    const [r, rc, directory, rr] = await Promise.all([
      rpc('admin_stats', { tz }),
      rpc('admin_check_stats', {}).catch(() => null),
      directoryStats(),
      fetch(`${env.url}/rest/v1/genre_reports?select=id,station_uuid,station_name,genre_key,station_genre,song,city,country_code,status,created_at&order=created_at.desc&limit=150`, {
        headers: sbHeaders(env.key), signal: AbortSignal.timeout(10000),
      }).catch(() => null),
    ]);
    if (!r.ok) {
      const detail = r.status === 404 ? 'The admin_stats function is missing. Run the plays migration in Supabase.' : `Supabase answered ${r.status}.`;
      return sendJson(res, 502, { error: detail });
    }
    // Station checks are optional: missing until their migration has been run.
    const checks = rc && rc.ok ? await rc.json() : null;
    // Wrong-genre reports: missing until their migration has been run.
    const reports = rr && rr.ok ? await rr.json() : null;
    sendJson(res, 200, { email: user.email, stats: await r.json(), checks, directory, reports });
  } catch (_) {
    sendJson(res, 502, { error: 'Supabase did not answer. Try again.' });
  }
};
