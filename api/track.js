// POST /api/track — records that a listener heard a station for 30+ seconds.
// Body: { visitor, station: { uuid, name, city, country, countryCode, genre } }
// "visitor" is a random ID the browser made up; nothing else about the
// listener is stored. If they're signed in, the app sends their access token
// and the play is linked to their account. Writes use the server-only key.
const { serviceEnv, sbHeaders, verifyUser } = require('../lib/supabase-env');
const { sendJson, readJson, bearer } = require('../lib/http');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recent = new Map(); // visitor -> timestamps, to cap abuse
const MAX_PER_HOUR = 60;

const text = (v, max) => {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
  const env = serviceEnv();
  if (!env) { res.statusCode = 204; return res.end(); } // dashboard not set up: accept and ignore

  const body = await readJson(req);
  const st = body && body.station;
  if (!body || !UUID.test(String(body.visitor || '')) || !st || !text(st.uuid, 64)) {
    return sendJson(res, 400, { error: 'Bad play record.' });
  }

  const now = Date.now();
  const times = (recent.get(body.visitor) || []).filter((t) => now - t < 3600000);
  if (times.length >= MAX_PER_HOUR) return sendJson(res, 429, { error: 'Too many plays.' });
  times.push(now);
  recent.set(body.visitor, times);
  if (recent.size > 5000) recent.clear();

  const user = await verifyUser(bearer(req));
  const row = {
    visitor_id: body.visitor,
    user_id: user ? user.id : null,
    station_uuid: text(st.uuid, 64),
    station_name: text(st.name, 200),
    city: text(st.city, 120),
    country: text(st.country, 120),
    country_code: text(st.countryCode, 4),
    genre: text(st.genre, 80),
  };
  try {
    const r = await fetch(`${env.url}/rest/v1/plays`, {
      method: 'POST',
      headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return sendJson(res, 502, { error: 'Could not record the play.' });
    res.statusCode = 204;
    res.end();
  } catch (_) {
    sendJson(res, 502, { error: 'Could not record the play.' });
  }
};
