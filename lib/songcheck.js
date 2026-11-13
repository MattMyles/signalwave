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
  country: ['country', 'folk', 'americana', 'bluegrass', 'singer/songwriter', 'roots'],
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

async function lookup(artist, song) {
  const key = `${plain(artist)}|${plain(song)}`;
  if (cache.has(key)) return cache.get(key);
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
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, info);
  return info;
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
 * With several genres picked, fitting any one of them is enough.
 */
async function songFits(title, spec) {
  if (!spec) return true;
  const parts = spec.parts || [spec];
  const s = splitSong(title);
  if (!s) return null;
  const info = await lookup(s.artist, s.song);
  if (!info || !info.genres.length) return null;
  const answers = parts.map((p) => partFits(p, info));
  if (answers.includes(true)) return true;
  if (answers.includes(null)) return null;
  return false;
}

module.exports = { songFits, splitSong, partFits, familiesOf };
