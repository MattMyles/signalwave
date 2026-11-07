// Reads the Supabase project address and public key from environment
// variables (set in Vercel → Settings → Environment Variables). Accepts the
// names the Supabase/Vercel integrations create as well as plain ones, and
// tolerates stray quotes, spaces or a pasted "/rest/v1/" path.
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();

// Finds a variable by name, ignoring case and stray spaces in the name itself.
function envAny(names) {
  const wanted = names.map((n) => n.toUpperCase());
  for (const [k, v] of Object.entries(process.env)) {
    if (wanted.includes(k.trim().toUpperCase()) && clean(v)) return clean(v);
  }
  return '';
}
const URL_NAMES = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const KEY_NAMES = ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

// True for a secret/service key, which must never be handed to browsers.
function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role'; } catch (_) { /* not a JWT */ }
  }
  return false;
}

function projectUrl() {
  const rawUrl = envAny(URL_NAMES);
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (/\.supabase\.(co|in)$/i.test(u.hostname)) return `https://${u.hostname.toLowerCase()}`;
  } catch (_) { /* not a URL */ }
  return '';
}

function supabaseEnv() {
  const rawUrl = envAny(URL_NAMES);
  const key = envAny(KEY_NAMES);
  if (isSecretKey(key)) return null; // refuse to publish a secret key
  const url = rawUrl ? projectUrl() : '';
  return url && key ? { url, key } : null;
}

// What's missing, for the setup check at /api/config (never reveals values).
function supabaseEnvProblem() {
  const e = process.env;
  const hasUrl = Boolean(envAny(URL_NAMES));
  const hasKey = Boolean(envAny(KEY_NAMES));
  // Names only, never values, so a typo in a name is easy to spot.
  const seen = Object.keys(e).filter((k) => /supa|anon|publish/i.test(k)).map((k) => JSON.stringify(k)).join(', ') || 'none';
  if (!hasUrl && !hasKey) return 'SUPABASE_URL and SUPABASE_ANON_KEY are not set (add them in Vercel, then redeploy)';
  if (!hasUrl) return `SUPABASE_URL is not set or is empty. Supabase-related variable names this deployment can see: ${seen}`;
  if (!hasKey) return `SUPABASE_ANON_KEY is not set or is empty. Supabase-related variable names this deployment can see: ${seen}`;
  if (isSecretKey(envAny(KEY_NAMES))) return 'SUPABASE_ANON_KEY holds a SECRET key. Use the publishable/anon key there; the secret key only goes in SUPABASE_SERVICE_ROLE_KEY.';
  return 'SUPABASE_URL is not a Supabase project address (should look like https://abcd1234.supabase.co)';
}

// Server-only settings for the admin dashboard and play log. These are never
// sent to browsers.
function serviceEnv() {
  const url = projectUrl();
  const key = envAny(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_KEY']);
  return url && key ? { url, key } : null;
}
function adminEmails() {
  return envAny(['ADMIN_EMAILS', 'ADMIN_EMAIL']).toLowerCase().split(/[\s,;]+/).filter(Boolean);
}

// Headers for Supabase's REST/Auth APIs. New-style keys (sb_...) go only in
// the apikey header; old-style JWT keys also go in Authorization.
function sbHeaders(key, userToken) {
  const h = { apikey: key };
  if (userToken) h.Authorization = `Bearer ${userToken}`;
  else if (key.split('.').length === 3) h.Authorization = `Bearer ${key}`;
  return h;
}

// Checks a signed-in user's access token with Supabase and returns the user,
// or null. Results are cached briefly so repeated calls stay cheap.
const userCache = new Map();
async function verifyUser(token) {
  const env = supabaseEnv();
  if (!env || !token || token.length > 4096) return null;
  const hit = userCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const r = await fetch(`${env.url}/auth/v1/user`, { headers: sbHeaders(env.key, token), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const u = await r.json();
    const user = u && u.id ? { id: u.id, email: String(u.email || '').toLowerCase() } : null;
    if (userCache.size > 500) userCache.clear();
    userCache.set(token, { user, until: Date.now() + 5 * 60 * 1000 });
    return user;
  } catch (_) {
    return null;
  }
}

module.exports = { supabaseEnv, supabaseEnvProblem, serviceEnv, adminEmails, sbHeaders, verifyUser, isSecretKey };
