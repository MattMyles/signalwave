// GET /api/nowplaying?uuid=<stationuuid>[&genres=<ids>]
// Reads the current song title from the station's stream metadata.
// With genres (same format as /api/next: "rock,tag:classic rock") it also says
// whether the song playing right now fits them: fits true / false (a clear
// mismatch) / null (can't tell: no "Artist - Song" title, song not in Apple's
// catalog, lookup slow). The app asks before switching to a station it found a
// while ago, since its song has changed since it was checked.
// Takes a station id rather than a URL so it can only open real station streams.
const { probeStream } = require('../lib/icy');
const { stationByUuid } = require('../lib/radio');
const { knownStreamUrl, rememberStream, resolveGenres } = require('../lib/vet');
const { songFits, splitSong, songKey } = require('../lib/songcheck');
const { makeSongCache } = require('../lib/songcache');
const { makeDb } = require('../lib/sbrest');
const { serviceEnv } = require('../lib/supabase-env');
const { poolLookup } = require('../lib/pool');
const { noteSong } = require('../lib/songlog');
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
    // With genres the answer has to come back fast (the app waits 3 s); a title that
    // doesn't arrive in time just leaves fits null.
    const spec = query(req).get('genres') ? resolveGenres(query(req).get('genres')) : null;
    const p = await probeStream(url, spec ? { firstByteMs: 2500, totalMs: 2500 } : {});
    const out = { ok: p.ok, title: p.ok ? p.title : null };
    let cache = null;
    if (spec) {
      out.fits = null;
      if (p.ok) {
        const env = serviceEnv();
        cache = env ? makeSongCache(makeDb(env, { timeoutMs: 1500 }), Date.now, { timeoutMs: 1500 }) : null;
        try {
          const sp = cache && p.title ? splitSong(p.title) : null;
          if (sp) await cache.prefetch([songKey(sp.artist, sp.song)]);
          out.fits = await songFits(p.title, spec, cache ? { cache } : undefined);
        } catch (_) { out.fits = null; }
      }
    }
    sendJson(res, 200, out, 10);
    // Our own record of what this station plays (for /admin). The listener already has the
    // answer; this only keeps the function alive a moment longer, and never fails it.
    if (cache) await Promise.race([cache.flush(), new Promise((r) => setTimeout(r, 400))]);
    if (out.ok && out.title) await noteSong(uuid, out.title);
  } catch (e) {
    // unknown: we couldn't look the station up (directory down), which says nothing about its stream.
    sendJson(res, 200, { ok: false, title: null, unknown: true });
  }
};
