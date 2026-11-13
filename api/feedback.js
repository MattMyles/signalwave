// POST /api/feedback — a listener tapped "WRONG GENRE?" on a station.
// Body: { visitor, genres: ['rock', 'tag:classic rock'], song, station: { uuid, name, city, countryCode, genre } }
// Saves one row per picked genre in genre_reports (server-only key), waiting
// for review in the admin dashboard; once the admin agrees, the server stops
// serving that station for those genres (lib/reports.js). The admin's own
// reports count straight away.
// Like the play log, the listener is only a random per-browser ID (plus their
// account if signed in).
const { serviceEnv, sbHeaders, verifyUser, adminEmails } = require('../lib/supabase-env');
const { sendJson, readJson, bearer } = require('../lib/http');
const { forget } = require('../lib/reports');
const { crossedLine, sendReviewAlert } = require('../lib/notify');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENRE_ID = /^(tag:)?[a-z0-9 &'\-]{2,40}$/;
const recent = new Map(); // visitor -> timestamps, to cap abuse
const MAX_PER_HOUR = 30;

const text = (v, max) => {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

// Email the admin when this report takes the number waiting for review over
// the line (lib/notify.js). Best-effort: a failure never affects the report.
async function alertIfPilingUp(env, added, req) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const r = await fetch(`${env.url}/rest/v1/genre_reports?select=genre_key,station_name,city,country_code,song&status=eq.pending&order=created_at.desc&limit=200`, {
      headers: sbHeaders(env.key), signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return;
    const pending = await r.json();
    if (!crossedLine(pending.length - added, pending.length)) return;
    const site = process.env.SITE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    await sendReviewAlert(pending, site);
  } catch (_) { /* alerts are best-effort */ }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
  const body = await readJson(req);
  const st = body && body.station;
  const genres = Array.isArray(body && body.genres) ? [...new Set(body.genres.map(String).filter((g) => GENRE_ID.test(g)))].slice(0, 5) : [];
  if (!body || !UUID.test(String(body.visitor || '')) || !st || !UUID.test(String(st.uuid || '')) || !genres.length) {
    return sendJson(res, 400, { error: 'Bad report.' });
  }

  const env = serviceEnv();
  if (!env) { res.statusCode = 204; return res.end(); } // reports not set up: accept and ignore

  const now = Date.now();
  const times = (recent.get(body.visitor) || []).filter((t) => now - t < 3600000);
  if (times.length >= MAX_PER_HOUR) return sendJson(res, 429, { error: 'Too many reports.' });
  times.push(now);
  recent.set(body.visitor, times);
  if (recent.size > 5000) recent.clear();

  const user = await verifyUser(bearer(req));
  const isAdmin = Boolean(user && user.email && adminEmails().includes(user.email.toLowerCase()));
  const rows = genres.map((g) => ({
    station_uuid: st.uuid.toLowerCase(),
    station_name: text(st.name, 200),
    genre_key: g,
    station_genre: text(st.genre, 80),
    song: text(body.song, 300),
    city: text(st.city, 120),
    country_code: text(st.countryCode, 4),
    visitor_id: body.visitor,
    user_id: user ? user.id : null,
    status: isAdmin ? 'approved' : 'pending',
    reviewed_at: isAdmin ? new Date().toISOString() : null,
  }));
  try {
    const r = await fetch(`${env.url}/rest/v1/genre_reports`, {
      method: 'POST',
      headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return sendJson(res, 502, { error: 'Could not save the report.' });
    forget(); // this server instance picks the report up straight away
    if (!isAdmin) await alertIfPilingUp(env, rows.length, req);
    res.statusCode = 204;
    res.end();
  } catch (_) {
    sendJson(res, 502, { error: 'Could not save the report.' });
  }
};
