// The logic behind the station shelf, kept free of network calls so it can be
// tested offline: reading the Icecast directory, telling when two stream
// addresses are the same station, and deciding which genres a station
// qualifies for from what it has actually been heard playing.
const crypto = require('crypto');
const { STYLES, TAG_ALIASES } = require('./config');
const { translateTags } = require('./translate');
const { resolveGenre, matchesGenre, isFocused } = require('./vet');
const { ALL_KEYS, isBroad, ERAS } = require('./songcheck');

const MAX_SAMPLES = 8; // songs remembered per station

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
const STYLE_TAGS = [...new Set([...Object.values(STYLES).flat(), ...Object.values(TAG_ALIASES).flat()])];

/**
 * Which genre keys a station qualifies for, judged on what it plays, not on
 * one song. samples: [{ title, at, known, fits: [keys], cc? }].
 * A key qualifies when
 *   (a) at least 3 identified songs and 60%+ of them fit it, or
 *   (b) the station's tags name it (and pass the genre-focus check) and it
 *       has fewer than 2 identified songs or 50%+ of them fit.
 * World and its styles can't be judged from songs, so tags alone decide.
 */
function qualifyGenres({ rawTags, name, samples = [] }) {
  const raw = (rawTags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const tags = translateTags(raw);
  const known = samples.filter((s) => s && s.known);
  const keys = [];
  for (const [key, spec] of SPECS) {
    const tagged = matchesGenre(tags, spec) && isFocused(raw, name, spec);
    if (isBroad(key)) { if (tagged) keys.push(key); continue; }
    const fit = known.filter((s) => Array.isArray(s.fits) && s.fits.includes(key)).length;
    const share = known.length ? fit / known.length : 0;
    // Songs alone can only vouch for a main genre or an era style (release years
    // tell those apart). Apple's genres don't separate death metal from power
    // metal, so other styles also need the station's own tags (exact genre first).
    const style = key.startsWith('tag:') ? key.slice(4) : null;
    const songsCanTell = !style || Object.prototype.hasOwnProperty.call(ERAS, style);
    if ((songsCanTell && known.length >= 3 && share >= 0.6) || (tagged && (known.length < 2 || share >= 0.5))) keys.push(key);
  }
  return keys;
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

module.exports = { MAX_SAMPLES, normalizeUrl, icecastId, isIcecastId, decodeEntities, parseYp, ypTags, SPECS, STYLE_TAGS, qualifyGenres, localRatio, addSample };
