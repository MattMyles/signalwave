// Certified stations (admin-stamped: "this signal really is <genre>"; see lib/certified.js).
//   GET  /api/certify?uuid=<id>        { keys: [...] } the genre keys a station is certified for. Public and cheap
//                                      (cached a minute): it drives the CERTIFIED tag on the now-playing panel.
//   GET  /api/certify?me=1             { admin: true | false } for the signed-in user (Bearer token): whether to show CERTIFY.
//   GET  /api/certify?all=1            admin only: every certified station with its keys, for the /admin panel.
//   POST /api/certify { uuid, keys: [...], station }   admin only: sets the station's certified keys to exactly
//                                      this list (an empty list removes every certification). station is the public
//                                      station object (kept so it can be served even if no directory knows it); it
//                                      may be left out when the station is already certified for something.
// Keys are checked against the genres and styles the app knows. Nothing here changes how a listener's
// picks work except that certified stations come first (api/next.js).
const { requireAdmin, isAdminRequest } = require('../lib/admin');
const certified = require('../lib/certified');
const { query, sendJson, readJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const q = query(req);
    if (q.get('me')) return sendJson(res, 200, { admin: await isAdminRequest(req) });
    if (q.get('all')) {
      const who = await requireAdmin(req, 'Only the admin can see the certified list.');
      if (!who.ok) return sendJson(res, who.status, { error: who.error });
      return sendJson(res, 200, { stations: await certified.listAll().catch(() => []) });
    }
    const uuid = (q.get('uuid') || '').trim().toLowerCase();
    if (!certified.UUID.test(uuid)) return sendJson(res, 400, { error: 'Missing or invalid station id.' });
    return sendJson(res, 200, { keys: await certified.keysFor(uuid) }, 60);
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'GET or POST only' });

  const who = await requireAdmin(req, 'Only the admin can certify stations.');
  if (!who.ok) return sendJson(res, who.status, { error: who.error });
  const body = await readJson(req, 16 * 1024);
  const uuid = String((body && body.uuid) || '').trim().toLowerCase();
  if (!body || !certified.UUID.test(uuid) || !Array.isArray(body.keys)) return sendJson(res, 400, { error: 'Bad certification.' });
  const { keys, bad } = certified.validKeys(body.keys);
  if (bad.length) return sendJson(res, 400, { error: `Unknown genre: ${bad.slice(0, 3).join(', ')}.` });
  if (keys.length > certified.MAX_KEYS) return sendJson(res, 400, { error: `At most ${certified.MAX_KEYS} genres per station.` });
  try {
    await certified.setKeys({ uuid, keys, station: body.station, by: who.user.email });
    return sendJson(res, 200, { ok: true, keys });
  } catch (e) {
    return sendJson(res, e.status || 502, { error: e.status ? e.message : 'Supabase did not answer. Try again.' });
  }
};
