// GET /api/admin-stats — numbers for the private dashboard (/admin).
// Requires a signed-in user whose email is listed in the ADMIN_EMAILS
// environment variable. Everyone else gets 403 and no data.
const { serviceEnv, adminEmails, sbHeaders, verifyUser } = require('../lib/supabase-env');
const { query, sendJson, bearer } = require('../lib/http');
const { directoryStats } = require('../lib/radio');

module.exports = async function handler(req, res) {
  const user = await verifyUser(bearer(req));
  if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
  const admins = adminEmails();
  if (!admins.length) return sendJson(res, 503, { error: 'No admin set. Add ADMIN_EMAILS in Vercel, then redeploy.' });
  if (!admins.includes(user.email)) return sendJson(res, 403, { error: 'This account is not allowed to view the dashboard.' });

  const env = serviceEnv();
  if (!env) return sendJson(res, 503, { error: 'Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.' });

  const tz = (query(req).get('tz') || 'America/New_York').replace(/[^A-Za-z0-9_+\-/]/g, '').slice(0, 64);
  const rpc = (fn, body) => fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  try {
    const [r, rc, directory] = await Promise.all([
      rpc('admin_stats', { tz }),
      rpc('admin_check_stats', {}).catch(() => null),
      directoryStats(),
    ]);
    if (!r.ok) {
      const detail = r.status === 404 ? 'The admin_stats function is missing. Run the plays migration in Supabase.' : `Supabase answered ${r.status}.`;
      return sendJson(res, 502, { error: detail });
    }
    // Station checks are optional: missing until their migration has been run.
    const checks = rc && rc.ok ? await rc.json() : null;
    sendJson(res, 200, { email: user.email, stats: await r.json(), checks, directory });
  } catch (_) {
    sendJson(res, 502, { error: 'Supabase did not answer. Try again.' });
  }
};
