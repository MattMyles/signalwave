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
//
// How strict (Matt, 2026-11-18: "fall in the middle"): a main genre accepts any
// Apple label of its family (FITS). A style is judged on Apple's more specific
// labels (lib/stylelabels.js): a label that names the style fits, a label that
// only names the family fits ("Electronic" for Synthwave, since Apple has no
// Synthwave), a label that names a different style of the family doesn't
// (Techno on a Synthwave pick), and neither does a label outside the family.
// When Apple only gives the generic label, MusicBrainz's genres for the artist
// get a second opinion if they're already known (never asked for here).
// Era styles (Classic Rock, the decades) accept the whole family and add the
// release-year rule.
const { GENRES, STYLES } = require('./config');
const { has, BROAD, isTabled, labelVerdict, namesAnother } = require('./stylelabels');
const { artistKey, knownTags } = require('./mbtags');

const LOOKUP_TIMEOUT_MS = 2500;
const CACHE_MAX = 3000;
const cache = new Map(); // key -> { genres: [...], year } or null

// Apple's genre names that count as each main genre (patterns: see lib/stylelabels.js;
// a plain word matches the start of any word in the label). null = too broad to judge.
const FITS = {
  electronic: ['electronic', 'electronica', '=dance', 'eurodance', 'house', 'techno', 'trance', 'dubstep', 'drum & bass', 'drum and bass', "drum'n'bass", 'drum n bass', 'breakbeat', 'hardstyle', 'idm', 'edm', 'uk garage', 'garage house', 'speed garage', 'jungle', 'electro$', 'gabber', 'hard dance'],
  rock: ['rock', 'alternative', 'metal', 'punk', 'grunge', 'indie', 'britpop', 'psychedelic', 'prog', 'krautrock', 'shoegaze'],
  metal: ['metal', 'hard rock', 'rock'],
  punk: ['punk', 'alternative', 'rock', 'emo', '=hardcore'],
  pop: ['pop', '=dance', 'singer/songwriter', 'electronic'],
  hiphop: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill', 'grime', 'urbano'],
  soul: ['r&b', 'soul', 'funk', 'disco', 'gospel', 'motown'],
  jazz: ['jazz', 'bossa', 'swing', 'big band', 'vocal'],
  blues: ['blues'],
  classical: ['classical', 'opera', 'soundtrack', 'orchestral', 'baroque', 'piano', 'chamber', 'choral', 'score', 'instrumental'],
  ambient: ['ambient', 'new age', 'electronic', 'electronica', 'easy listening', 'chill', 'lounge', 'downtempo', 'instrumental', 'meditation', 'relaxation', 'soundtrack', 'trip hop', 'trip-hop'],
  latin: ['latin', 'latino', 'reggaeton', 'salsa', 'tropical', 'mexican', 'urbano', 'cumbia', 'bachata', 'tango', 'brazil', 'mpb', 'samba', 'sertanejo', 'forró', 'axé', 'pagode', 'flamenco', 'regional'],
  reggae: ['reggae$', 'ska$', 'dancehall', '=dub', 'dub reggae', 'rocksteady', 'ragga'], // not reggaeton, dubstep or "roots rock"
  world: null,
  country: ['country', 'folk', 'americana', 'bluegrass', 'singer/songwriter', 'sertanejo'], // not "roots" (Roots Reggae, Roots Rock)
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

/* ---------- Names ---------- */

// The old matcher: Latin letters and digits only. Keeps every existing cache key as it was.
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft|featuring)\b.*$/, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Letters of every script, for titles in Japanese, Korean, Chinese, Thai, Cyrillic...: width and
// compatibility forms folded (NFKC), accents off Latin letters, bracketed parts, punctuation and
// spaces dropped.
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFKC').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]|（.*?）|【.*?】|〈.*?〉|《.*?》/gu, ' ').replace(/(^|\s)(feat|ft|featuring)\b.*$/u, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, '');

/** True when the text has letters from a script other than Latin. */
const nonLatin = (s) => /\p{L}/u.test(String(s || '').replace(/\p{Script=Latin}/gu, ''));

/** "Artist - Song" -> { artist, song }, or null. Also the separators CJK stations use (／ ｜ － and " / ", Artist「Song」). */
function splitSong(title) {
  const t = String(title || '').trim();
  let m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (!m && nonLatin(t)) {
    m = /^(.+?)\s*[／｜－]\s*(.+)$/.exec(t) || /^(.+?)\s+\/\s+(.+)$/.exec(t) || /^(.+?)\s*[「『](.+?)[」』]\s*$/.exec(t);
  }
  if (!m) return null;
  const artist = m[1].trim(), song = m[2].trim();
  return artist.length >= 2 && song.length >= 2 ? { artist, song } : (nonLatin(artist + song) && artist.length >= 1 && song.length >= 1 ? { artist, song } : null);
}

/** True when this artist and song can be matched with the Latin-only names (the long-standing path). */
const latinPair = (artist, song) => !nonLatin(artist) && !nonLatin(song) && Boolean(plain(artist)) && Boolean(plain(song));

/** The cache key for a song: plain "artist - song"; for other scripts the folded names (both kept, so keys never collide). */
function songKey(artist, song) {
  return latinPair(artist, song) ? `${plain(artist)} - ${plain(song)}` : `${fold(artist)} - ${fold(song)}`;
}

/* ---------- Looking songs up ---------- */

// iTunes stores to ask for a station's country. A song titled in Japanese is in the Japanese
// store's catalogue; mainland China has no store of its own here, so Taiwan and Hong Kong are
// tried, then the default one. Anywhere else: the station's own country.
function storesFor(country) {
  const cc = String(country || '').toUpperCase();
  if (cc === 'CN') return ['TW', 'HK', null];
  return /^[A-Z]{2}$/.test(cc) ? [cc] : [null];
}

/**
 * Looks one song up in Apple's catalog: { genres, year } or null (not found,
 * or couldn't ask). The live path uses only the in-memory cache. The scout
 * passes opts to add a persistent cache and a request budget:
 *   cache.get(key)       -> info | null (known not to exist) | undefined (never asked)
 *   cache.set(key, info) -> called after every definite answer (info or null)
 *   gate()               -> false when the budget for new requests is spent
 *                           (nothing is asked, nothing is cached)
 *   country              -> the station's country code: titles in other scripts are
 *                           looked up in that country's iTunes store
 * Each store asked costs one gate() call.
 */
async function lookup(artist, song, opts = {}) {
  const latin = latinPair(artist, song);
  if (!latin && !(fold(artist) && fold(song))) return null; // nothing to match on
  const key = songKey(artist, song);
  if (cache.has(key)) return cache.get(key);
  if (opts.cache) {
    const hit = await opts.cache.get(key);
    if (hit !== undefined) { remember(key, hit); return hit; }
  }
  const norm = latin ? plain : fold;
  const a = norm(artist), s = norm(song);
  const same = (x, y) => x && y && (x.includes(y) || y.includes(x));
  const stores = latin ? [null] : storesFor(opts.country);
  let info = null;
  let asked = 0;
  try {
    for (const store of stores) {
      if (opts.gate && !(await opts.gate())) { if (!asked) return null; break; } // budget spent (each store asked is one request)
      asked++;
      const u = new URL('https://itunes.apple.com/search');
      const params = { term: `${artist} ${song}`, media: 'music', entity: 'song', limit: '10' };
      if (store) params.country = store;
      u.search = new URLSearchParams(params).toString();
      const r = await fetch(u, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      if (!r.ok) return null; // rate-limited or down: don't cache, just don't judge
      const j = await r.json();
      const matches = (j.results || []).filter((x) => same(norm(x.artistName), a) && same(norm(x.trackName), s));
      if (matches.length) {
        const years = matches.map((x) => parseInt(String(x.releaseDate || '').slice(0, 4), 10)).filter((y) => y > 1900);
        info = {
          genres: [...new Set(matches.map((x) => String(x.primaryGenreName || '').toLowerCase()).filter(Boolean))],
          year: years.length ? Math.min(...years) : null, // earliest: the original, not a remaster
        };
        break;
      }
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

/* ---------- Judging ---------- */

/** What MusicBrainz's genres say about a style: 'named' (this style or an alias), 'other' (a different style of the family, in its top 3) or 'none'. */
function mbOpinion(style, family, tags) {
  if (!tags || !tags.length) return 'none';
  if (tags.slice(0, 8).some((t) => labelVerdict(t, family, style) === 'named')) return 'named';
  if (tags.slice(0, 3).some((t) => namesAnother(t, family, style))) return 'other';
  return 'none';
}

/**
 * Judges a style pick against the song's Apple labels (and MusicBrainz tags when the labels are only
 * generic): { fit: true | false, named: true when something positively names the style }.
 */
function styleVerdict(style, family, info) {
  let generic = false;
  for (const label of info.genres) {
    const v = labelVerdict(label, family, style);
    if (v === 'named') return { fit: true, named: true };
    if (v === 'generic') generic = true;
  }
  if (!generic) return { fit: false, named: false };
  const op = mbOpinion(style, family, info.mb);
  if (op === 'named') return { fit: true, named: true };
  if (op === 'other') return { fit: false, named: false };
  return { fit: true, named: false };
}

/** Does this genre part accept a song with these Apple genres (info.genres), year and MusicBrainz tags (info.mb)? true/false/null. */
function judgePart(part, info) {
  const fams = familiesOf(part);
  if (!fams.length || fams.some((f) => FITS[f] === null || !FITS[f])) return null;
  const tag = part.key.startsWith('tag:') ? part.key.slice(4) : null;
  let fit, named = false;
  if (tag && isTabled(tag) && PARENT[tag] === fams[0]) {
    ({ fit, named } = styleVerdict(tag, fams[0], info));
  } else {
    const words = fams.flatMap((f) => FITS[f]);
    fit = info.genres.some((g) => has(g, words));
  }
  const era = tag && ERAS[tag];
  if (fit && era && info.year) fit = info.year >= era[0] && info.year <= era[1];
  return { fit, named: fit && named };
}
function partFits(part, info) {
  const j = judgePart(part, info);
  return j === null ? null : j.fit;
}

/** MusicBrainz tags to judge a song with: what's already known about the artist, or null. Never asks. */
const mbFor = (artist, opts) => knownTags(artist, opts);

/**
 * true / false / null for whether `title` fits `spec` (null spec = Any: always true).
 * With several genres picked, fitting any one of them is enough. opts as for
 * lookup() (a persistent cache and a request budget), plus opts.artists
 * (lib/artistcache.js) for MusicBrainz tags already on file.
 */
async function songFits(title, spec, opts) {
  if (!spec) return true;
  const parts = spec.parts || [spec];
  const s = splitSong(title);
  if (!s) return null;
  const info = await lookup(s.artist, s.song, opts);
  return fitOf(parts, info && info.genres.length ? { ...info, mb: mbFor(s.artist, opts) } : info);
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

/** Every genre key a song with this Apple info (and info.mb, MusicBrainz tags) fits. */
function fitKeys(info) {
  if (!info || !info.genres || !info.genres.length) return [];
  return ALL_KEYS.filter((key) => judgePart({ key }, info) && judgePart({ key }, info).fit);
}

/** The style keys this song positively names (a specific Apple label or MusicBrainz genre, not just the family's generic one). */
function namedKeys(info) {
  if (!info || !info.genres || !info.genres.length) return [];
  return ALL_KEYS.filter((key) => { const j = judgePart({ key }, info); return Boolean(j && j.named); });
}

/**
 * Looks up a "Artist - Song" title once: { info, known, key } where known means
 * Apple's catalog has the song. opts as for lookup(). info is null when the
 * title isn't "Artist - Song", the song wasn't found, or the budget is spent.
 */
async function songInfo(title, opts) {
  const s = splitSong(title);
  if (!s) return { info: null, known: false, key: null };
  const info = await lookup(s.artist, s.song, opts);
  return { info, known: Boolean(info && info.genres.length), key: songKey(s.artist, s.song), artist: s.artist };
}

module.exports = { songFits, fitOf, splitSong, partFits, judgePart, familiesOf, lookup, songKey, songInfo, fitKeys, namedKeys, isBroad, ALL_KEYS, ERAS, FITS, PARENT, fold, nonLatin, storesFor };
