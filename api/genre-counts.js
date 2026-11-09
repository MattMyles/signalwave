// GET /api/genre-counts?genre=metal
// How many candidate stations the directory lists for a main genre and each of
// its styles: stations with a secure stream and map coordinates, the same first
// filters the app uses. Some of these still fail the live checks (fast start,
// real song titles, quality floor), so treat the numbers as an upper bound.
// Each style counts its other names too (TAG_ALIASES). Cached for a day.
const { GENRES, TAG_ALIASES } = require('../lib/config');
const { searchStations } = require('../lib/radio');
const { query, sendJson } = require('../lib/http');

const CAP = 300; // per name searched; totals at or above this show as "300+"
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map(); // tag → { ids: Set, at }

// Which main genre each style belongs to. Kept in step with CATALOG in public/app.js.
const STYLES = {
  electronic: ['house', 'deep house', 'tech house', 'techno', 'minimal', 'trance', 'psytrance', 'drum and bass', 'jungle', 'dubstep', 'uk garage', 'breakbeat', 'electro', 'synthwave', 'idm', 'hardstyle', 'edm'],
  rock: ['classic rock', 'hard rock', 'alternative', 'indie rock', 'grunge', 'progressive rock', 'psychedelic rock', 'garage rock', 'britpop', 'post-rock', 'shoegaze', 'stoner rock'],
  metal: ['heavy metal', 'thrash metal', 'death metal', 'black metal', 'doom metal', 'power metal', 'progressive metal', 'symphonic metal', 'metalcore', 'nu metal', 'industrial metal', 'folk metal'],
  punk: ['punk rock', 'pop punk', 'hardcore', 'post-punk', 'ska punk', 'emo'],
  pop: ['top 40', 'dance pop', 'synthpop', 'indie pop', 'dream pop', 'k-pop', 'j-pop', 'city pop', '80s', '90s', '00s'],
  hiphop: ['rap', 'trap', 'boom bap', 'old school hip-hop', 'drill', 'grime', 'lofi hip hop'],
  soul: ['rnb', 'neo soul', 'soul', 'funk', 'motown', 'disco', 'gospel'],
  jazz: ['smooth jazz', 'bebop', 'swing', 'big band', 'cool jazz', 'jazz fusion', 'acid jazz', 'latin jazz', 'bossa nova', 'nu jazz'],
  blues: ['delta blues', 'chicago blues', 'electric blues', 'blues rock'],
  classical: ['baroque', 'romantic', 'opera', 'orchestral', 'chamber music', 'piano', 'choral', 'contemporary classical', 'soundtrack'],
  ambient: ['chillout', 'lounge', 'downtempo', 'trip-hop', 'chillwave', 'lofi', 'new age', 'meditation', 'space music', 'dark ambient', 'drone'],
  latin: ['salsa', 'reggaeton', 'cumbia', 'bachata', 'merengue', 'tango', 'samba', 'latin pop', 'regional mexicano', 'mariachi', 'forro'],
  reggae: ['roots reggae', 'dub', 'dancehall', 'ska', 'lovers rock', 'reggae fusion'],
  world: ['afrobeat', 'afrobeats', 'highlife', 'bollywood', 'celtic', 'flamenco', 'fado', 'arabic', 'balkan', 'turkish', 'chanson'],
  country: ['country', 'classic country', 'outlaw country', 'alt-country', 'bluegrass', 'americana', 'folk', 'indie folk', 'singer-songwriter'],
};

async function idsForTag(tag) {
  const hit = cache.get(tag);
  if (hit && Date.now() - hit.at < DAY) return hit.ids;
  const list = await searchStations({ tag, limit: CAP });
  const ids = new Set(list.filter((s) => s.stationuuid && (s.url_resolved || '').startsWith('https://')).map((s) => s.stationuuid));
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
