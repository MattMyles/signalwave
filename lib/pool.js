// Serves stations from the shelf (Supabase station_pool, filled by the scout
// in scripts/scout.js). poolNext() is tried first by /api/next; when it
// returns null (no Supabase, shelf not set up, nothing on it for this pick,
// everything it offered was offline) the caller falls back to vetting
// stations live, exactly as before.
const { serviceEnv } = require('./supabase-env');
const { makeDb, isMissing } = require('./sbrest');
const { reportedFor } = require('./reports');
const { probeStream } = require('./icy');
const { translateTags } = require('./translate');
const { REGIONS } = require('./config');
const { splitTags, displayGenre, regionOf, rememberStream, shuffle } = require('./vet');

const CANDIDATES = 60;       // stations asked for per search of the shelf
const MAX_TRIES = 4;         // liveness checks per request
const LIVE_FIRST_BYTE_MS = 2500;
const LIVE_TOTAL_MS = 3500;
const BUDGET_MS = 9000;      // the shelf's whole share of one request
const MAX_EXCLUDE = 6500;
const MISSING_MS = 10 * 60 * 1000;

let missingUntil = 0; // shelf tables/functions not there: don't ask again until then
function resetPool() { missingUntil = 0; }

// Same weighting as the live path's pickLocal: 1 (all foreign) to 4 (all local), 1.5 unknown.
const weightOf = (row) => (row.local_ratio == null ? 1.5 : 1 + 3 * Number(row.local_ratio));
function takeWeighted(list) {
  const weights = list.map(weightOf);
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  let i = 0;
  for (; i < list.length - 1; i++) { x -= weights[i]; if (x <= 0) break; }
  return list.splice(i, 1)[0];
}

const latestSample = (row) => (Array.isArray(row.samples) ? row.samples : []).reduce((a, s) => (!a || (s && s.at > a.at) ? s : a), null);

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
    genre: displayGenre(tags, spec),
    city: row.city,
    country: row.country || 'Unknown',
    countryCode: row.country_code || null,
    lat: row.lat,
    lng: row.lng,
    bitrate: (probe && probe.bitrate) || row.bitrate || null,
    codec: row.codec || null,
    cors: probe && probe.cors != null ? Boolean(probe.cors) : Boolean(row.cors),
    title: last ? last.title : null,
    localArtist: ratio == null ? null : ratio >= 0.5 ? true : ratio <= 0.2 ? false : null,
    source: row.source,
  };
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
      if (Array.isArray(rows) && rows.length) break;
      rows = [];
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
  const pool = rows.slice();
  for (let i = 0; i < MAX_TRIES && pool.length && Date.now() - t0 < BUDGET_MS; i++) {
    const row = takeWeighted(pool);
    let p;
    try { p = await probe(row.url, { firstByteMs: LIVE_FIRST_BYTE_MS, totalMs: LIVE_TOTAL_MS, skipMeta: true }); } catch (_) { p = { ok: false }; }
    if (p && p.ok) {
      rememberStream(row.uuid, row.url);
      await settle();
      return toStation(row, spec, p);
    }
    marks.push(db.rpc('pool_mark_fail', { p_uuid: row.uuid }).catch(() => null));
  }
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

module.exports = { poolNext, poolLookup, toStation, weightOf, takeWeighted, resetPool };
