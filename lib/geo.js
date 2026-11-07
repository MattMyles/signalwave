// Finds the city a station is in from its coordinates, using a bundled list
// of ~49,000 places with 5,000+ people (lib/cities.json, from GeoNames,
// CC BY 4.0, via the all-the-cities package). It runs locally: instant, no
// outside service, no rate limits.
const CITIES = require('./cities.json'); // [name, lat, lng, countryCode, population]

const MAX_KM = 40; // farther than this from any town = "no city"
const METRO_KM = 20; // a big city this close wins over a nearby small town
const METRO_POP = 500000;

// 1° x 1° grid so a lookup only checks nearby places.
const grid = new Map();
for (const c of CITIES) {
  const k = `${Math.floor(c[1])},${Math.floor(c[2])}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(c);
}

function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function nearby(lat, lng) {
  const out = [];
  const la = Math.floor(lat);
  const lo = Math.floor(lng);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let x = lo + dx;
      if (x < -180) x += 360;
      if (x >= 180) x -= 360;
      const cell = grid.get(`${la + dy},${x}`);
      if (cell) for (const c of cell) out.push([c, km(lat, lng, c[1], c[2])]);
    }
  }
  return out;
}

/**
 * reverseGeocode(lat, lng, countryCode?) → { city, countryCode } or null.
 * Prefers places in the station's own country, and a big city close by over
 * a small town next door (a station in Brooklyn shows as New York City).
 */
async function reverseGeocode(lat, lng, countryCode) {
  lat = Number(lat);
  lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  let found = nearby(lat, lng).filter(([, d]) => d <= MAX_KM);
  const cc = String(countryCode || '').toUpperCase();
  if (cc) {
    const same = found.filter(([c]) => c[3] === cc);
    if (same.length) found = same;
  }
  if (!found.length) return null;
  found.sort((a, b) => a[1] - b[1]);
  const metro = found.filter(([c, d]) => d <= METRO_KM && c[4] >= METRO_POP).sort((a, b) => b[0][4] - a[0][4])[0];
  const best = metro || found[0];
  return { city: best[0][0], countryCode: best[0][3] };
}

// The biggest place in a country, for stations with no map location.
const biggest = new Map();
for (const c of CITIES) { const b = biggest.get(c[3]); if (!b || c[4] > b[4]) biggest.set(c[3], c); }
function largestCity(countryCode) {
  const c = biggest.get(String(countryCode || '').toUpperCase());
  return c ? { city: c[0], lat: c[1], lng: c[2] } : null;
}

module.exports = { reverseGeocode, largestCity };
