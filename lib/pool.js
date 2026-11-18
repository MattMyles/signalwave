// Serves stations from the shelf (Supabase station_pool, filled by the scout
// in scripts/scout.js). poolNext() is tried first by /api/next; when it
// returns null (no Supabase, shelf not set up, nothing on it for this pick,
// everything it offered was offline) the caller falls back to vetting
// stations live, exactly as before.
const { serviceEnv } = require('./supabase-env');
const { makeDb, isMissing } = require('./sbrest');
const { reportedFor } = require('./reports');
const { probeStream } = require('./icy');
const { songFits, splitSong, songKey } = require('./songcheck');
const { makeSongCache } = require('./songcache');
const { makeArtistCache } = require('./artistcache');
const { artistKey } = require('./mbtags');
const { translateTags } = require('./translate');
const { negatedTerms, negatesSpec } = require('./tagmatch');
const { REGIONS, GENRES } = require('./config');
const { splitTags, displayGenre, regionOf, rememberStream, shuffle } = require('./vet');

const CANDIDATES = 60;       // stations asked for per search of the shelf
const MAX_TRIES = 9;         // candidates checked per request
const BATCH = 3;             // checked at the same time; the first in weighted order that passes wins
const LIVE_FIRST_BYTE_MS = 2500;
const LIVE_TOTAL_MS = 3500;  // when no genre is picked: just "is it alive"
const SONG_TOTAL_MS = 4000;  // with a genre picked: long enough for the first song title (ICY metadata)
const SONG_CACHE_MS = 1500;  // the shared song cache is a nicety, never worth a long wait
const BUDGET_MS = 9000;      // the shelf's whole share of one request
const MAX_EXCLUDE = 6500;
const MISSING_MS = 10 * 60 * 1000;

let missingUntil = 0; // shelf tables/functions not there: don't ask again until then
function resetPool() { missingUntil = 0; }

// Same weighting as the live path's pickLocal: 1 (all foreign) to 4 (all local), 1.5 unknown.
// A station whose city is unknown (placed at its country) is chosen a little less
// often than one with a real city, but still plays.
const NO_CITY_WEIGHT = 0.6;
const weightOf = (row) => (row.local_ratio == null ? 1.5 : 1 + 3 * Number(row.local_ratio)) * (row.city ? 1 : NO_CITY_WEIGHT);
function takeWeighted(list) {
  const weights = list.map(weightOf);
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  let i = 0;
  for (; i < list.length - 1; i++) { x -= weights[i]; if (x <= 0) break; }
  return list.splice(i, 1)[0];
}

const latestSample = (row) => (Array.isArray(row.samples) ? row.samples : []).reduce((a, s) => (!a || (s && s.at > a.at) ? s : a), null);

// A station with no tags (genres judged from its songs alone) shows the picked genre, else the first main genre it qualifies for.
function untaggedGenre(row, spec) {
  if (spec) return spec.label.toLowerCase();
  const main = (row.genres || []).find((k) => GENRES[k]);
  return main ? GENRES[main].label.toLowerCase() : 'music';
}

function toStation(row, spec, probe) {
  const tags = translateTags(splitTags(row.tags));
  const last = latestSample(row);
  const ratio = row.local_ratio;
  return {
    uuid: row.uuid,
    name: row.name,
    url: row.url,
    homepage: row.homepage || null,
    favicon: /^https:\/\//.test(row.favicon || '') ? row.favicon : null,
    tags,
    genre: tags.length ? displayGenre(tags, spec) : untaggedGenre(row, spec),
    city: row.city || null,
    region: row.city ? null : (row.region || null),
    country: row.country || 'Unknown',
    countryCode: row.country_code || null,
    lat: row.lat,
    lng: row.lng,
    bitrate: (probe && probe.bitrate) || row.bitrate || null,
    codec: row.codec || null,
    cors: probe && probe.cors != null ? Boolean(probe.cors) : Boolean(row.cors),
    title: (probe && probe.title) || (last ? last.title : null),
    localArtist: ratio == null ? null : ratio >= 0.5 ? true : ratio <= 0.2 ? false : null,
    source: row.source,
  };
}

/**
 * Does this shelf row say it is NOT what's picked ("all genre on earth except trap")? Rows judged before
 * that rule existed may still list the genre; they're skipped now, and the scout's sweep fixes them.
 * With several genres picked the row only counts as negating when every one it's on the shelf for is negated.
 */
function negatesPick(row, spec) {
  if (!spec) return false;
  const neg = negatedTerms([row.name, ...splitTags(row.tags)]);
  if (!neg.size) return false;
  const parts = spec.parts || [spec];
  const listed = Array.isArray(row.genres) && row.genres.length ? parts.filter((p) => row.genres.includes(p.key)) : parts;
  return !(listed.length ? listed : parts).some((p) => !negatesSpec(neg, p));
}

/**
 * One station for this pick from the shelf, or null. exclude: ids to skip
 * (heard before); recent: country codes just heard, whose regions are
 * avoided when the shelf has anything elsewhere. opts.env / opts.probe are
 * for tests.
 */
async function poolNext(spec, exclude = new Set(), recent = [], opts = {}) {
  const env = opts.env !== undefined ? opts.env : serviceEnv();
  if (!env || Date.now() < missingUntil) return null;
  const probe = opts.probe || probeStream;
  const db = makeDb(env, { timeoutMs: 4000 });
  const t0 = Date.now();

  const reported = await reportedFor(spec).catch(() => new Set());
  const keys = spec ? (spec.parts || [spec]).map((p) => p.key) : [];
  const skip = [...new Set([...exclude, ...reported])].slice(0, MAX_EXCLUDE);

  // Pick regions the listener hasn't just heard, each equally likely, so the
  // shelf's many US and European stations don't crowd out the rest of the
  // world; if those regions have nothing for this pick, look anywhere.
  const avoid = new Set(recent.map(regionOf).filter(Boolean));
  const regions = shuffle(Object.keys(REGIONS).filter((r) => !avoid.has(r))).slice(0, 3);
  const attempts = [...regions.map((r) => REGIONS[r]), null];

  let rows = [];
  try {
    for (const countries of attempts) {
      if (Date.now() - t0 > BUDGET_MS / 2) break;
      rows = await db.rpc('pool_candidates', { p_keys: keys, p_exclude: skip, p_limit: CANDIDATES, p_countries: countries });
      rows = Array.isArray(rows) ? rows.filter((r) => !negatesPick(r, spec)) : [];
      if (rows.length) break;
    }
  } catch (e) {
    if (isMissing(e)) missingUntil = Date.now() + MISSING_MS;
    return null;
  }
  if (!rows.length) return null;

  const marks = [];
  // Give failure marks a moment to reach Supabase before the function returns.
  const settle = async () => {
    let timer;
    await Promise.race([Promise.allSettled(marks), new Promise((r) => { timer = setTimeout(r, 400); })]);
    clearTimeout(timer);
  };

  // With a genre picked, the song playing right now has to fit it: stations
  // often mix genres, so a station's tags (and the songs it played when the
  // scout last looked) aren't enough. Only a clear mismatch (false) skips a
  // station, and not as a failure: it's fine, just playing something else.
  // Unknown (no "Artist - Song" title, song not in Apple's catalog, slow
  // lookup) passes, so local artists missing from the catalog never lose a station.
  const judge = opts.songFits || songFits;
  const songCache = spec ? makeSongCache(db, Date.now, { timeoutMs: SONG_CACHE_MS }) : null;
  // MusicBrainz genres already on file (artist_info, filled by the scout): read-only here, never asked for.
  const artistCache = spec ? makeArtistCache(db, Date.now, { timeoutMs: SONG_CACHE_MS }) : null;
  const probeOpts = spec
    ? { firstByteMs: LIVE_FIRST_BYTE_MS, totalMs: SONG_TOTAL_MS }
    : { firstByteMs: LIVE_FIRST_BYTE_MS, totalMs: LIVE_TOTAL_MS, skipMeta: true };

  // Probes one candidate: { row, p }; the song check adds .fit (false only for a clear mismatch).
  const check = async (row) => {
    let p;
    try { p = await probe(row.url, probeOpts); } catch (_) { p = { ok: false }; }
    return { row, p };
  };

  let tried = 0;
  const pool = rows.slice();
  while (tried < MAX_TRIES && pool.length && Date.now() - t0 < BUDGET_MS) {
    const batch = [];
    while (batch.length < BATCH && tried + batch.length < MAX_TRIES && pool.length) batch.push(takeWeighted(pool));
    tried += batch.length;
    const checked = await Promise.all(batch.map(check)); // weighted order is kept
    if (spec) {
      // One query for the songs of the whole batch, then the lookups.
      const keys = checked.map(({ p }) => (p && p.ok ? splitSong(p.title) : null)).filter(Boolean).map((s) => songKey(s.artist, s.song));
      const artists = checked.map(({ p }) => (p && p.ok ? splitSong(p.title) : null)).filter(Boolean).map((s) => artistKey(s.artist));
      if (keys.length) await Promise.all([songCache.prefetch(keys), artistCache.prefetch(artists)]);
      await Promise.all(checked.map(async (c) => {
        if (!c.p || !c.p.ok) return;
        // The station's country: a title in Japanese is looked up in the Japanese iTunes store.
        try { c.fit = await judge(c.p.title, spec, { cache: songCache, artists: artistCache, country: c.row.country_code }); } catch (_) { c.fit = null; }
      }));
    }
    let winner = null;
    for (const c of checked) {
      if (c.p && c.p.ok) {
        if (c.fit !== false && !winner) winner = c;
      } else {
        marks.push(db.rpc('pool_mark_fail', { p_uuid: c.row.uuid }).catch(() => null)); // genuinely offline
      }
    }
    if (winner) {
      if (songCache) marks.push(songCache.flush());
      rememberStream(winner.row.uuid, winner.row.url, winner.row.country_code);
      await settle();
      return toStation(winner.row, spec, winner.p);
    }
  }
  if (songCache) marks.push(songCache.flush());
  await settle();
  return null;
}

/** One shelf row by station id (for saved or shared stations that Radio Browser doesn't know), or null. */
async function poolLookup(uuid, opts = {}) {
  const env = opts.env !== undefined ? opts.env : serviceEnv();
  if (!env || Date.now() < missingUntil) return null;
  try {
    const rows = await makeDb(env, { timeoutMs: 4000 }).get(`/station_pool?uuid=eq.${encodeURIComponent(uuid)}&select=*&limit=1`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    if (isMissing(e)) missingUntil = Date.now() + MISSING_MS;
    return null;
  }
}

module.exports = { negatesPick, poolNext, poolLookup, toStation, weightOf, takeWeighted, resetPool, NO_CITY_WEIGHT };
