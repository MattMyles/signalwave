// GET /api/nowplaying?uuid=<stationuuid>
// Reads the current song title from the station's stream metadata.
// Takes a station id rather than a URL so it can only open real station streams.
const { probeStream } = require('../lib/icy');
const { stationByUuid } = require('../lib/radio');
const { knownStreamUrl, rememberStream } = require('../lib/vet');
const { query, sendJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const uuid = (query(req).get('uuid') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return sendJson(res, 400, { error: 'Missing or invalid station id.' });
  try {
    let url = knownStreamUrl(uuid);
    if (!url) {
      const s = await stationByUuid(uuid);
      if (!s || !s.url_resolved) return sendJson(res, 404, { error: 'Station not found.' });
      url = s.url_resolved;
      rememberStream(uuid, url);
    }
    const p = await probeStream(url);
    sendJson(res, 200, { ok: p.ok, title: p.ok ? p.title : null }, 10);
  } catch (e) {
    sendJson(res, 200, { ok: false, title: null });
  }
};
