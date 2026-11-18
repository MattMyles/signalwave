// Station counts for the genre editor (served by api/genre-counts.js), two kinds:
//
//  verified  servable stations on the station shelf (the scout has checked them: stream up,
//            real song titles, quality floor, and judged on what they play) that qualify for
//            the genre or style. This is what NEXT can actually play, so it is the headline
//            number. Read with the pool_stats() function, kept 10 minutes in memory.
//  directory what Radio Browser lists for the name(s): a secure stream and a placeable city or
//            country. An upper bound ("possible"): many fail the live checks. Each style counts
//            its other names too (TAG_ALIASES); a compound alias 'a+b' is searched by its first
//            term and then filtered to stations with a tag for each term. Kept a day in memory.
const { GENRES, STYLES, TAG_ALIASES } = require('./config');
const { searchStations } = require('./radio');
const { placeFromStation } = require('./geo');
const { searchTerm, isCompound, nameHits } = require('./tagmatch');
const { serviceEnv } = require('./supabase-env');
const { makeDb } = require('./sbrest');

const CAP = 300; // per name searched; totals at or above this show as "300+"
const DAY = 24 * 60 * 60 * 1000;
const VERIFIED_TTL = 10 * 60 * 1000;

const dirCache = new Map(); // search term -> { list: [{ id, tags }], capped, at }
let verifiedCache = { at: 0, map: null };
function resetCounts() { dirCache.clear(); verifiedCache = { at: 0, map: null }; }

const tagsOf = (s) => String(s.tags || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);

// Stations the app could place on the map: coordinates, or a place from their listed region,
// name, tags or addresses, down to just their country (see placeFromFields in lib/geo.js).
const placeable = (s) => (s.geo_lat != null && s.geo_long != null) || placeFromStation(s);

async function directoryList(term, search) {
  const hit = dirCache.get(term);
  if (hit && Date.now() - hit.at < DAY) return hit;
  const raw = await search({ tag: term, limit: CAP });
  const list = raw.filter((s) => s.stationuuid && (s.url_resolved || '').startsWith('https://') && placeable(s)).map((s) => ({ id: s.stationuuid, tags: tagsOf(s) }));
  const entry = { list, capped: raw.length >= CAP, at: Date.now() };
  dirCache.set(term, entry);
  return entry;
}

/** { ids, capped } for one name: a compound name's stations are searched by its first term and filtered. */
async function idsForName(name, search) {
  const { list, capped } = await directoryList(searchTerm(name), search);
  const ids = list.filter((s) => !isCompound(name) || nameHits(s.tags, name)).map((s) => s.id);
  return { ids, capped };
}

async function countNames(names, search) {
  const all = new Set();
  let more = false;
  for (const r of await Promise.all(names.map((n) => idsForName(n, search).catch(() => ({ ids: [], capped: false }))))) {
    if (r.capped) more = true;
    r.ids.forEach((id) => all.add(id));
  }
  return { n: all.size, more };
}

/** Servable shelf stations per genre key ({ 'rock': 41, 'tag:dancehall': 3, ... }), or null when the shelf isn't there. */
async function verifiedMap({ db, rpcName = 'pool_stats' } = {}) {
  if (verifiedCache.map && Date.now() - verifiedCache.at < VERIFIED_TTL) return verifiedCache.map;
  let handle = db;
  if (!handle) { const env = serviceEnv(); if (!env) return null; handle = makeDb(env, { timeoutMs: 4000 }); }
  try {
    const rows = await handle.rpc(rpcName, {});
    const map = {};
    for (const r of rows || []) if (r && typeof r.key === 'string' && !/^(\*|dead|stale|src:)/.test(r.key)) map[r.key] = Number(r.n) || 0;
    verifiedCache = { at: Date.now(), map };
    return map;
  } catch (_) {
    return null; // the shelf's functions aren't set up (or Supabase is down): only directory counts
  }
}

/** counts[id] = { n, more, verified } for a main genre and each of its styles; verified is null when unknown. */
async function genreCounts(genre, { search = searchStations, db } = {}) {
  if (!GENRES[genre] || !STYLES[genre]) return null;
  const jobs = [
    [genre, GENRES[genre].tags],
    ...STYLES[genre].map((t) => [`tag:${t}`, [t, ...(TAG_ALIASES[t] || [])]]),
  ];
  const [verified, counts] = await Promise.all([verifiedMap({ db }), (async () => {
    const out = {};
    // A few at a time, to be kind to the directory.
    for (let i = 0; i < jobs.length; i += 6) {
      const batch = jobs.slice(i, i + 6);
      const results = await Promise.all(batch.map(([, names]) => countNames(names, search)));
      batch.forEach(([id], k) => { out[id] = results[k]; });
    }
    return out;
  })()]);
  for (const id of Object.keys(counts)) counts[id].verified = verified ? verified[id] || 0 : null;
  return counts;
}

module.exports = { genreCounts, countNames, verifiedMap, resetCounts };
