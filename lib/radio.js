// Radio Browser directory client (https://www.radio-browser.info).
const { USER_AGENT } = require('./config');

const FALLBACK_SERVERS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
let servers = null;
let serversFetchedAt = 0;

async function getServers() {
  if (servers && Date.now() - serversFetchedAt < 60 * 60 * 1000) return servers;
  try {
    const r = await fetch('https://all.api.radio-browser.info/json/servers', {
      headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(4000),
    });
    const list = (await r.json()).map((s) => s.name).filter(Boolean);
    servers = [...new Set(list)].length ? [...new Set(list)] : FALLBACK_SERVERS;
  } catch (_) {
    servers = FALLBACK_SERVERS;
  }
  serversFetchedAt = Date.now();
  return servers;
}

// Tries mirrors in random order until one answers. `prefer` (a host) goes first;
// `deadline` (ms timestamp) stops trying more mirrors once passed. Returns
// { json, host }.
async function rbFetch(path, params = {}, { timeoutMs = 6000, prefer = null, deadline = 0 } = {}) {
  const list = [...(await getServers())].sort(() => Math.random() - 0.5);
  if (prefer) list.sort((a, b) => (a === prefer ? -1 : b === prefer ? 1 : 0));
  const qs = new URLSearchParams(params).toString();
  let lastErr;
  for (const host of list) {
    if (deadline && Date.now() > deadline) break;
    try {
      const r = await fetch(`https://${host}${path}${qs ? `?${qs}` : ''}`, {
        headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { json: await r.json(), host };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Radio Browser unreachable');
}
const rb = async (path, params = {}, opts = {}) => (await rbFetch(path, params, opts)).json;

// geo: only stations with map coordinates (the vetting search also takes
// stations without, and places them by their region or name).
// recent: newest changes first (stations added or edited lately), for the scout.
function searchStations({ tag, countrycode, limit = 60, geo = false, recent = false, offset = 0 } = {}) {
  const params = {
    is_https: 'true',
    lastcheckok: '1',
    hidebroken: 'true',
    order: recent ? 'changetimestamp' : 'random',
    limit: String(limit),
  };
  if (recent) params.reverse = 'true';
  if (offset) params.offset = String(offset);
  if (geo) params.has_geo_info = 'true';
  if (tag) params.tag = tag;
  if (countrycode) params.countrycode = countrycode;
  return rb('/json/stations/search', params);
}

// The fields of a station record that the scout uses; the rest is dropped so
// the whole list (about 48,000 stations) stays small in memory and in the cache.
const KEEP_FIELDS = ['stationuuid', 'name', 'url', 'url_resolved', 'homepage', 'favicon', 'tags', 'country', 'countrycode', 'state', 'language',
  'codec', 'bitrate', 'geo_lat', 'geo_long', 'lastcheckok', 'hls', 'ssl_error'];
function slimStation(s) {
  const o = {};
  for (const k of KEEP_FIELDS) if (s[k] !== undefined) o[k] = s[k];
  return o;
}

/**
 * Every working station Radio Browser knows (hidebroken), in pages of 10,000
 * ordered by stationuuid, until a short page. One mirror is kept for all pages
 * when it keeps answering (paging across mirrors could skip or repeat stations);
 * a page that fails tries the other mirrors. Throws if a page can't be had, so
 * the caller never gets a half list. Returns slimmed station records.
 */
async function allStations({ pageSize = 10000, timeoutMs = 120000, totalMs = 300000, maxPages = 30 } = {}) {
  const out = [];
  const deadline = Date.now() + totalMs;
  let host = null;
  for (let page = 0; page < maxPages; page++) {
    if (Date.now() > deadline) throw new Error('Radio Browser full list timed out');
    const got = await rbFetch('/json/stations', {
      hidebroken: 'true', order: 'stationuuid', limit: String(pageSize), offset: String(page * pageSize),
    }, { timeoutMs, prefer: host, deadline });
    host = got.host;
    if (!Array.isArray(got.json)) throw new Error('Radio Browser sent something that is not a station list');
    for (const s of got.json) if (s && s.stationuuid) out.push(slimStation(s));
    if (got.json.length < pageSize) return out;
  }
  throw new Error('Radio Browser full list has too many pages');
}

function stationByUuid(uuid) {
  return rb(`/json/stations/byuuid/${encodeURIComponent(uuid)}`).then((a) => a[0] || null);
}

// Tells the directory a station was played; this feeds its popularity ranking.
function reportClick(uuid) {
  return rb(`/json/url/${encodeURIComponent(uuid)}`).catch(() => null);
}

// Directory totals (stations, broken stations, ...), cached for an hour.
let dirStats = null;
let dirStatsAt = 0;
async function directoryStats() {
  if (dirStats && Date.now() - dirStatsAt < 3600000) return dirStats;
  try {
    const j = await rb('/json/stats');
    dirStats = { stations: j.stations, stationsBroken: j.stations_broken, countries: j.countries, tags: j.tags };
    dirStatsAt = Date.now();
  } catch (_) { /* keep the old value, if any */ }
  return dirStats;
}

// For tests: forget the cached mirror list.
function resetServers() { servers = null; serversFetchedAt = 0; }

module.exports = { searchStations, allStations, stationByUuid, reportClick, directoryStats, resetServers, KEEP_FIELDS };
