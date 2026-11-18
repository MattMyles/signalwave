// Certified stations: stations the admin has stamped as truly a genre or style (the CERTIFY
// control in the player, admins only). They are served first for that genre: a listener who has
// not heard a certified station for the genre they picked gets it before anything else, so new
// listeners start on the best signals. No song check for a certified key (the admin's judgment
// wins over Apple's labels), but the stream must be alive and wrong-genre reports the admin
// agreed with still apply.
//
// Storage: Supabase table certified_stations (uuid, genre_key, station snapshot, certified_by,
// certified_at), written by api/certify.js with the server key. The snapshot is the public
// station object, so a certified station can be served even if it is not on the station shelf
// or in Radio Browser. Everything degrades quietly when the table doesn't exist yet.
const { serviceEnv } = require('./supabase-env');
const { makeDb, isMissing } = require('./sbrest');
const { ALL_KEYS } = require('./songcheck');
const { GENRES } = require('./config');
const { probeStream } = require('./icy');
const { reportedFor } = require('./reports');
const { regionOf, rememberStream } = require('./vet');

const KNOWN_KEYS = new Set(ALL_KEYS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_KEYS = 12;       // genres one station can be certified for
const CACHE_MS = 60 * 1000;
const MISSING_MS = 10 * 60 * 1000;
const PROBE = { firstByteMs: 2500, totalMs: 3500, skipMeta: true };
const BATCH = 3;           // streams checked at the same time
const MAX_TRIES = 6;       // certified candidates checked per request

/** The genre keys in a list that the app knows, no repeats: { keys, bad } (bad = what was refused). */
function validKeys(list) {
  const keys = []; const bad = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const k = String(raw);
    if (KNOWN_KEYS.has(k)) { if (!keys.includes(k)) keys.push(k); } else bad.push(k);
  }
  return { keys, bad };
}

const text = (v, max) => {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * The public station object, cleaned: only the fields the app reads, a secure stream, a real position.
 * Returns null when it can't be served (no id, no https stream, no position).
 */
function sanitizeStation(st) {
  if (!st || typeof st !== 'object' || !UUID.test(String(st.uuid || ''))) return null;
  const url = String(st.url || '');
  if (!/^https:\/\//i.test(url) || url.length > 2000) return null;
  const lat = num(st.lat); const lng = num(st.lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const cc = String(st.countryCode || '').toUpperCase();
  const fav = String(st.favicon || '');
  return {
    uuid: String(st.uuid).toLowerCase(),
    name: text(st.name, 200) || 'Unnamed station',
    url,
    homepage: /^https?:\/\//i.test(String(st.homepage || '')) ? String(st.homepage).slice(0, 500) : null,
    favicon: /^https:\/\//.test(fav) && fav.length <= 500 ? fav : null,
    tags: (Array.isArray(st.tags) ? st.tags : []).map((t) => text(t, 60)).filter(Boolean).slice(0, 20),
    genre: text(st.genre, 80),
    city: text(st.city, 100),
    region: text(st.region, 100),
    country: text(st.country, 100) || 'Unknown',
    countryCode: /^[A-Z]{2}$/.test(cc) ? cc : null,
    lat, lng,
    bitrate: num(st.bitrate),
    codec: text(st.codec, 20),
    cors: Boolean(st.cors),
  };
}

/** The words shown for a key as the station's GENRE ('rock' -> 'rock', 'tag:deep house' -> 'deep house'). */
const keyWord = (key) => (key.startsWith('tag:') ? key.slice(4) : GENRES[key] ? GENRES[key].label.toLowerCase() : key);

/**
 * The order to try certified stations in. entries: [{ uuid, keys: [...] }]. A station counts when it is
 * certified for a picked key, hasn't been heard (exclude), and isn't agreed-wrong for every picked key it
 * is certified for (reported(key) -> Set of lower-case ids). Stations from regions not just heard come
 * first; each group is in random order. -> [{ entry, key }] (key = the picked key it counts for)
 */
function orderCertified(entries, { keys, exclude = new Set(), recent = [], reported = () => new Set(), region = regionOf, rng = Math.random } = {}) {
  const picked = new Set(keys);
  const heard = new Set([...exclude].map((u) => String(u).toLowerCase()));
  const avoid = new Set((recent || []).map(region).filter(Boolean));
  const usable = [];
  for (const entry of entries) {
    if (heard.has(String(entry.uuid).toLowerCase())) continue;
    const hit = entry.keys.filter((k) => picked.has(k) && !reported(k).has(String(entry.uuid).toLowerCase()));
    if (hit.length) usable.push({ entry, key: hit[Math.floor(rng() * hit.length)] });
  }
  const shuffle = (a) => { const out = a.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  const fresh = usable.filter((u) => !avoid.has(region(u.entry.station && u.entry.station.countryCode)));
  const same = usable.filter((u) => avoid.has(region(u.entry.station && u.entry.station.countryCode)));
  return [...shuffle(fresh), ...shuffle(same)];
}

/* ---------- The list, kept in memory for a minute per warm instance ---------- */

let cache = { at: 0, map: new Map() }; // uuid -> { uuid, keys: [], station, by, at }
let missingUntil = 0;
let inflight = null;

function resetCertified() { cache = { at: 0, map: new Map() }; missingUntil = 0; inflight = null; }
/** Something changed: read the table again on the next question. */
function forget() { cache.at = 0; }

async function load({ env, db, timeoutMs = 2500, force = false } = {}) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.map;
  if (Date.now() < missingUntil) return cache.map;
  const handle = db || (() => { const e = env !== undefined ? env : serviceEnv(); return e ? makeDb(e, { timeoutMs }) : null; })();
  if (!handle) { cache = { at: Date.now(), map: new Map() }; return cache.map; }
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const rows = await handle.getAll('/certified_stations?select=uuid,genre_key,station,certified_by,certified_at&order=certified_at.desc,uuid.asc,genre_key.asc', { max: 5000 });
      const map = new Map();
      for (const r of rows) {
        const id = String(r.uuid).toLowerCase();
        if (!map.has(id)) map.set(id, { uuid: id, keys: [], station: null, by: r.certified_by || null, at: r.certified_at || null });
        const e = map.get(id);
        if (KNOWN_KEYS.has(r.genre_key) && !e.keys.includes(r.genre_key)) e.keys.push(r.genre_key);
        if (!e.station) e.station = sanitizeStation(r.station);
      }
      cache = { at: Date.now(), map };
    } catch (e) {
      if (isMissing(e)) missingUntil = Date.now() + MISSING_MS;
      cache = { at: Date.now() - CACHE_MS + 15000, map: cache.map }; // keep what we had, try again soon
    } finally { inflight = null; }
    return cache.map;
  })();
  return inflight;
}

/** The genre keys a station is certified for ([] when none or when the table isn't there). Never throws. */
async function keysFor(uuid, opts = {}) {
  try { const e = (await load({ timeoutMs: 1500, ...opts })).get(String(uuid || '').toLowerCase()); return e ? e.keys.slice() : []; } catch (_) { return []; }
}

/** The stored station object for a certified station (so it can be played when no directory knows it), or null. */
async function snapshotFor(uuid, opts = {}) {
  try { const e = (await load({ timeoutMs: 1500, ...opts })).get(String(uuid || '').toLowerCase()); return e ? e.station : null; } catch (_) { return null; }
}

/** Every certified station with its keys, fresh from the table (for /admin). */
async function listAll(opts = {}) {
  const map = await load({ force: true, timeoutMs: 6000, ...opts });
  return [...map.values()].map((e) => ({
    uuid: e.uuid, keys: e.keys, by: e.by, at: e.at,
    name: e.station ? e.station.name : null, city: e.station ? e.station.city : null, country: e.station ? e.station.country : null, countryCode: e.station ? e.station.countryCode : null,
  }));
}

/**
 * Sets a station's certified keys to exactly this list (empty = remove all). station: the public station
 * object (kept so it can be served); optional when the station is already certified for something.
 * -> { keys } or throws an Error with .status 400 / 503.
 */
async function setKeys({ uuid, keys, station, by }, opts = {}) {
  const env = opts.env !== undefined ? opts.env : serviceEnv();
  if (!env && !opts.db) { const e = new Error('Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.'); e.status = 503; throw e; }
  const db = opts.db || makeDb(env, { timeoutMs: 8000 });
  const id = String(uuid).toLowerCase();
  const enc = encodeURIComponent;
  let existing;
  try { existing = await db.get(`/certified_stations?select=genre_key,station&uuid=eq.${enc(id)}&limit=100`); } catch (e) {
    if (isMissing(e)) { const err = new Error('Run supabase/migrations/20261118120000_certified_stations.sql in Supabase first.'); err.status = 503; throw err; }
    throw e;
  }
  const snap = sanitizeStation(station) || (existing[0] && sanitizeStation(existing[0].station));
  if (keys.length && !snap) { const e = new Error('That station has no secure stream or position, so it can\'t be certified.'); e.status = 400; throw e; }
  const now = new Date().toISOString();
  if (keys.length) await db.upsert('certified_stations', keys.map((k) => ({ uuid: id, genre_key: k, station: { ...snap, uuid: id }, certified_by: String(by || 'admin').slice(0, 200), certified_at: now })));
  for (const r of existing) if (!keys.includes(r.genre_key)) await db.del(`/certified_stations?uuid=eq.${enc(id)}&genre_key=eq.${enc(r.genre_key)}`);
  forget();
  return { keys };
}

/**
 * The next certified station for this pick, or null: certified for a picked key, not heard yet (exclude), not
 * blocked by an approved wrong-genre report, stream alive. Dead ones are skipped, never deleted.
 * opts: { env, probe, rng, reported(key) } for tests.
 */
async function certifiedNext(spec, exclude = new Set(), recent = [], opts = {}) {
  if (!spec) return null; // Any: nothing is certified for "anything"
  const env = opts.env !== undefined ? opts.env : serviceEnv();
  if (!env && !opts.db) return null;
  const map = await load({ env, db: opts.db });
  if (!map.size) return null;
  const keys = (spec.parts || [spec]).map((p) => p.key);
  const reportedByKey = new Map();
  for (const k of keys) reportedByKey.set(k, opts.reported ? opts.reported(k) : await reportedFor({ key: k }).catch(() => new Set()));
  const order = orderCertified([...map.values()].filter((e) => e.station), { keys, exclude, recent, reported: (k) => reportedByKey.get(k) || new Set(), rng: opts.rng });
  const probe = opts.probe || probeStream;
  for (let i = 0; i < Math.min(order.length, MAX_TRIES); i += BATCH) {
    const batch = order.slice(i, i + BATCH);
    const probes = await Promise.all(batch.map(async ({ entry }) => { try { return await probe(entry.station.url, PROBE); } catch (_) { return { ok: false }; } }));
    for (const [j, { entry, key }] of batch.entries()) {
      const p = probes[j];
      if (!p || !p.ok) continue;
      const st = entry.station;
      rememberStream(st.uuid, st.url, st.countryCode);
      return { ...st, genre: keyWord(key), bitrate: p.bitrate || st.bitrate || null, cors: p.cors != null ? Boolean(p.cors) : st.cors, title: null, localArtist: null, certifiedFor: entry.keys.slice() };
    }
  }
  return null;
}

module.exports = { validKeys, sanitizeStation, orderCertified, keyWord, load, keysFor, snapshotFor, listAll, setKeys, certifiedNext, forget, resetCertified, UUID, MAX_KEYS };
