// The logic behind the station shelf, kept free of network calls so it can be
// tested offline: reading the Icecast directory, telling when two stream
// addresses are the same station, and deciding which genres a station
// qualifies for from what it has actually been heard playing.
const crypto = require('crypto');
const { STYLES, TAG_ALIASES } = require('./config');
const { translateTags } = require('./translate');
const { resolveGenre, matchesGenre, isFocused } = require('./vet');
const { ALL_KEYS, isBroad, ERAS } = require('./songcheck');
const { plainNames, negatedTerms, negatesSpec } = require('./tagmatch');

const MAX_SAMPLES = 10; // songs remembered per station

/* ---------- Stream addresses ---------- */

/**
 * One form for "the same stream": no scheme (http and https of one address
 * are one station), lower-case host, default ports dropped, no query, no
 * trailing slash. Returns '' for anything that isn't an http(s) address.
 */
function normalizeUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch (_) { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  const port = u.port && !['80', '443'].includes(u.port) ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.hostname.toLowerCase()}${port}${path}`;
}

/**
 * A stable station id for stations that exist only in the Icecast directory:
 * UUID-shaped (version 5 style) so every place that checks station ids accepts it.
 */
function icecastId(url) {
  const h = crypto.createHash('sha1').update(normalizeUrl(url)).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** True for an id made by icecastId() (version nibble 5; directory ids are random v4). */
const isIcecastId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));

/* ---------- Icecast directory (dir.xiph.org/yp.xml) ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; } catch (_) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

function field(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!m) return '';
  const inner = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(inner).replace(/\s+/g, ' ').trim();
}

/**
 * Entries of yp.xml: [{ name, url, type, bitrate, genre, song }]. Missing
 * fields come back as '' (bitrate: null). Entries without a listen_url are dropped.
 */
function parseYp(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
    const b = m[1];
    const url = field(b, 'listen_url');
    if (!url) continue;
    out.push({
      name: field(b, 'server_name'),
      url,
      type: field(b, 'server_type').toLowerCase(),
      bitrate: parseInt(field(b, 'bitrate'), 10) || null,
      genre: field(b, 'genre'),
      song: field(b, 'current_song'),
    });
  }
  return out;
}

/* ---------- Icecast directory, any format ---------- */

// Field names the directory's JSON variants use, first match wins.
const URL_KEYS = ['listen_url', 'listenurl', 'url', 'stream', 'stream_url'];
const NAME_KEYS = ['server_name', 'stream_name', 'name'];
const GENRE_KEYS = ['genre', 'genres', 'tags'];
const TYPE_KEYS = ['server_type', 'content_type', 'type'];
const BITRATE_KEYS = ['bitrate', 'br'];
const SONG_KEYS = ['current_song', 'song'];

function firstText(o, keys) {
  for (const k of keys) {
    let v = o[k];
    if (Array.isArray(v)) v = v.filter((x) => typeof x === 'string' || typeof x === 'number').join(', ');
    if (typeof v === 'number') v = String(v);
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim();
  }
  return '';
}

// "mp3" / "aac+" style names become the MIME types parseYp entries carry.
function mimeOf(t) {
  const x = String(t || '').toLowerCase().trim();
  if (!x || x.includes('/')) return x;
  if (/^(mp3|mpeg)$/.test(x)) return 'audio/mpeg';
  if (/^(aac|aacp|aac\+|he-?aac)$/.test(x)) return 'audio/aac';
  if (/^(ogg|vorbis|opus)$/.test(x)) return 'application/ogg';
  return x;
}

// One JSON item -> an entry like parseYp's, or null when it has no stream address.
function entryFromJson(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const url = firstText(o, URL_KEYS);
  if (!/^https?:\/\//i.test(url)) return null;
  let name = firstText(o, NAME_KEYS);
  let song = firstText(o, SONG_KEYS);
  const title = firstText(o, ['title']);
  if (!name) name = title; else if (!song) song = title; // "title" is the station's name if nothing else is, else the song
  return {
    name,
    url,
    type: mimeOf(firstText(o, TYPE_KEYS)),
    bitrate: parseInt(firstText(o, BITRATE_KEYS), 10) || null,
    genre: firstText(o, GENRE_KEYS),
    song,
  };
}

/** The station list inside parsed JSON: the array itself, or the longest array of objects under any key (one level down too). */
function listFromJson(v, depth = 0) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object' || depth > 1) return [];
  let best = [];
  for (const x of Object.values(v)) {
    const l = Array.isArray(x) ? x : (x && typeof x === 'object' && depth < 1 ? listFromJson(x, depth + 1) : []);
    if (l.length > best.length) best = l;
  }
  return best;
}

/**
 * Entries from whatever the Icecast directory sent: yp.xml (<entry> blocks),
 * JSON (an array, or an object holding one), or an already parsed value.
 * HTML pages are never parsed. Same entry shape as parseYp.
 */
function parseDirectory(input) {
  if (input == null) return [];
  let data = input;
  if (typeof input === 'string') {
    const t = input.trim();
    if (!t) return [];
    if (t[0] === '[' || t[0] === '{') { try { data = JSON.parse(t); } catch (_) { return []; } }
    else if (/^(<!doctype\s+html|<html)\b/i.test(t)) return [];
    else return parseYp(t);
  }
  return listFromJson(data).map(entryFromJson).filter(Boolean);
}

/** Genre text like "Rock, Classic Rock / 80s" -> tags: each phrase, then each word. */
function ypTags(genre) {
  const lower = String(genre || '').toLowerCase();
  const phrases = lower.split(/[,;/|]+/).map((t) => t.trim()).filter(Boolean);
  const words = lower.split(/[\s,;/|]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  return [...new Set([...phrases, ...words])];
}

/* ---------- Genre qualification ---------- */

// Every genre key -> its spec (same keys the server uses in lib/vet.js).
const SPECS = new Map();
for (const key of ALL_KEYS) {
  const spec = key.startsWith('tag:') ? resolveGenre(null, key.slice(4)) : resolveGenre(key);
  if (spec && spec.key === key) SPECS.set(key, spec);
}

// Niche style names (shoegaze, doom metal...) count as music words when the
// scout checks a station, as they do when a listener picks that style.
// (Compound aliases like 'roots+reggae' only mean something next to the genre check, so they aren't music words on their own.)
const STYLE_TAGS = [...new Set([...Object.values(STYLES).flat(), ...plainNames(Object.values(TAG_ALIASES).flat())])];

/**
 * Which genre keys a station qualifies for, judged on what it plays, not on
 * one song. samples: [{ title, at, known, fits: [keys], named: [keys], cc? }].
 * `fits` are the genres a song is acceptable for; `named` are the styles it
 * positively names (a specific Apple label or MusicBrainz genre, not just the
 * family's generic "Electronic").
 * A key qualifies when
 *   (a) at least 3 identified songs and 60%+ of them fit it (a main genre or an
 *       era style) or positively name it (any other style), or
 *   (b) the station's tags name it (and pass the genre-focus check) and it
 *       has fewer than 2 identified songs or 50%+ of them fit.
 * So a station with no tags, or the wrong ones, can still reach a style when its
 * songs say so. World and its styles can't be judged from songs, so tags alone decide.
 */
function qualifyGenres({ rawTags, name, samples = [] }) {
  const raw = (rawTags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const tags = translateTags(raw);
  const known = samples.filter((s) => s && s.known);
  const keys = [];
  // What the station says it is NOT ("all genre on earth except trap"): out for those genres, even if its songs fit.
  const neg = negatedTerms([name, ...raw]);
  for (const [key, spec] of SPECS) {
    if (neg.size && negatesSpec(neg, spec)) continue;
    const tagged = raw.length > 0 && matchesGenre(tags, spec) && isFocused(raw, name, spec);
    if (isBroad(key)) { if (tagged) keys.push(key); continue; }
    const count = (field) => known.filter((s) => Array.isArray(s[field]) && s[field].includes(key)).length;
    const share = known.length ? count('fits') / known.length : 0;
    // Era styles are told apart by release year, so "fits" is enough. Other styles need
    // songs that name them (Apple's label or MusicBrainz), or the station's own tags.
    const style = key.startsWith('tag:') ? key.slice(4) : null;
    const eraOrMain = !style || Object.prototype.hasOwnProperty.call(ERAS, style);
    const bySongs = known.length >= 3 && (eraOrMain ? share >= 0.6 : count('named') / known.length >= 0.6);
    if (bySongs || (tagged && (known.length < 2 || share >= 0.5))) keys.push(key);
  }
  return keys;
}

/**
 * The genre keys a station is on the shelf for, minus any its name or tags negate ("everything but metal").
 * Used by the scout's sweep over rows judged before this rule existed.
 * -> { genres: kept keys, dropped: removed keys }
 */
function dropNegatedGenres({ tags, name, genres }) {
  const list = Array.isArray(genres) ? genres : [];
  const raw = (Array.isArray(tags) ? tags : String(tags || '').split(',')).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const neg = negatedTerms([name, ...raw]);
  if (!neg.size) return { genres: list, dropped: [] };
  const dropped = list.filter((k) => SPECS.has(k) && negatesSpec(neg, SPECS.get(k)));
  return { genres: list.filter((k) => !dropped.includes(k)), dropped };
}

/** The genre keys a station's name and tags negate, among all the app's keys (for the scout's log). */
function negatedKeys({ tags, name }) {
  const raw = (Array.isArray(tags) ? tags : String(tags || '').split(',')).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const neg = negatedTerms([name, ...raw]);
  return { terms: [...neg], keys: neg.size ? [...SPECS.keys()].filter((k) => negatesSpec(neg, SPECS.get(k))) : [] };
}

/** Share of identified artists from the station's own country (null when none identified). */
function localRatio(samples, countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  if (!cc) return null;
  const seen = (samples || []).filter((s) => s && typeof s.cc === 'string' && s.cc);
  if (!seen.length) return null;
  return seen.filter((s) => s.cc.toUpperCase() === cc).length / seen.length;
}

/** Adds a song sample, keeping the last MAX_SAMPLES; a song already there only has its time refreshed. */
function addSample(samples, sample) {
  const list = Array.isArray(samples) ? samples.slice() : [];
  const same = list.findIndex((s) => s && s.title === sample.title);
  if (same >= 0) { list[same] = { ...list[same], at: sample.at }; return list; }
  list.push(sample);
  return list.slice(-MAX_SAMPLES);
}

module.exports = { MAX_SAMPLES, normalizeUrl, icecastId, isIcecastId, decodeEntities, parseYp, parseDirectory, ypTags, SPECS, STYLE_TAGS, qualifyGenres, dropNegatedGenres, negatedKeys, localRatio, addSample };
