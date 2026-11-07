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

function supabaseEnv() {
  const rawUrl = envAny(URL_NAMES);
  const key = envAny(KEY_NAMES);
  let url = '';
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (/\.supabase\.(co|in)$/i.test(u.hostname)) url = `https://${u.hostname.toLowerCase()}`;
  } catch (_) { /* not a URL */ }
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
  return 'SUPABASE_URL is not a Supabase project address (should look like https://abcd1234.supabase.co)';
}

module.exports = { supabaseEnv, supabaseEnvProblem };
