// Matching a genre's names against a station's tags.
//
// A genre or style has several names (its own, plus TAG_ALIASES in
// lib/config.js). A plain name matches when any tag contains it (substring).
// A compound name written 'a+b' is for aliases that are too broad on their own:
// the station must have a tag matching a AND a tag matching b, each by the
// same substring rule. The two may be the same tag: "roots reggae" satisfies
// 'roots+reggae' by itself, and so does a station tagged "reggae,roots".
// Compound names only exist in config; the listener-added tag pattern
// (TAG_PATTERN) can't contain '+'.

const isCompound = (name) => String(name).includes('+');
const termsOf = (name) => String(name).split('+').map((s) => s.trim()).filter(Boolean);

/** The word to search the directory for: a plain name as it is, a compound name's first term. */
const searchTerm = (name) => (isCompound(name) ? termsOf(name)[0] || '' : String(name));

/** Search words for a list of names, compound ones reduced to their first term, no repeats. */
const searchTerms = (names) => [...new Set(names.map(searchTerm).filter(Boolean))];

/** Plain names only (what "music word" lists and substring scans can use). */
const plainNames = (names) => names.filter((n) => !isCompound(n));

/** Does this tag list satisfy the name? (tags: lower-case strings.) */
function nameHits(tags, name) {
  if (!isCompound(name)) return tags.some((t) => t.includes(name));
  return termsOf(name).every((term) => tags.some((t) => t.includes(term)));
}

/** Does this tag list satisfy any of the names? */
const anyNameHits = (tags, names) => names.some((n) => nameHits(tags, n));

/**
 * Does this one tag count as naming the genre, given all of the station's tags?
 * A plain name: the tag contains it. A compound name: the tag contains one of
 * its terms and the station's tags as a whole satisfy it.
 */
function tagHits(tag, tags, names) {
  return names.some((n) => (isCompound(n) ? termsOf(n).some((term) => tag.includes(term)) && nameHits(tags, n) : tag.includes(n)));
}

/** Is a long-enough name (or every term of a compound) found in the station's name? */
function nameInText(text, name, minLen = 4) {
  const parts = isCompound(name) ? termsOf(name) : [name];
  return parts.every((p) => p.length >= minLen && text.includes(p));
}

module.exports = { isCompound, termsOf, searchTerm, searchTerms, plainNames, nameHits, anyNameHits, tagHits, nameInText };

/* ---------- Negated genre mentions ----------
 * Stations describe themselves by what they are not: "all genre on earth except trap",
 * "todos los géneros excepto trap y similares", "everything but metal", "trap-free zone".
 * Substring matching would count those as the genre. A negated mention is a negation word
 * (except, but, sin, ohne, 除了 ...), up to 3 filler words (any, the, more, music ...) and then a
 * genre term; or a term followed by "free" ("trap-free", "trap free zone"). Only genre terms count,
 * so "non-stop", "no ads", "no copyright sounds" and "anti-flag" are untouched.
 *
 * The genre terms are built from GENRES, STYLES, TAG_ALIASES and every translation (lib/translate.js's
 * word list), so the rule covers every genre, style, alias and language automatically; nothing is a hand list.
 *
 * What the rest of the code uses:
 *   negatedTerms(texts)      the genre terms (English) the station negates, from its name and tags
 *   scrubTags(tags, neg)     the tags with negated phrases, and the negated words anywhere else, removed
 *                            (so "rap" can't hide in a leftover "and things like trap")
 *   negatesSpec(neg, spec)   does the station negate this pick? Station-wide: once any tag or the name
 *                            negates trap, the station is out for trap. Negating a main genre ("no rock")
 *                            also rules out that genre's styles; negating a style doesn't rule out its main genre.
 *   narrowSpec(spec, neg)    a several-genres pick without the genres the station negates (null when none are left) */

const { GENRES, STYLES, TAG_ALIASES } = require('./config');

const NEGATORS = new Set([
  // English
  'except', 'excepting', 'excluding', 'exclude', 'excludes', 'without', 'no', 'not', 'non', 'minus', 'anti',
  // French, Spanish, Portuguese, Italian
  'sans', 'sauf', 'excepté', 'excepte', 'hors', 'excepto', 'menos', 'sin', 'sem', 'exceto', 'tranne', 'senza',
  // German, Dutch, Scandinavian, Finnish
  'außer', 'ausser', 'ohne', 'kein', 'keine', 'keinen', 'nicht', 'zonder', 'geen', 'behalve', 'utom', 'utan', 'uden', 'uten', 'ikke', 'ilman',
  // Slavic
  'kromě', 'bez', 'oprócz', 'кроме', 'без', 'крім', 'окрім',
]);
// "but" only counts as "all but X": "rock but pop" is not a negation.
const BUT_AFTER = new Set(['everything', 'all', 'anything', 'any', 'every', 'genres', 'genre', 'styles', 'style', 'music', 'todo', 'todos', 'tudo', 'tout', 'alles']);
const NEG_PHRASES = [['other', 'than'], ['apart', 'from'], ['free', 'of'], ['free', 'from']];
const FILLERS = new Set([
  'any', 'the', 'a', 'an', 'more', 'all', 'of', 'some', 'kind', 'kinds', 'type', 'types', 'sort', 'sorts', 'genre', 'genres', 'style', 'styles', 'music', 'musica', 'música', 'musik', 'musique', 'muziek',
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'le', 'les', 'der', 'die', 'das', 'den', 'il', 'lo', 'gli', 'os', 'as',
  'cualquier', 'ningún', 'ningun', 'ninguna', 'otros', 'otro', 'otra', 'otras', 'outros', 'outro', 'autres', 'autre', 'andere',
]);
const CONNECT = new Set(['and', 'y', 'e', 'et', 'und', 'or', 'o', 'ou', 'oder', '&', 'nor', 'ni', 'en']);
const SUFFIX_FREE_THEN = new Set(['zone', 'zones', 'area', 'areas']); // "trap free zone", not "Rock Free Radio"
const SUFFIX_TOKENS = new Set(['제외', '없는', '빼고']);
// Japanese and Chinese have no spaces, so their negations are found inside the text.
const CJK = /[぀-ヿ㐀-鿿]/;
const CJK_BEFORE = ['除了', '除去', '不含', '不要', '没有', '沒有', '除外', '非'];
const CJK_AFTER = ['以外', '抜き', 'なし', '不要', '以外の'];

const TOKEN = /[\p{L}\p{M}\p{N}&']+/gu;
const trimApos = (w) => w.replace(/^'+|'+$/g, '');
function tokenize(text) {
  const out = [];
  for (const m of String(text).matchAll(TOKEN)) {
    const w = trimApos(m[0].toLowerCase());
    if (w) out.push({ w, s: m.index, e: m.index + m[0].length });
  }
  return out;
}
const words = (text) => tokenize(text).map((t) => t.w);
/** One form for comparing names: lower case, punctuation and hyphens as single spaces. "Hip-Hop" -> "hip hop". */
const normName = (s) => words(s).join(' ');

let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  const exact = new Map(); // first word -> entries, longest first
  const stems = []; // foreign words that match as the start of a longer word (psicodéli -> psicodélico)
  const cjk = []; // Japanese/Chinese words, matched inside text
  const english = new Set();
  const add = (toks, canon, stem) => {
    const e = { toks, canon, stem };
    if (stem) { stems.push(e); return; }
    if (!exact.has(toks[0])) exact.set(toks[0], []);
    exact.get(toks[0]).push(e);
  };
  const englishNames = [
    ...Object.values(GENRES).flatMap((g) => g.tags),
    ...Object.keys(GENRES),
    ...Object.values(STYLES).flat(),
    ...Object.keys(TAG_ALIASES),
    ...Object.values(TAG_ALIASES).flat().filter((n) => !isCompound(n)),
  ];
  for (const name of new Set(englishNames)) {
    const toks = words(name);
    if (!toks.length) continue;
    english.add(toks.join(' '));
    add(toks, toks.join(' '), false);
  }
  // Every translation of a genre or style (lazy require: lib/translate.js loads this file first).
  for (const [word, en] of require('./translate').LOOKUP) {
    const canon = normName(en);
    if (!english.has(canon)) continue; // news, talk and sport words are not genres
    if (CJK.test(word)) { cjk.push({ word: word.trim().toLowerCase(), canon }); continue; }
    const toks = words(word);
    if (!toks.length) continue;
    add(toks, canon, !/\s$/.test(word) && toks[toks.length - 1].length >= 4);
  }
  for (const list of exact.values()) list.sort((a, b) => b.toks.length - a.toks.length);
  cjk.sort((a, b) => b.word.length - a.word.length);
  TABLE = { exact, stems, cjk, english };
  return TABLE;
}

/** The longest genre term starting at token j: { n (tokens), canon } or null. */
function termAt(toks, j) {
  if (j >= toks.length) return null;
  const { exact, stems } = table();
  let best = null;
  const size = (e) => e.toks.reduce((a, t) => a + t.length, 0);
  const consider = (e) => { // more words first, then more letters (металкор over its stem метал)
    if (!best || e.toks.length > best.n || (e.toks.length === best.n && size(e) > best.size)) best = { n: e.toks.length, canon: e.canon, size: size(e) };
  };
  const fits = (e, stem) => {
    if (j + e.toks.length > toks.length) return false;
    const last = e.toks.length - 1;
    for (let k = 0; k < last; k++) if (toks[j + k].w !== e.toks[k]) return false;
    return stem ? toks[j + last].w.startsWith(e.toks[last]) : toks[j + last].w === e.toks[last];
  };
  for (const e of exact.get(toks[j].w) || []) if (fits(e, false)) consider(e);
  for (const e of stems) if (fits(e, true)) consider(e);
  return best && { n: best.n, canon: best.canon };
}

/** The genre term after a negation at token j, allowing up to 3 filler words first: { at, n, canon } or null. */
function termAfterFillers(toks, j) {
  for (let f = 0; ; f++) {
    const m = termAt(toks, j);
    if (m) return { at: j, ...m };
    if (f >= 3 || j >= toks.length || !FILLERS.has(toks[j].w)) return null;
    j++;
  }
}

/** Length (in tokens) of the negation phrase starting at token i, or 0. */
function negatorLen(toks, i) {
  const w = toks[i].w;
  for (const p of NEG_PHRASES) if (w === p[0] && toks[i + 1] && toks[i + 1].w === p[1]) return 2;
  if (NEGATORS.has(w)) return 1;
  if (w === 'but' && i > 0 && BUT_AFTER.has(toks[i - 1].w)) return 1;
  return 0;
}

function applyCuts(text, cuts) {
  if (!cuts.length) return text;
  cuts.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [s, e] of cuts) {
    if (e <= at) continue;
    out += `${text.slice(at, Math.max(s, at))} `;
    at = e;
  }
  return `${out}${text.slice(at)}`.replace(/\s+/g, ' ').trim();
}

const scanCache = new Map();
/** { neg: [terms], clean } for one text: the genre terms it negates, and the text without those phrases (the text itself when there are none). */
function scan(input) {
  const text = String(input == null ? '' : input);
  if (scanCache.has(text)) return scanCache.get(text);
  const neg = new Set();
  let cur = text.toLowerCase();
  let touched = false;
  if (CJK.test(cur)) {
    const cuts = [];
    for (const { word, canon } of table().cjk) {
      for (const pre of CJK_BEFORE) for (let at = cur.indexOf(pre + word); at >= 0; at = cur.indexOf(pre + word, at + 1)) { cuts.push([at, at + pre.length + word.length]); neg.add(canon); }
      for (const suf of CJK_AFTER) for (let at = cur.indexOf(word + suf); at >= 0; at = cur.indexOf(word + suf, at + 1)) { cuts.push([at, at + word.length + suf.length]); neg.add(canon); }
    }
    if (cuts.length) { cur = applyCuts(cur, cuts); touched = true; }
  }
  const toks = tokenize(cur);
  const cuts = [];
  let i = 0;
  while (i < toks.length) {
    const L = negatorLen(toks, i);
    if (L) {
      const m = termAfterFillers(toks, i + L);
      if (m) {
        neg.add(m.canon);
        let end = m.at + m.n;
        // "except jazz and pop": the list goes on while a connector and another genre follow.
        while (end < toks.length && CONNECT.has(toks[end].w)) {
          const m2 = termAfterFillers(toks, end + 1);
          if (!m2) break;
          neg.add(m2.canon);
          end = m2.at + m2.n;
        }
        cuts.push([toks[i].s, toks[end - 1].e]);
        i = end;
        continue;
      }
    } else if (toks[i].w === 'free' || SUFFIX_TOKENS.has(toks[i].w)) {
      // "trap-free", "trap free zone", "트랩 제외": the genre term comes first.
      const free = toks[i].w === 'free';
      const next = toks[i + 1];
      if (!free || !next || SUFFIX_FREE_THEN.has(next.w)) {
        for (let n = 4; n >= 1; n--) { // the longest term first: "deep house free" is deep house, not house
          if (i - n < 0) continue;
          const m = termAt(toks, i - n);
          if (m && m.n === n) { neg.add(m.canon); cuts.push([toks[i - n].s, toks[i].e]); break; }
        }
      }
    }
    i++;
  }
  if (cuts.length) { cur = applyCuts(cur, cuts); touched = true; }
  const result = { neg: [...neg], clean: touched ? cur : text };
  if (scanCache.size > 50000) scanCache.clear();
  scanCache.set(text, result);
  return result;
}

/** The genre terms (English, lower case, hyphens as spaces) negated anywhere in these texts (a station's name and tags). */
function negatedTerms(texts) {
  const out = new Set();
  for (const t of texts || []) if (t) for (const x of scan(t).neg) out.add(x);
  return out;
}

/** One text without negated phrases and without any word the station negates anywhere ("and things like trap"). */
function scrubText(text, neg) {
  const { clean } = scan(text);
  if (!neg || !neg.size) return clean;
  const toks = tokenize(clean);
  const cuts = [];
  for (let i = 0; i < toks.length;) {
    const m = termAt(toks, i);
    if (m) { if (neg.has(m.canon)) cuts.push([toks[i].s, toks[i + m.n - 1].e]); i += m.n; } else i++;
  }
  return cuts.length ? applyCuts(clean, cuts) : clean;
}

/** Tags with negated mentions removed (empty ones dropped). Without any negation: the same tags. */
function scrubTags(tags, neg = negatedTerms(tags)) {
  return tags.map((t) => scrubText(t, neg)).filter(Boolean);
}

let MAIN_NAMES = null;
let PARENT = null;
/** The names that mean a whole main genre: its first tag, its id and that tag's aliases ("hip-hop", "hiphop", "hip hop"). */
function mainNames(key) {
  if (!MAIN_NAMES) {
    MAIN_NAMES = {};
    for (const [k, g] of Object.entries(GENRES)) {
      const first = g.tags[0];
      MAIN_NAMES[k] = [...new Set([first, k, ...(TAG_ALIASES[first] || []).filter((n) => !isCompound(n))].map(normName))];
    }
  }
  return MAIN_NAMES[key] || [];
}
/** The main genre a style belongs to (first match in STYLES), or null. */
function parentOf(style) {
  if (!PARENT) {
    PARENT = new Map();
    for (const [main, list] of Object.entries(STYLES)) for (const s of list) if (!PARENT.has(normName(s))) PARENT.set(normName(s), main);
  }
  return PARENT.get(normName(style)) || null;
}

/**
 * Does a station that negates these terms rule out this pick? spec: { key, tags } (a main genre key or
 * 'tag:<style>'), or a several-genres pick ({ parts }), which is only ruled out when every part is.
 */
function negatesSpec(neg, spec) {
  if (!spec || !neg || !neg.size) return false;
  if (spec.parts) return spec.parts.every((p) => negatesSpec(neg, p));
  const main = Object.prototype.hasOwnProperty.call(GENRES, spec.key);
  // A main genre is ruled out by its own names only ("no classic rock" leaves Rock alone); a style by any of its names.
  const names = main ? mainNames(spec.key) : plainNames(spec.tags || []).map(normName);
  if (names.some((n) => neg.has(n))) return true;
  if (!main) {
    const style = String(spec.key || '').startsWith('tag:') ? spec.key.slice(4) : (spec.tags || [])[0];
    const parent = parentOf(style);
    if (parent && mainNames(parent).some((n) => neg.has(n))) return true; // "no rock" rules out classic rock too
  }
  return false;
}

/** The pick without the genres the station negates; null when nothing is left. A several-genres pick narrows to the rest. */
function narrowSpec(spec, neg) {
  if (!spec || !neg || !neg.size) return spec;
  if (!spec.parts) return negatesSpec(neg, spec) ? null : spec;
  const rest = spec.parts.filter((p) => !negatesSpec(neg, p));
  if (!rest.length) return null;
  if (rest.length === spec.parts.length) return spec;
  if (rest.length === 1) return rest[0];
  return { key: rest.map((x) => x.key).join('+'), label: rest.map((x) => x.label).join(' + '), tags: [...new Set(rest.flatMap((x) => x.tags))], parts: rest };
}

module.exports.negatedTerms = negatedTerms;
module.exports.scrubTags = scrubTags;
module.exports.scrubText = scrubText;
module.exports.negatesSpec = negatesSpec;
module.exports.narrowSpec = narrowSpec;
module.exports.normName = normName;
module.exports.mainNames = mainNames;
module.exports.scanNegation = scan;
