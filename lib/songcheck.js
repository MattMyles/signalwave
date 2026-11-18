// Song check: does the song a station is playing actually fit the genre the
// listener picked? Station tags only say what a station claims to play, so
// while vetting we look the current song up in Apple's public music catalog
// (iTunes Search API: free, no key) and compare its genre, and for "classic"
// and decade styles its original release year.
//
// songFits() answers true (fits), false (clearly doesn't) or null (couldn't
// tell: no "Artist - Song" title, song not found, lookup slow or refused, or
// a genre too broad to judge, like World). Only false rejects a station, so a
// failed lookup never costs a listener a station.
const { GENRES, STYLES } = require('./config');

const LOOKUP_TIMEOUT_MS = 2500;
const CACHE_MAX = 3000;
const cache = new Map(); // "artist|song" -> { genres: [...], year } or null

// Words in Apple's genre names (lower case) that count as each main genre.
// null = too broad to judge.
const FITS = {
  electronic: ['electronic', 'dance', 'house', 'techno', 'trance', 'dubstep', 'drum & bass', 'drum and bass', 'breakbeat', 'electronica', 'hardstyle', 'idm', 'edm', 'garage', 'jungle'],
  rock: ['rock', 'alternative', 'metal', 'punk', 'grunge', 'indie', 'britpop', 'psychedelic', 'prog'],
  metal: ['metal', 'hard rock', 'rock'],
  punk: ['punk', 'alternative', 'rock', 'emo', 'hardcore'],
  pop: ['pop', 'dance', 'singer/songwriter', 'electronic'],
  hiphop: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill', 'grime', 'urbano'],
  soul: ['r&b', 'soul', 'funk', 'disco', 'gospel', 'motown'],
  jazz: ['jazz', 'bossa', 'swing', 'big band', 'vocal'],
  blues: ['blues'],
  classical: ['classical', 'opera', 'soundtrack', 'orchestral', 'baroque', 'piano', 'chamber', 'choral', 'score', 'instrumental'],
  ambient: ['ambient', 'new age', 'electronic', 'electronica', 'easy listening', 'chill', 'lounge', 'downtempo', 'instrumental', 'meditation', 'relaxation', 'soundtrack', 'trip hop'],
  latin: ['latin', 'latino', 'reggaeton', 'salsa', 'tropical', 'mexican', 'mexicano', 'urbano', 'cumbia', 'bachata', 'tango', 'brazil', 'mpb', 'samba', 'sertanejo', 'forró', 'axé', 'pagode', 'flamenco', 'regional'],
  reggae: ['reggae', 'ska', 'dancehall', 'dub', 'roots'],
  world: null,
  country: ['country', 'folk', 'americana', 'bluegrass', 'singer/songwriter', 'roots', 'sertanejo'],
};

// Styles defined by era: the song's original release year must fall in range.
const ERAS = {
  'classic rock': [0, 1994],
  'classic country': [0, 1999],
  motown: [0, 1985],
  'old school hip-hop': [0, 1999],
  '80s': [1980, 1989],
  '90s': [1990, 1999],
  '00s': [2000, 2009],
};

// Style -> its main genre, from the app's style lists.
const PARENT = {};
for (const [main, styles] of Object.entries(STYLES)) for (const s of styles) PARENT[s] = PARENT[s] || main;

/** The main genres a genre part belongs to ({ key: 'rock' } or { key: 'tag:classic rock' }). */
function familiesOf(part) {
  if (GENRES[part.key]) return [part.key];
  const tag = part.key.startsWith('tag:') ? part.key.slice(4) : part.key;
  if (PARENT[tag]) return [PARENT[tag]];
  return Object.entries(GENRES).filter(([, g]) => g.tags.some((x) => tag.includes(x))).map(([k]) => k);
}

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft|featuring)\b.*$/, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** "Artist - Song" -> { artist, song }, or null. */
function splitSong(title) {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(String(title || '').trim());
  if (!m) return null;
  const artist = m[1].trim(), song = m[2].trim();
  return artist.length >= 2 && song.length >= 2 ? { artist, song } : null;
}

/** The cache key for a song: plain "artist - song". */
function songKey(artist, song) { return `${plain(artist)} - ${plain(song)}`; }

/**
 * Looks one song up in Apple's catalog: { genres, year } or null (not found,
 * or couldn't ask). The live path uses only the in-memory cache. The scout
 * passes opts to add a persistent cache and a request budget:
 *   cache.get(key)       -> info | null (known not to exist) | undefined (never asked)
 *   cache.set(key, info) -> called after every definite answer (info or null)
 *   gate()               -> false when the budget for new requests is spent
 *                           (nothing is asked, nothing is cached)
 */
async function lookup(artist, song, opts = {}) {
  if (!plain(artist) || !plain(song)) return null; // nothing Latin to match on (Apple's names wouldn't match anyway)
  const key = songKey(artist, song);
  if (cache.has(key)) return cache.get(key);
  if (opts.cache) {
    const hit = await opts.cache.get(key);
    if (hit !== undefined) { remember(key, hit); return hit; }
  }
  if (opts.gate && !(await opts.gate())) return null;
  let info = null;
  try {
    const u = new URL('https://itunes.apple.com/search');
    u.search = new URLSearchParams({ term: `${artist} ${song}`, media: 'music', entity: 'song', limit: '10' }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!r.ok) return null; // rate-limited or down: don't cache, just don't judge
    const j = await r.json();
    const a = plain(artist), s = plain(song);
    const same = (x, y) => x && y && (x.includes(y) || y.includes(x));
    const matches = (j.results || []).filter((x) => same(plain(x.artistName), a) && same(plain(x.trackName), s));
    if (matches.length) {
      const years = matches.map((x) => parseInt(String(x.releaseDate || '').slice(0, 4), 10)).filter((y) => y > 1900);
      info = {
        genres: [...new Set(matches.map((x) => String(x.primaryGenreName || '').toLowerCase()).filter(Boolean))],
        year: years.length ? Math.min(...years) : null, // earliest: the original, not a remaster
      };
    }
  } catch (_) {
    return null;
  }
  remember(key, info);
  if (opts.cache) { try { await opts.cache.set(key, info); } catch (_) { /* cache only */ } }
  return info;
}
function remember(key, info) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, info);
}

/** Does this genre part accept a song with these Apple genres and year? true/false/null. */
function partFits(part, info) {
  const fams = familiesOf(part);
  if (!fams.length || fams.some((f) => FITS[f] === null || !FITS[f])) return null;
  const words = fams.flatMap((f) => FITS[f]);
  if (!info.genres.some((g) => words.some((w) => g.includes(w)))) return false;
  const tag = part.key.startsWith('tag:') ? part.key.slice(4) : null;
  const era = tag && ERAS[tag];
  if (era && info.year) return info.year >= era[0] && info.year <= era[1];
  return true;
}

/**
 * true / false / null for whether `title` fits `spec` (null spec = Any: always true).
 * With several genres picked, fitting any one of them is enough. opts as for
 * lookup() (a persistent cache and a request budget).
 */
async function songFits(title, spec, opts) {
  if (!spec) return true;
  const parts = spec.parts || [spec];
  const s = splitSong(title);
  if (!s) return null;
  const info = await lookup(s.artist, s.song, opts);
  return fitOf(parts, info);
}

/** true / false / null for genre parts against a song's Apple info (null info: unknown). Fitting any part is enough. */
function fitOf(parts, info) {
  if (!info || !info.genres.length) return null;
  const answers = parts.map((p) => partFits(p, info));
  if (answers.includes(true)) return true;
  if (answers.includes(null)) return null;
  return false;
}

/** Every genre key the app knows: the 15 main ids and every style as 'tag:<style>'. */
const ALL_KEYS = [...new Set([...Object.keys(GENRES), ...Object.values(STYLES).flat().map((t) => `tag:${t}`)])];

/** True for genres songs can't be judged against (World and its styles). */
function isBroad(key) {
  const fams = familiesOf({ key });
  return !fams.length || fams.some((f) => FITS[f] === null || !FITS[f]);
}

/** Every genre key a song with this Apple info fits (partFits true). */
function fitKeys(info) {
  if (!info || !info.genres || !info.genres.length) return [];
  return ALL_KEYS.filter((key) => partFits({ key }, info) === true);
}

/**
 * Looks up a "Artist - Song" title once: { info, known } where known means
 * Apple's catalog has the song. opts as for lookup(). info is null when the
 * title isn't "Artist - Song", the song wasn't found, or the budget is spent.
 */
async function songInfo(title, opts) {
  const s = splitSong(title);
  if (!s) return { info: null, known: false, key: null };
  const info = await lookup(s.artist, s.song, opts);
  return { info, known: Boolean(info && info.genres.length), key: songKey(s.artist, s.song) };
}

module.exports = { songFits, fitOf, splitSong, partFits, familiesOf, lookup, songKey, songInfo, fitKeys, isBroad, ALL_KEYS, ERAS };
