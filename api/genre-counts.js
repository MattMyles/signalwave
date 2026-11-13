// GET /api/genre-counts?genre=metal
// How many candidate stations the directory lists for a main genre and each of
// its styles: stations with a secure stream and map coordinates, the same first
// filters the app uses. Some of these still fail the live checks (fast start,
// real song titles, quality floor), so treat the numbers as an upper bound.
// Each style counts its other names too (TAG_ALIASES). Cached for a day.
const { GENRES, STYLES, TAG_ALIASES } = require('../lib/config');
const { searchStations } = require('../lib/radio');
const { cityFromText } = require('../lib/geo');
const { query, sendJson } = require('../lib/http');

const CAP = 300; // per name searched; totals at or above this show as "300+"
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map(); // tag → { ids: Set, at }

// Which main genre each style belongs to. Kept in step with CATALOG in public/app.js.


async function idsForTag(tag) {
  const hit = cache.get(tag);
  if (hit && Date.now() - hit.at < DAY) return hit.ids;
  const list = await searchStations({ tag, limit: CAP });
  // Counts stations the app could place on the map: coordinates, or a city in
  // their listed region or name (see cityFromText in lib/geo.js).
  const placeable = (s) => (s.geo_lat != null && s.geo_long != null) || cityFromText(s.state, s.name, s.countrycode);
  const ids = new Set(list.filter((s) => s.stationuuid && (s.url_resolved || '').startsWith('https://') && placeable(s)).map((s) => s.stationuuid));
  cache.set(tag, { ids, at: Date.now() });
  return ids;
}

async function countNames(names) {
  const all = new Set();
  let capped = false;
  for (const ids of await Promise.all(names.map((n) => idsForTag(n).catch(() => new Set())))) {
    if (ids.size >= CAP) capped = true;
    ids.forEach((id) => all.add(id));
  }
  return { n: all.size, more: capped };
}

module.exports = async function handler(req, res) {
  const genre = String(query(req).get('genre') || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!GENRES[genre] || !STYLES[genre]) return sendJson(res, 400, { error: 'Unknown genre.' });
  const jobs = [
    [genre, GENRES[genre].tags],
    ...STYLES[genre].map((t) => [`tag:${t}`, [t, ...(TAG_ALIASES[t] || [])]]),
  ];
  // A few at a time, to be kind to the directory.
  const counts = {};
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = jobs.slice(i, i + 6);
    const results = await Promise.all(batch.map(([, names]) => countNames(names)));
    batch.forEach(([id], k) => { counts[id] = results[k]; });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
  sendJson(res, 200, { genre, counts });
};
