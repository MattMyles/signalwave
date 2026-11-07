// GET /api/next?genre=electronic&exclude=uuid1,uuid2&recent=DE,US
// Returns one random station that passed all five checks.
const { nextStation } = require('../lib/vet');
const { reportClick } = require('../lib/radio');
const { query, sendJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const q = query(req);
  const genre = (q.get('genre') || '').toLowerCase().replace(/[^a-z]/g, '') || null;
  const exclude = new Set((q.get('exclude') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300));
  const recent = (q.get('recent') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)).slice(0, 4);
  try {
    const station = await nextStation(genre === 'any' ? null : genre, exclude, recent);
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
