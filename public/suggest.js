/* Genre suggestions for the WRONG GENRE? sheet: type "dnb", get Drum & Bass. A pure matcher
   (no page access) so scripts/test.js can test it. In the browser it is window.GenreSuggest. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GenreSuggest = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lower case, no accents, "&" as "and", letters and numbers only, one space between words.
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFKC').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // Where a name came from: its ranking among equal matches (the genre's own name first).
  const LABEL = 0, ID = 1, ALIAS = 2, TRANSLATION = 3;

  /**
   * One entry per main genre and style. catalog: [{ id, label, subs: [style ids] }];
   * labelOf(key) -> the label the app shows for 'tag:<style>'; names: window.GENRE_NAMES
   * ({ key: { a: [aliases], t: [translations] } }).
   */
  function buildEntries(catalog, labelOf, names = {}) {
    const entries = [];
    const make = (key, label, parent, idText) => {
      const n = names[key] || {};
      const list = [{ text: norm(label), kind: LABEL }];
      if (idText) list.push({ text: norm(idText), kind: ID });
      for (const a of n.a || []) list.push({ text: norm(a), kind: ALIAS, raw: a });
      for (const t of n.t || []) list.push({ text: norm(t), kind: TRANSLATION, raw: t });
      entries.push({ id: key, label, parent, names: list.filter((x) => x.text), order: entries.length });
    };
    for (const main of catalog) {
      make(main.id, main.label, null, main.id);
      for (const st of main.subs) make(`tag:${st}`, labelOf(`tag:${st}`), main.label, st);
    }
    return entries;
  }

  // How well one name matches the query: 0 same, 1 starts with it, 2 a word in it starts with it
  // (every word of the query starts some word), 3 has it somewhere inside. null = no match.
  function tierOf(name, q, tokens, kind) {
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    const words = name.split(' ');
    if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 2;
    if (kind !== TRANSLATION && q.length >= 2 && name.includes(q)) return 3;
    return null;
  }

  /** Up to `max` entries for what was typed: prefix matches first, then substring; [{ id, label, parent, via }]. */
  function suggest(query, entries, max = 8) {
    const q = norm(query);
    if (!q) return [];
    const tokens = q.split(' ');
    const hits = [];
    for (const e of entries) {
      let best = null;
      let ownName = false; // the genre's own label (or id) matches too: no need to say which other name did
      for (const n of e.names) {
        const tier = tierOf(n.text, q, tokens, n.kind);
        if (tier === null) continue;
        if (n.kind <= ID) ownName = true;
        // A translation ranks a step below the same match in English.
        const rank = [tier + (n.kind === TRANSLATION ? 1 : 0), n.kind, n.text.length];
        if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && (rank[1] < best.rank[1] || (rank[1] === best.rank[1] && rank[2] < best.rank[2])))) best = { rank, name: n };
      }
      if (best) hits.push({ e, best, ownName });
    }
    hits.sort((a, b) => (a.best.rank[0] - b.best.rank[0]) || (a.best.rank[1] - b.best.rank[1]) || (a.best.rank[2] - b.best.rank[2]) || (a.e.order - b.e.order));
    return hits.slice(0, max).map(({ e, best, ownName }) => ({
      id: e.id, label: e.label, parent: e.parent,
      via: !ownName && best.name.kind >= ALIAS ? best.name.raw : null, // "dnb" when that is the only thing that matched
    }));
  }

  return { norm, buildEntries, suggest };
});
