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
const { artistKey, plainName, getMem, setMem } = require('./mbtags');

const record = new Map();       // station uuid -> { local, foreign }
let nextSlot = 0;

/** Tag names from a MusicBrainz artist: genres first, then tags, most voted first, no repeats. */
function tagNames(hit) {
  const byVotes = (list) => (Array.isArray(list) ? list.slice() : []).filter((x) => x && x.name).sort((a, b) => (b.count || 0) - (a.count || 0)).map((x) => String(x.name).toLowerCase().trim());
  return [...new Set([...byVotes(hit && hit.genres), ...byVotes(hit && hit.tags)])].filter(Boolean).slice(0, 12);
}

/**
 * Everything MusicBrainz says about an artist, in one request:
 * { country: 'JP' | null, tags: ['hard rock', ...] }, or null when it couldn't
 * be asked (busy, rate-limited, down). Spaced out, cached in memory and, when
 * opts.cache (lib/artistcache.js) is given, persistently, where a known artist
 * costs no request at all. opts.gate() -> false stops a run asking for more.
 * (Genres and tags ride along with the country lookup: inc=genres+tags.)
 */
async function artistInfo(artist, opts = {}) {
  const name = artistKey(artist);
  if (!name) return null;
  const mem = getMem(name);
  if (mem) return mem;
  if (opts.cache) {
    const hit = opts.cache.get(name);
    if (hit !== undefined) { setMem(name, hit); return hit; }
  }
  if (opts.gate && !(await opts.gate())) return null;

  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  if (slot - now > MAX_WAIT_MS) return null; // busy: skip rather than slow the search
  nextSlot = slot + SPACING_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));

  let info = { country: null, tags: [] };
  try {
    const u = new URL('https://musicbrainz.org/ws/2/artist/');
    // inc=genres+tags with a literal plus, as MusicBrainz writes it (URLSearchParams would send %2B).
    u.search = `${new URLSearchParams({ query: `artist:"${name.replace(/"/g, '')}"`, fmt: 'json', limit: '5' }).toString()}&inc=genres+tags`;
    const r = await fetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null; // rate-limited or down: don't cache
    const j = await r.json();
    const hit = (j.artists || []).find((a) => (a.score || 0) >= 90 && plainName(a.name) === name);
    const cc = hit && (hit.country || (hit.area && hit.area['iso-3166-1-codes'] && hit.area['iso-3166-1-codes'][0]));
    info = { country: cc && /^[A-Z]{2}$/.test(cc) && cc !== 'XW' && cc !== 'XE' ? cc : null, tags: hit ? tagNames(hit) : [] };
  } catch (_) {
    return null;
  }
  setMem(name, info);
  if (opts.cache) { try { opts.cache.set(name, info); } catch (_) { /* cache only */ } }
  return info;
}

/** The artist's home country (ISO code like 'JP'), or null if unknown. */
async function artistCountry(artist, opts) {
  const info = await artistInfo(artist, opts);
  return info ? info.country : null;
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

module.exports = { artistCountry, artistInfo, tagNames, noteSong, localWeight, pickLocal };
