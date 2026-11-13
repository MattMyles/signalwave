// Listener "WRONG GENRE?" reports (genre_reports in Supabase, written by
// api/feedback.js). Once the admin agrees with a report in the dashboard
// (status 'approved'), that station isn't served for that genre any more; it
// can still come up in other genres. Pending and dismissed reports don't count. Reports from the last
// REPORT_DAYS count. Loaded at most every few minutes and best-effort: if
// Supabase is slow or the table doesn't exist yet, picking carries on as before.
const { serviceEnv, sbHeaders } = require('./supabase-env');

const REPORT_DAYS = 180;
const REFRESH_MS = 5 * 60 * 1000;
let cache = { at: 0, map: new Map() }; // genre key -> Set of station uuids

async function load() {
  if (Date.now() - cache.at < REFRESH_MS) return cache.map;
  const env = serviceEnv();
  if (!env) { cache = { at: Date.now(), map: new Map() }; return cache.map; }
  try {
    const since = new Date(Date.now() - REPORT_DAYS * 86400000).toISOString();
    const u = `${env.url}/rest/v1/genre_reports?select=station_uuid,genre_key&status=eq.approved&created_at=gte.${encodeURIComponent(since)}&limit=10000`;
    const r = await fetch(u, { headers: sbHeaders(env.key), signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(String(r.status));
    const map = new Map();
    for (const row of await r.json()) {
      if (!map.has(row.genre_key)) map.set(row.genre_key, new Set());
      map.get(row.genre_key).add(String(row.station_uuid).toLowerCase());
    }
    cache = { at: Date.now(), map };
  } catch (_) {
    cache = { at: Date.now() - REFRESH_MS + 60000, map: cache.map }; // keep what we had, retry in a minute
  }
  return cache.map;
}

/**
 * Stations reported as the wrong genre for this pick. With several genres
 * picked, a station is left out only if it was reported for all of them.
 */
async function reportedFor(spec) {
  if (!spec) return new Set();
  const map = await load();
  const sets = (spec.parts || [spec]).map((p) => map.get(p.key) || new Set());
  return new Set([...sets[0]].filter((uuid) => sets.every((s) => s.has(uuid))));
}

/** A new report was just saved: reload on the next search. */
function forget() { cache.at = 0; }

module.exports = { reportedFor, forget };
