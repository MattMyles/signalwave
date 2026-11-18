// The artist cache in Supabase (artist_info): home country and MusicBrainz
// tags per artist, so the scout asks MusicBrainz about each artist once a month
// and the live paths (lib/pool.js, api/nowplaying.js) can read genres without
// ever asking MusicBrainz themselves. Same shape as lib/songcache.js:
//   prefetch(names)  one query for many artists (keys from mbtags.artistKey)
//   get(name)        { country, tags } | undefined (never asked)
//   set(name, info)  remembers an answer; flush() writes new ones
// Best-effort: a missing table or failing database just means no cache.
const DAY = 86400000;

function makeArtistCache(db, now = Date.now, { timeoutMs } = {}) {
  const mem = new Map();
  const fresh = [];
  const opts = timeoutMs ? { timeout: timeoutMs } : undefined;
  return {
    async prefetch(names) {
      const want = [...new Set(names)].filter((k) => k && !mem.has(k) && !/["\\,()]/.test(k));
      for (let i = 0; i < want.length; i += 60) {
        const part = want.slice(i, i + 60);
        let rows = [];
        try { rows = await db.get(`/artist_info?select=name,country,tags,looked_at&name=in.(${part.map((k) => `"${encodeURIComponent(k)}"`).join(',')})`, opts); } catch (_) { /* cache only */ }
        for (const r of rows || []) {
          if (now() - Date.parse(r.looked_at) < 30 * DAY) mem.set(r.name, { country: r.country || null, tags: String(r.tags || '').split('|').filter(Boolean) });
        }
      }
    },
    get: (name) => (mem.has(name) ? mem.get(name) : undefined),
    set(name, info) {
      mem.set(name, info);
      if (name.length <= 200) fresh.push({ name, country: info.country || null, tags: (info.tags || []).join('|'), looked_at: new Date(now()).toISOString() });
    },
    async flush() {
      if (!fresh.length) return;
      const rows = fresh.splice(0, fresh.length);
      try { await db.upsert('artist_info', rows, opts); } catch (_) { /* cache only */ }
    },
  };
}

module.exports = { makeArtistCache };
