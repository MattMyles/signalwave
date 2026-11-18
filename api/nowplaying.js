// GET /api/nowplaying?uuid=<stationuuid>
// Reads the current song title from the station's stream metadata.
// Takes a station id rather than a URL so it can only open real station streams.
const { probeStream } = require('../lib/icy');
const { stationByUuid } = require('../lib/radio');
const { knownStreamUrl, rememberStream } = require('../lib/vet');
const { poolLookup } = require('../lib/pool');
const { isIcecastId } = require('../lib/shelf');
const { query, sendJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const uuid = (query(req).get('uuid') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return sendJson(res, 400, { error: 'Missing or invalid station id.' });
  try {
    let url = knownStreamUrl(uuid);
    if (!url) {
      // Icecast-only stations live on the station shelf; for the rest the
      // shelf is the fallback when Radio Browser doesn't have (or can't say).
      if (isIcecastId(uuid)) { const row = await poolLookup(uuid); if (row) url = row.url; }
      let directoryError = null;
      if (!url) {
        try { const s = await stationByUuid(uuid); if (s && s.url_resolved) url = s.url_resolved; } catch (e) { directoryError = e; }
      }
      if (!url) { const row = await poolLookup(uuid); if (row) url = row.url; }
      if (!url) { if (directoryError) throw directoryError; return sendJson(res, 404, { error: 'Station not found.' }); }
      rememberStream(uuid, url);
    }
    const p = await probeStream(url);
    sendJson(res, 200, { ok: p.ok, title: p.ok ? p.title : null }, 10);
  } catch (e) {
    sendJson(res, 200, { ok: false, title: null });
  }
};
