// Reads the Supabase project address and public key from environment
// variables (set in Vercel → Settings → Environment Variables). Accepts the
// names the Supabase/Vercel integrations create as well as plain ones.
function supabaseEnv() {
  const e = process.env;
  const url = e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = e.SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY ||
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && key ? { url: url.replace(/\/$/, ''), key } : null;
}
module.exports = { supabaseEnv };
