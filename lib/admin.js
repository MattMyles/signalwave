// "Is this request from an admin?" — one check for everything only the admin may do
// (the /admin dashboard, certifying stations). A signed-in user whose email is listed in the
// ADMIN_EMAILS environment variable; everyone else is turned away.
const { adminEmails, verifyUser } = require('./supabase-env');
const { bearer } = require('./http');

/**
 * -> { ok: true, user } for an admin, or { ok: false, status, error } to send back as it is:
 * 401 not signed in, 503 no admin configured, 403 signed in but not an admin.
 * deniedMessage: what a non-admin is told (the dashboard and certifying word it differently).
 */
async function requireAdmin(req, deniedMessage = 'This account is not allowed to do that.') {
  const user = await verifyUser(bearer(req));
  if (!user) return { ok: false, status: 401, error: 'Sign in first.' };
  const admins = adminEmails();
  if (!admins.length) return { ok: false, status: 503, error: 'No admin set. Add ADMIN_EMAILS in Vercel, then redeploy.' };
  if (!admins.includes(user.email)) return { ok: false, status: 403, error: deniedMessage };
  return { ok: true, user };
}

/** True when the request carries a signed-in admin's token (never throws; for "show the control?" questions). */
async function isAdminRequest(req) {
  try { return (await requireAdmin(req)).ok; } catch (_) { return false; }
}

module.exports = { requireAdmin, isAdminRequest };
