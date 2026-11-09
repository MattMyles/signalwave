// GET /api/next?genres=electronic,tag:deep%20house&exclude=uuid1,uuid2&recent=DE,US
// or POST /api/next { genres, exclude: [...], recent } for long exclude lists
// (every station a listener has ever heard, so random play never repeats).
// Returns one random station that passed all five checks.
const { nextStation, resolveGenre, resolveGenres } = require('../lib/vet');
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
    const station = await nextStation(spec, exclude, recent);
    if (!station) {
      return sendJson(res, 503, { error: 'No station passed the checks in time. Try again or pick another genre.' });
    }
    reportClick(station.uuid);
    const { vettedAt, ...pub } = station;
    sendJson(res, 200, { station: pub });
  } catch (e) {
    sendJson(res, 502, { error: 'The station directory did not answer. Try again in a moment.' });
  }
};
