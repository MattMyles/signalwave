// The song cache in Supabase (song_lookups), in front of iTunes. Shared by the
// scout (scripts/scout.js) and the live paths (lib/pool.js, api/nowplaying.js).
// Passed to songcheck's lookup() as opts.cache:
//   prefetch(keys)  one query for many songs, before they're needed
//   get(key)        info | null (known not to be in the catalog) | undefined (never asked)
//   set(key, info)  remembers a definite answer; flush() writes new ones to Supabase
// Everything here is best-effort: a failing database just means no cache.
const DAY = 86400000;

function makeSongCache(db, now = Date.now, { timeoutMs } = {}) {
  const mem = new Map(); // key -> info | null
  const fresh = [];
  const opts = timeoutMs ? { timeout: timeoutMs } : undefined;
  return {
    async prefetch(keys) {
      const want = [...new Set(keys)].filter((k) => k && !mem.has(k) && !/["\\,()]/.test(k));
      for (let i = 0; i < want.length; i += 60) {
        const part = want.slice(i, i + 60);
        let rows = [];
        try { rows = await db.get(`/song_lookups?select=key,genre,year,found,looked_at&key=in.(${part.map((k) => `"${encodeURIComponent(k)}"`).join(',')})`, opts); } catch (_) { /* cache only */ }
        for (const r of rows || []) {
          if (r.found) mem.set(r.key, { genres: String(r.genre || '').split('|').filter(Boolean), year: r.year || null });
          else if (now() - Date.parse(r.looked_at) < 30 * DAY) mem.set(r.key, null); // "not found" is rechecked after 30 days
        }
      }
    },
    get: (key) => (mem.has(key) ? mem.get(key) : undefined),
    set(key, info) {
      mem.set(key, info);
      if (key.length <= 400) fresh.push({ key, genre: info ? info.genres.join('|') : null, year: info ? info.year : null, found: Boolean(info), looked_at: new Date(now()).toISOString() });
    },
    async flush() {
      if (!fresh.length) return;
      const rows = fresh.splice(0, fresh.length);
      try { await db.upsert('song_lookups', rows, opts); } catch (_) { /* cache only */ }
    },
  };
}

module.exports = { makeSongCache };
