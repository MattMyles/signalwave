// Scout helpers kept apart from scripts/scout.js so they can be tested offline:
// the cached full Radio Browser list, the offline checks a station must pass
// before it is worth probing, the fair country-by-country ordering, and the
// Icecast directory fetch with its fallback endpoints.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./config');
const vet = require('./vet');
const { translateTags } = require('./translate');
const { locateStation } = require('./geo');
const shelf = require('./shelf');

const DAY = 86400000;

/* ---------- The full list, cached between runs ---------- */

const defaultCacheDir = () => process.env.SCOUT_CACHE_DIR || path.join(__dirname, '..', '.scout-cache');
const cacheFile = (dir = defaultCacheDir()) => path.join(dir, 'rb-stations.json.gz');

function readCache(file) {
  try {
    const buf = fs.readFileSync(file);
    const j = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    if (!j || !Array.isArray(j.stations) || !Number.isFinite(j.fetchedAt)) return null;
    return { stations: j.stations, fetchedAt: j.fetchedAt, bytes: buf.length };
  } catch (_) { return null; }
}

function writeCache(file, stations, fetchedAt) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, fetchedAt, stations })));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  return buf.length;
}

/**
 * The full station list: the cached file when it's under maxAgeMs old (the age
 * is stored inside the file, since a cache restore may not keep file times);
 * otherwise a fresh download, saved gzipped. If the download fails the old file
 * is used however old it is; with no file either, null (the caller then runs the
 * keyword searches). A download shorter than minCount counts as failed.
 * -> { stations, source: 'cache' | 'download' | 'stale', ageMs, bytes, downloaded } or null
 */
async function loadFullList({ file = cacheFile(), maxAgeMs = DAY, download, now = Date.now, log = () => {}, minCount = 1000 } = {}) {
  const cached = readCache(file);
  if (cached) {
    const age = Math.max(0, now() - cached.fetchedAt);
    if (age < maxAgeMs) return { stations: cached.stations, source: 'cache', ageMs: age, bytes: cached.bytes, downloaded: false };
    log(`Radio Browser list on file is ${Math.round(age / 3600000)} h old: downloading a fresh one.`);
  }
  try {
    const stations = await download();
    if (!Array.isArray(stations) || stations.length < minCount) throw new Error(`only ${Array.isArray(stations) ? stations.length : 0} stations`);
    const at = now();
    let bytes = 0;
    try { bytes = writeCache(file, stations, at); } catch (e) { log(`Couldn't save the list for later runs (${e.message}).`); }
    return { stations, source: 'download', ageMs: 0, bytes, downloaded: true };
  } catch (e) {
    log(`Full Radio Browser list download failed (${e.message}).`);
    if (cached) return { stations: cached.stations, source: 'stale', ageMs: Math.max(0, now() - cached.fetchedAt), bytes: cached.bytes, downloaded: false };
    return null;
  }
}

/* ---------- Offline checks ---------- */

/**
 * The checks a Radio Browser station gets before any stream is opened, cheapest
 * first. ctx: { haveUuid, haveUrl (Sets: on the shelf or on file), styleExtra }.
 * -> { skip: 'reason' } or { cand } where cand has everything needed to probe it.
 * Reasons: on_shelf, skip_ssl_error, skip_not_https, skip_long_url, skip_duplicate,
 * skip_playlist, skip_low_bitrate, skip_not_music, skip_no_city (with `unplaced`
 * set so the caller can sample them).
 */
async function offlineCheck(s, ctx) {
  if (!s || !s.stationuuid) return { skip: 'skip_invalid' };
  if (ctx.haveUuid.has(s.stationuuid)) return { skip: 'on_shelf' };
  const url = s.url_resolved;
  if (!url || !url.startsWith('https://')) return { skip: 'skip_not_https' };
  if (Number(s.ssl_error) === 1) return { skip: 'skip_ssl_error' };
  if (url.length > 2000) return { skip: 'skip_long_url' };
  const nu = shelf.normalizeUrl(url);
  if (ctx.haveUrl.has(nu)) return { skip: 'skip_duplicate' };
  if (/m3u8|\.pls$|\.m3u$/i.test(url) || s.hls === 1) return { skip: 'skip_playlist' };
  const kbps = Number(s.bitrate) || 0;
  if (kbps && kbps < (/aac/i.test(s.codec || '') ? cfg.LIMITS.minKbpsAac : cfg.LIMITS.minKbps)) return { skip: 'skip_low_bitrate' };
  const rawTags = vet.splitTags(s.tags);
  if (!vet.isMusicStation(translateTags(rawTags), ctx.styleExtra)) return { skip: 'skip_not_music' };
  const place = await locateStation(s);
  if (!place) return { skip: 'skip_no_city' };
  return { cand: { s, url, nu, rawTags, place } };
}

/* ---------- Fair ordering ---------- */

const PLACE_RANK = { coords: 0, state: 1, name: 2 }; // anything else (tags, homepage, stream address) ranks 3
const rankOf = (c) => (c.place && PLACE_RANK[c.place.how] !== undefined ? PLACE_RANK[c.place.how] : 3);

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Puts candidates in the order to probe them: country by country, round-robin.
 * Countries are visited fewest-on-the-shelf first (ties in random order per run),
 * one station from each per round, so a run reaches many countries instead of
 * hundreds of stations from one. Within a country the best-placed come first
 * (coordinates, then region field, then name, then other clues), random among equals.
 * Duplicate stream addresses are taken once.
 * cands: [{ cc, nu, place, ... }]; shelfCounts: { CC: active stations on the shelf }.
 * opts: { max, cap (per country), rng }. -> { list, countries (distinct, in the list), duplicates }
 */
function orderCandidates(cands, shelfCounts = {}, { max = Infinity, cap = Infinity, rng = Math.random } = {}) {
  const groups = new Map();
  for (const c of cands) {
    const cc = String(c.cc || '??').toUpperCase();
    if (!groups.has(cc)) groups.set(cc, []);
    groups.get(cc).push(c);
  }
  for (const [cc, list] of groups) {
    groups.set(cc, shuffled(list, rng).sort((a, b) => rankOf(a) - rankOf(b))); // stable: the shuffle breaks ties
  }
  const order = shuffled([...groups.keys()], rng).sort((a, b) => (shelfCounts[a] || 0) - (shelfCounts[b] || 0));
  const next = new Map(order.map((cc) => [cc, 0]));
  const taken = new Map(order.map((cc) => [cc, 0]));
  const seen = new Set();
  const list = [];
  let duplicates = 0;
  for (let progress = true; progress && list.length < max;) {
    progress = false;
    for (const cc of order) {
      if (list.length >= max) break;
      const g = groups.get(cc);
      while (next.get(cc) < g.length && taken.get(cc) < cap) {
        const c = g[next.get(cc)];
        next.set(cc, next.get(cc) + 1);
        if (c.nu && seen.has(c.nu)) { duplicates++; continue; }
        if (c.nu) seen.add(c.nu);
        list.push(c); taken.set(cc, taken.get(cc) + 1); progress = true;
        break;
      }
    }
  }
  return { list, countries: new Set(list.map((c) => String(c.cc || '??').toUpperCase())).size, duplicates };
}

/* ---------- Icecast directory ---------- */

const ICECAST_ENDPOINTS = [
  'https://dir.xiph.org/yp.xml',
  'https://api.dir.xiph.org/experimental/full',
  'http://api.dir.xiph.org/experimental/full',
  'https://api.dir.xiph.org/experimental/',
];

const clip = (t, n = 300) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Tries the endpoints in order and uses the first that yields entries, logging
 * each one's status, content type, final address and first 300 characters.
 * Everything shares one time box (budgetMs). HTML pages are logged but never parsed.
 * -> { text (the winning body, '' if none), entries (its count), used (endpoint or null), tried: [{ url, status, type, finalUrl, start, entries, error }] }
 */
async function fetchIcecastDirectory({ fetchImpl = fetch, endpoints = ICECAST_ENDPOINTS, budgetMs = 60000, log = () => {}, now = Date.now, userAgent = cfg.USER_AGENT } = {}) {
  const end = now() + budgetMs;
  const tried = [];
  for (const url of endpoints) {
    const left = end - now();
    if (left < 1500) { tried.push({ url, error: 'no time left' }); log(`Icecast ${url}: skipped, time box used up`); continue; }
    const rec = { url };
    tried.push(rec);
    let text = '';
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/xml, application/json;q=0.9' }, signal: AbortSignal.timeout(Math.min(30000, left)) });
      rec.status = r.status; rec.type = (r.headers && r.headers.get && r.headers.get('content-type')) || ''; rec.finalUrl = r.url || url;
      text = r.ok ? await r.text() : '';
      rec.start = clip(text);
      if (!r.ok) rec.error = `HTTP ${r.status}`;
    } catch (e) { rec.error = e && e.message ? e.message : String(e); }
    log(`Icecast ${url}: ${rec.error || 'HTTP ' + rec.status}, ${rec.type || 'no content type'}, final ${rec.finalUrl || '-'}, start ${JSON.stringify(rec.start || '')}`);
    if (rec.error) continue;
    rec.entries = /html/i.test(rec.type) ? 0 : shelf.parseDirectory(text).length; // an HTML page is not a directory
    if (rec.entries) return { text, entries: rec.entries, used: url, tried };
  }
  return { text: '', entries: 0, used: null, tried };
}

/** One line for the run's notes: "ice[1:200/xml/0 2:ERR HTTP 404 3:... ]". */
function icecastSummary(res) {
  const part = (t, i) => `${i + 1}:${t.error ? `ERR ${clip(t.error, 40)}` : `${t.status}/${/json/i.test(t.type) ? 'json' : /xml/i.test(t.type) ? 'xml' : /html/i.test(t.type) ? 'html' : clip(t.type, 12) || '?'}/${t.entries || 0}`}`;
  return `icecast ${res.used ? `via #${res.tried.findIndex((t) => t.url === res.used) + 1} (${res.entries} entries)` : 'none'} [${res.tried.map(part).join(' ')}]`;
}

module.exports = { DAY, cacheFile, defaultCacheDir, readCache, writeCache, loadFullList, offlineCheck, orderCandidates, rankOf, ICECAST_ENDPOINTS, fetchIcecastDirectory, icecastSummary };
