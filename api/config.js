// GET /api/config — tells the app whether sign-in/sync is set up, and gives it
// the Supabase address and PUBLIC key. The public key is safe to share: the
// database's row-level security decides what each signed-in user can touch.
// Never put the service_role (secret) key in these variables.
const { supabaseEnv } = require('../lib/supabase-env');
const { sendJson } = require('../lib/http');

module.exports = function handler(req, res) {
  const env = supabaseEnv();
  sendJson(res, 200, env ? { sync: true, supabaseUrl: env.url, supabaseKey: env.key } : { sync: false }, 300);
};
