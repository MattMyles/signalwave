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

// Tries mirrors in random order until one answers.
async function rb(path, params = {}) {
  const list = [...(await getServers())].sort(() => Math.random() - 0.5);
  const qs = new URLSearchParams(params).toString();
  let lastErr;
  for (const host of list) {
    try {
      const r = await fetch(`https://${host}${path}${qs ? `?${qs}` : ''}`, {
        headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Radio Browser unreachable');
}

function searchStations({ tag, countrycode, limit = 60 } = {}) {
  const params = {
    has_geo_info: 'true',
    is_https: 'true',
    lastcheckok: '1',
    hidebroken: 'true',
    order: 'random',
    limit: String(limit),
  };
  if (tag) params.tag = tag;
  if (countrycode) params.countrycode = countrycode;
  return rb('/json/stations/search', params);
}

function stationByUuid(uuid) {
  return rb(`/json/stations/byuuid/${encodeURIComponent(uuid)}`).then((a) => a[0] || null);
}

// Tells the directory a station was played; this feeds its popularity ranking.
function reportClick(uuid) {
  return rb(`/json/url/${encodeURIComponent(uuid)}`).catch(() => null);
}

module.exports = { searchStations, stationByUuid, reportClick };
