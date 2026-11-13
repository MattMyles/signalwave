// Local artists: the point of NEO // EARTH is finding artists from the
// station's own country in the genre you love. While vetting, the current
// song's artist is looked up in MusicBrainz (free, open music database) to see
// which country they're from. Each station builds up a "local" record from the
// songs it's been heard playing, and picks lean towards stations playing local
// artists. Nothing is ever rejected for playing famous foreign artists: a
// station that mixes local and international music still gets picked, just
// less often than one that's all local.
//
// MusicBrainz asks for at most about one request per second and a
// User-Agent naming the app, so lookups are spaced out, cached, and capped
// per search; when the queue is busy the artist is simply "unknown".
const { USER_AGENT } = require('./config');
const { splitSong } = require('./songcheck');

const SPACING_MS = 1100;   // MusicBrainz: about one request a second
const MAX_WAIT_MS = 3000;  // don't hold up a search longer than this
const TIMEOUT_MS = 2500;
const CACHE_MAX = 5000;

const countryCache = new Map(); // plain artist name -> 'JP' | null (unknown)
const record = new Map();       // station uuid -> { local, foreign }
let nextSlot = 0;

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(feat|ft|featuring)\b.*$/, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The artist's home country (ISO code like 'JP'), or null if unknown. */
async function artistCountry(artist) {
  const name = plain(String(artist).split(/\s*(?:,|&| x | and | y | e | und )\s*/i)[0]); // first credited artist
  if (!name) return null;
  if (countryCache.has(name)) return countryCache.get(name);

  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  if (slot - now > MAX_WAIT_MS) return null; // busy: skip rather than slow the search
  nextSlot = slot + SPACING_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));

  let country = null;
  try {
    const u = new URL('https://musicbrainz.org/ws/2/artist/');
    u.search = new URLSearchParams({ query: `artist:"${name.replace(/"/g, '')}"`, fmt: 'json', limit: '5' }).toString();
    const r = await fetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null; // rate-limited or down: don't cache
    const j = await r.json();
    const hit = (j.artists || []).find((a) => (a.score || 0) >= 90 && plain(a.name) === name);
    const cc = hit && (hit.country || (hit.area && hit.area['iso-3166-1-codes'] && hit.area['iso-3166-1-codes'][0]));
    country = cc && /^[A-Z]{2}$/.test(cc) && cc !== 'XW' && cc !== 'XE' ? cc : null;
  } catch (_) {
    return null;
  }
  if (countryCache.size >= CACHE_MAX) countryCache.delete(countryCache.keys().next().value);
  countryCache.set(name, country);
  return country;
}

/**
 * Notes the song a station is playing. Returns true (local artist), false
 * (from another country) or null (couldn't tell).
 */
async function noteSong(uuid, stationCountry, title) {
  const s = splitSong(title);
  if (!s || !stationCountry) return null;
  const cc = await artistCountry(s.artist);
  if (!cc) return null;
  const local = cc === String(stationCountry).toUpperCase();
  const r = record.get(uuid) || { local: 0, foreign: 0 };
  if (local) r.local++; else r.foreign++;
  if (record.size >= 20000 && !record.has(uuid)) record.clear();
  record.set(uuid, r);
  return local;
}

/**
 * How strongly to favour a station: 1 for unknown or all-foreign, up to 4 for
 * all-local. Never 0, so mixed and international stations still come up.
 */
function localWeight(uuid) {
  const r = record.get(uuid);
  if (!r || r.local + r.foreign === 0) return 1.5; // unknown: a little above known-foreign
  return 1 + 3 * (r.local / (r.local + r.foreign));
}

/** Picks one station, leaning towards those playing local artists. */
function pickLocal(stations) {
  if (!stations.length) return null;
  const weights = stations.map((s) => localWeight(s.uuid));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < stations.length; i++) { x -= weights[i]; if (x <= 0) return stations[i]; }
  return stations[stations.length - 1];
}

module.exports = { artistCountry, noteSong, localWeight, pickLocal };
