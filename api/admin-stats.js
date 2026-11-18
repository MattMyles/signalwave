// GET /api/admin-stats — numbers for the private dashboard (/admin).
// POST /api/admin-stats { action: 'review', ids: [1, 2], status: 'approved' | 'rejected' | 'pending' }
// — the admin's verdict on WRONG GENRE? reports (approved = agree, the station
// stops being served for that genre; rejected = dismiss).
// POST /api/admin-stats { action: 'history', uuid, genres: ['rock', ...] } — the last
// songs a reported station played (up to 10, newest first) from four sources, each
// labelled: SERVER (the station's own "recently played" page), LISTENERS (what
// listeners' checks saw, station_songs), SCOUT (the shelf's samples), REPORT (songs
// attached to WRONG GENRE? reports), with Apple's genre for each song and whether it
// fits the genres. Songs come from the song_lookups cache; at most 10 new iTunes lookups.
// Requires a signed-in user whose email is listed in the ADMIN_EMAILS
// environment variable. Everyone else gets 403 and no data.
const { serviceEnv, adminEmails, sbHeaders, verifyUser } = require('../lib/supabase-env');
const { query, sendJson, readJson, bearer } = require('../lib/http');
const { forget } = require('../lib/reports');
const { directoryStats } = require('../lib/radio');
const { GENRES, STYLES } = require('../lib/config');
const { makeDb } = require('../lib/sbrest');
const { makeSongCache } = require('../lib/songcache');
const songs = require('../lib/songcheck');
const { serverHistory, mergeHistory } = require('../lib/stationhistory');
const { storedSongs } = require('../lib/songlog');
const { poolLookup } = require('../lib/pool');
const { stationByUuid } = require('../lib/radio');
const { knownStreamUrl } = require('../lib/vet');

const NEW_LOOKUPS = 10; // iTunes lookups one history may add (the rest come from song_lookups)

// The song history of one station, labelled by where each song came from.
async function stationHistory(env, uuid, genreKeys) {
  const db = makeDb(env, { timeoutMs: 6000 });
  const row = await poolLookup(uuid, { env }).catch(() => null);
  let url = (row && row.url) || knownStreamUrl(uuid);
  if (!url) { try { const st = await stationByUuid(uuid); if (st && st.url_resolved) url = st.url_resolved; } catch (_) { /* unknown stream */ } }
  const [server, listeners, reports] = await Promise.all([
    url ? serverHistory(url).catch(() => []) : [],
    storedSongs(uuid, 30, { env }),
    db.get(`/genre_reports?select=song,created_at&station_uuid=eq.${encodeURIComponent(uuid)}&song=not.is.null&order=created_at.desc&limit=30`).catch(() => []),
  ]);
  const scout = (row && Array.isArray(row.samples) ? row.samples : []).map((x) => ({ title: x && x.title, at: x && Date.parse(x.at) || null })).sort((a, b) => (b.at || 0) - (a.at || 0));
  const merged = mergeHistory([
    { source: 'SERVER', items: server },
    { source: 'LISTENERS', items: listeners },
    { source: 'SCOUT', items: scout },
    { source: 'REPORT', items: (reports || []).map((x) => ({ title: x.song, at: Date.parse(x.created_at) || null })) },
  ], 10);

  // Apple's genre for each song (cache first, a few new lookups), and whether it fits the genres.
  const cache = makeSongCache(makeDb(env, { timeoutMs: 3000 }), Date.now, { timeoutMs: 3000 });
  const parts = genreKeys.map((key) => ({ key }));
  const keys = merged.map((m) => { const sp = songs.splitSong(m.title); return sp ? songs.songKey(sp.artist, sp.song) : null; }).filter(Boolean);
  await cache.prefetch(keys);
  let left = NEW_LOOKUPS;
  const gate = async () => left-- > 0;
  const out = await Promise.all(merged.map(async (m) => {
    let info = null;
    try { info = (await songs.songInfo(m.title, { cache, gate, country: row && row.country_code })).info; } catch (_) { /* unknown */ }
    return { ...m, genres: info ? info.genres : [], year: info ? info.year : null, fit: parts.length ? songs.fitOf(parts, info) : null };
  }));
  await cache.flush();
  return { uuid, name: row ? row.name : null, songs: out, server: Boolean(server.length) };
}

// The wrong-genre reports, with what listeners said the genre really was (the `suggested` column,
// from migration 20261118100000_genre_judging.sql); without that column, the same list without it.
async function reportsFetch(env) {
  const cols = 'id,station_uuid,station_name,genre_key,station_genre,song,city,country_code,status,created_at';
  const get = (select) => fetch(`${env.url}/rest/v1/genre_reports?select=${select}&order=created_at.desc&limit=150`, { headers: sbHeaders(env.key), signal: AbortSignal.timeout(10000) });
  try {
    const r = await get(`${cols},suggested`);
    if (r.ok) return r;
    return await get(cols);
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  const user = await verifyUser(bearer(req));
  if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
  const admins = adminEmails();
  if (!admins.length) return sendJson(res, 503, { error: 'No admin set. Add ADMIN_EMAILS in Vercel, then redeploy.' });
  if (!admins.includes(user.email)) return sendJson(res, 403, { error: 'This account is not allowed to view the dashboard.' });

  const env = serviceEnv();
  if (!env) return sendJson(res, 503, { error: 'Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.' });

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (body && body.action === 'history') {
      const uuid = String(body.uuid || '').toLowerCase();
      if (!/^[0-9a-f-]{36}$/.test(uuid)) return sendJson(res, 400, { error: 'Bad station id.' });
      const genreKeys = (Array.isArray(body.genres) ? body.genres : []).map(String).filter((g) => /^(tag:)?[a-z0-9 &'\-]{2,40}$/.test(g)).slice(0, 5);
      try { return sendJson(res, 200, await stationHistory(env, uuid, genreKeys)); } catch (_) { return sendJson(res, 502, { error: 'Could not load the history.' }); }
    }
    const ids = Array.isArray(body && body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : [];
    const status = body && body.status;
    if (!body || body.action !== 'review' || !ids.length || !['approved', 'rejected', 'pending'].includes(status)) {
      return sendJson(res, 400, { error: 'Bad review.' });
    }
    try {
      const r = await fetch(`${env.url}/rest/v1/genre_reports?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status, reviewed_at: status === 'pending' ? null : new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return sendJson(res, 502, { error: `Supabase answered ${r.status}.` });
      forget();
      return sendJson(res, 200, { ok: true });
    } catch (_) {
      return sendJson(res, 502, { error: 'Supabase did not answer. Try again.' });
    }
  }

  const tz = (query(req).get('tz') || 'America/New_York').replace(/[^A-Za-z0-9_+\-/]/g, '').slice(0, 64);
  const rpc = (fn, body) => fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  try {
    const [r, rc, directory, rr, rs, rsr] = await Promise.all([
      rpc('admin_stats', { tz }),
      rpc('admin_check_stats', {}).catch(() => null),
      directoryStats(),
      reportsFetch(env),
      // The station shelf (lib/pool.js): servable counts per genre, and the scout's latest run.
      rpc('pool_stats', {}).catch(() => null),
      fetch(`${env.url}/rest/v1/scout_runs?select=id,started_at,finished_at,discovered,checked,added,now_dead,active_total,notes&order=started_at.desc&limit=1`, {
        headers: sbHeaders(env.key), signal: AbortSignal.timeout(10000),
      }).catch(() => null),
    ]);
    if (!r.ok) {
      const detail = r.status === 404 ? 'The admin_stats function is missing. Run the plays migration in Supabase.' : `Supabase answered ${r.status}.`;
      return sendJson(res, 502, { error: detail });
    }
    // Station checks are optional: missing until their migration has been run.
    const checks = rc && rc.ok ? await rc.json() : null;
    // Wrong-genre reports: missing until their migration has been run.
    const reports = rr && rr.ok ? await rr.json() : null;
    // The shelf: missing (null) until its migration has been run.
    let shelf = null;
    if (rs && rs.ok) {
      const rows = await rs.json();
      const counts = Object.fromEntries(rows.map((x) => [x.key, x.n]));
      const runs = rsr && rsr.ok ? await rsr.json() : [];
      shelf = {
        total: counts['*'] || 0,
        sources: { radiobrowser: counts['src:radiobrowser'] || 0, icecast: counts['src:icecast'] || 0 },
        dead: counts.dead || 0,
        stale: counts.stale || 0,
        counts: Object.fromEntries(Object.entries(counts).filter(([k]) => !['*', 'dead', 'stale'].includes(k) && !k.startsWith('src:'))),
        catalog: Object.fromEntries(Object.entries(GENRES).map(([id, g]) => [id, { label: g.label, styles: STYLES[id] || [] }])),
        run: runs[0] || null,
      };
    }
    sendJson(res, 200, { email: user.email, stats: await r.json(), checks, directory, reports, shelf });
  } catch (_) {
    sendJson(res, 502, { error: 'Supabase did not answer. Try again.' });
  }
};
