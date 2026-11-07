// Reads the Supabase project address and public key from environment
// variables (set in Vercel → Settings → Environment Variables). Accepts the
// names the Supabase/Vercel integrations create as well as plain ones, and
// tolerates stray quotes, spaces or a pasted "/rest/v1/" path.
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();

function supabaseEnv() {
  const e = process.env;
  const rawUrl = clean(e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(e.SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY ||
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
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
  const hasUrl = Boolean(clean(e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL));
  const hasKey = Boolean(clean(e.SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY ||
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
  if (!hasUrl && !hasKey) return 'SUPABASE_URL and SUPABASE_ANON_KEY are not set (add them in Vercel, then redeploy)';
  if (!hasUrl) return 'SUPABASE_URL is not set';
  if (!hasKey) return 'SUPABASE_ANON_KEY is not set';
  return 'SUPABASE_URL is not a Supabase project address (should look like https://abcd1234.supabase.co)';
}

module.exports = { supabaseEnv, supabaseEnvProblem };
