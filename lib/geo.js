// Reverse-geocodes station coordinates to a city with OpenStreetMap Nominatim.
// Nominatim's usage policy allows about one request per second, so requests
// are queued and every result is cached for the life of the instance.
const { USER_AGENT, LIMITS } = require('./config');

const cache = new Map(); // "lat,lng" -> { city, country } | null
let chain = Promise.resolve();
let lastCall = 0;

const key = (lat, lng) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;

function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastCall + LIMITS.geocodeGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => null);
  return run;
}

async function reverseGeocode(lat, lng) {
  const k = key(lat, lng);
  if (cache.has(k)) return cache.get(k);
  const result = await throttled(async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`geocode HTTP ${r.status}`);
    const j = await r.json();
    const a = j.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.city_district || null;
    return city ? { city, country: a.country || null } : null;
  }).catch(() => undefined); // undefined = lookup failed, don't cache

  if (result !== undefined) cache.set(k, result);
  return result || null;
}

module.exports = { reverseGeocode };
