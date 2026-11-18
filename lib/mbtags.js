// What we know about an artist from MusicBrainz, kept in memory: home country
// and the genres/tags people gave them. lib/artistcheck.js fills it (one request
// a second at most); the song check reads it, and never asks MusicBrainz itself.
const MAX = 5000;
const mem = new Map(); // artist key -> { country: 'JP' | null, tags: ['rock', ...] }

/** A name with accents and punctuation gone, lower case. */
const plainName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(feat|ft|featuring)\b.*$/, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The key an artist is filed under: the first credited artist, plain. */
const artistKey = (artist) => plainName(String(artist || '').split(/\s*(?:,|&| x | and | y | e | und )\s*/i)[0]);

const getMem = (key) => mem.get(key);
function setMem(key, info) {
  if (mem.size >= MAX && !mem.has(key)) mem.delete(mem.keys().next().value);
  mem.set(key, info);
}
const clearMem = () => mem.clear();

/** MusicBrainz tags for an artist when already known (memory first, then an opts.artists cache), else null. */
function knownTags(artist, opts) {
  const key = artistKey(artist);
  if (!key) return null;
  const m = mem.get(key) || (opts && opts.artists && opts.artists.get(key));
  return m && Array.isArray(m.tags) && m.tags.length ? m.tags : null;
}

module.exports = { artistKey, plainName, getMem, setMem, clearMem, knownTags };
