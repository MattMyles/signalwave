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
