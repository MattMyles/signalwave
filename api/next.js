// GET /api/next?genres=electronic,tag:deep%20house&exclude=uuid1,uuid2&recent=DE,US
// or POST /api/next { genres, exclude: [...], recent } for long exclude lists
// (every station a listener has ever heard, so random play never repeats).
// Returns one random station that passed all five checks: from the shelf of
// stations the scout has already vetted (lib/pool.js) when it has one for the
// pick, otherwise vetted live. Stations the admin certified for the pick come before both
// (lib/certified.js); the response also says which genres the station is certified for.
const { nextStation, resolveGenre, resolveGenres } = require('../lib/vet');
const { poolNext } = require('../lib/pool');
const { certifiedNext, keysFor } = require('../lib/certified');
const { reportClick } = require('../lib/radio');
const { query, sendJson, readJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const q = query(req);
  const body = req.method === 'POST' ? (await readJson(req, 300 * 1024)) || {} : {};
  const get = (k) => (body[k] != null ? body[k] : q.get(k));
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  // genres=electronic,tag:deep%20house (up to 5), or the older single
  // genre=electronic / tag=deep%20house.
  const spec = get('genres') != null ? resolveGenres(list(get('genres')).join(',')) : resolveGenre(get('genre'), get('tag'));
  const exclude = new Set(list(get('exclude')).slice(0, req.method === 'POST' ? 6000 : 300));
  const recent = list(get('recent')).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)).slice(0, 4);
  try {
    // Certified stations (the admin's stamp) come first for a genre pick, until the listener has heard them.
    let station = await certifiedNext(spec, exclude, recent).catch(() => null);
    if (!station) station = await poolNext(spec, exclude, recent).catch(() => null);
    if (!station) station = await nextStation(spec, exclude, recent);
    if (!station) {
      return sendJson(res, 503, { error: 'No station passed the checks in time. Try again or pick another genre.' });
    }
    if (station.source !== 'icecast') reportClick(station.uuid); // Icecast-only stations aren't in Radio Browser
    const { vettedAt, source, certifiedFor, ...pub } = station;
    // The genre keys it is certified for (the CERTIFIED tag needs no second request). Additive: the Apple apps ignore it.
    const certified = certifiedFor || await keysFor(pub.uuid);
    sendJson(res, 200, { station: pub, certified });
  } catch (e) {
    sendJson(res, 502, { error: 'The station directory did not answer. Try again in a moment.' });
  }
};
