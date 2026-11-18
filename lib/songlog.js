// Our own record of what stations play: station_songs (migration
// 20261118080000_genre_strikes.sql), written by /api/nowplaying whenever a
// listener's check sees a station's title change. /admin shows it as the
// LISTENERS history of a reported station. Best-effort and silent: a missing
// table, a slow database or an error never affects the caller.
const { serviceEnv } = require('./supabase-env');
const { makeDb, isMissing } = require('./sbrest');

const MISSING_MS = 10 * 60 * 1000;
const MAX_REMEMBERED = 5000;
const last = new Map(); // station uuid -> the newest title stored (per warm instance, saves a read per poll)
let missingUntil = 0;
function resetSongLog() { last.clear(); missingUntil = 0; }

const clean = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

/** Stores `title` for the station unless it is the newest one already stored. Never throws. */
async function noteSong(uuid, title, opts = {}) {
  try {
    const env = opts.env !== undefined ? opts.env : serviceEnv();
    const t = clean(title);
    const id = String(uuid || '').toLowerCase();
    if (!env || !t || !id || Date.now() < missingUntil) return false;
    if (last.get(id) === t) return false;
    const db = makeDb(env, { timeoutMs: 2500 });
    if (!last.has(id)) {
      // First time this instance sees the station: compare with what's stored.
      const rows = await db.get(`/station_songs?uuid=eq.${encodeURIComponent(id)}&select=title&order=first_seen.desc,id.desc&limit=1`);
      if (last.size >= MAX_REMEMBERED) last.clear();
      last.set(id, rows && rows[0] ? rows[0].title : null);
      if (last.get(id) === t) return false;
    }
    last.set(id, t); // before the write, so a second poll right behind this one doesn't repeat it
    await db.insert('station_songs', [{ uuid: id, title: t }]);
    return true;
  } catch (e) {
    if (isMissing(e)) missingUntil = Date.now() + MISSING_MS;
    return false;
  }
}

/** The stored songs for a station, newest first: [{ title, at }]. [] when none or unavailable. */
async function storedSongs(uuid, limit = 30, opts = {}) {
  try {
    const env = opts.env !== undefined ? opts.env : serviceEnv();
    if (!env) return [];
    const rows = await makeDb(env, { timeoutMs: 4000 }).get(`/station_songs?uuid=eq.${encodeURIComponent(String(uuid).toLowerCase())}&select=title,first_seen&order=first_seen.desc,id.desc&limit=${limit}`);
    return (rows || []).map((r) => ({ title: r.title, at: Date.parse(r.first_seen) || null }));
  } catch (_) {
    return [];
  }
}

module.exports = { noteSong, storedSongs, resetSongLog };
