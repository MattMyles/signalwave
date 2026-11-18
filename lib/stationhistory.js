// A station's own record of what it played recently, read from its streaming
// server's public "recently played" pages, for the admin's song history of a
// reported station. Only the server behind the station's own https stream
// address is asked, and only for a few well-known paths:
//   SHOUTcast v2     /played?sid=1&type=json, then /played.html?sid=1
//   AzuraCast        /api/nowplaying/<shortcode>   (stream path /listen/<shortcode>/…)
//   Centova Cast     /recentfeed/<user>/json, then /external/rpc.php?m=recenttracks.get&username=<user>
//                    (stream path /proxy/<user>/…)
// Every parser is defensive: anything it doesn't recognise gives no songs.
// Requests refuse private addresses (resolveSafe) and connect to the address
// that was checked, so the admin can't be used to reach internal services.
const https = require('https');
const { resolveSafe } = require('./icy');
const { USER_AGENT } = require('./config');

const TIMEOUT_MS = 3000;
const MAX_BYTES = 256 * 1024;

const plainTitle = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '');
const decode = (s) => String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const l = e.toLowerCase();
  if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'";
  const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
// Seconds or milliseconds since 1970, or an ISO date, as milliseconds; null if it isn't one.
function toMs(v) {
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e11 ? v * 1000 : v;
    return ms > 9e11 && ms < 4.1e12 ? ms : null; // 1998 to 2099
  }
  if (typeof v === 'string' && /\d{4}-\d\d-\d\d/.test(v)) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
}
const TIME_KEYS = ['played_at', 'playedat', 'played', 'timestamp', 'time', 'date', 'start', 'started_at'];

// One entry of a history list -> { title: "Artist - Song", at } or null.
function songOf(e) {
  if (typeof e === 'string') { const t = text(e); return t ? { title: t, at: null } : null; }
  if (!e || typeof e !== 'object') return null;
  const inner = e.song && typeof e.song === 'object' ? e.song : e.track && typeof e.track === 'object' ? e.track : e;
  let title = text(inner.text) || text(e.text);
  if (!title) {
    const artist = text(inner.artist), name = text(inner.title) || text(inner.song) || text(inner.name);
    // Some servers put the whole "Artist - Song" in title: don't repeat the artist.
    title = artist && name && !plainTitle(name).startsWith(plainTitle(artist)) ? `${artist} - ${name}` : name || '';
  }
  if (!title) return null;
  let at = null;
  for (const k of TIME_KEYS) { at = toMs(e[k]); if (at) break; }
  return { title, at };
}
// Finds the first array of song-like entries in a parsed answer.
function songsFromJson(j, depth = 0) {
  if (Array.isArray(j)) {
    const list = j.map(songOf).filter(Boolean);
    if (list.length) return list;
    for (const x of j) { const r = depth < 3 && x && typeof x === 'object' ? songsFromJson(x, depth + 1) : []; if (r.length) return r; }
    return [];
  }
  if (j && typeof j === 'object' && depth < 3) {
    for (const k of ['song_history', 'history', 'data', 'rows', 'tracks', 'songs', 'recent', 'played', 'result', 'items']) {
      const r = j[k] != null ? songsFromJson(j[k], depth + 1) : [];
      if (r.length) return r;
    }
  }
  return [];
}
const tryJson = (body) => { try { return JSON.parse(body); } catch (_) { return null; } };

/** SHOUTcast v2 /played?type=json: [{ playedat, title }, ...] */
function parseShoutcastJson(body) { return songsFromJson(tryJson(body)); }
/** SHOUTcast /played.html: table rows of time and title (the time is the server's clock, so no time is kept). */
function parseShoutcastHtml(body) {
  const out = [];
  for (const m of String(body || '').matchAll(/<tr[^>]*>\s*<td[^>]*>\s*(\d{1,2}:\d\d(?::\d\d)?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const t = text(decode(m[2].replace(/<[^>]*>/g, ' ')));
    if (t && !/^current song$/i.test(t)) out.push({ title: t, at: null });
  }
  return out;
}
/** AzuraCast /api/nowplaying/<shortcode>: { song_history: [{ played_at, song: { text, artist, title } }] } */
function parseAzuraCast(body) {
  const j = tryJson(body);
  const entry = Array.isArray(j) ? j.find((x) => x && Array.isArray(x.song_history)) : j;
  return entry && Array.isArray(entry.song_history) ? songsFromJson(entry.song_history) : [];
}
/** Centova Cast recentfeed JSON and rpc.php recenttracks.get */
function parseCentova(body) { return songsFromJson(tryJson(body)); }

/** The paths worth trying for a stream address, in order: [{ url, parse }]. https only. */
function candidates(streamUrl) {
  let u;
  try { u = new URL(streamUrl); } catch (_) { return []; }
  if (u.protocol !== 'https:') return [];
  const o = u.origin;
  const out = [
    { url: `${o}/played?sid=1&type=json`, parse: parseShoutcastJson },
    { url: `${o}/played.html?sid=1`, parse: parseShoutcastHtml },
  ];
  const seg = (re) => { const m = re.exec(u.pathname); return m ? encodeURIComponent(decodeURIComponent(m[1])) : null; };
  const azura = seg(/^\/listen\/([A-Za-z0-9_.-]{1,64})\//);
  if (azura) out.unshift({ url: `${o}/api/nowplaying/${azura}`, parse: parseAzuraCast });
  const centova = seg(/^\/proxy\/([A-Za-z0-9_.-]{1,64})(?:\/|$)/);
  if (centova) out.unshift(
    { url: `${o}/recentfeed/${centova}/json`, parse: parseCentova },
    { url: `${o}/external/rpc.php?m=recenttracks.get&username=${centova}`, parse: parseCentova },
  );
  return out;
}

/** GET a small text page over https, to the address resolveSafe approved. Rejects on anything unusual (no redirects). */
async function getText(url, { timeoutMs = TIMEOUT_MS } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('https only');
  const address = await resolveSafe(u.hostname);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeoutMs);
    const req = https.request({
      host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || 443, path: `${u.pathname}${u.search}`, method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html;q=0.8, */*;q=0.5' },
      // The address that was checked (newer Node asks for a list); SNI and Host stay the name.
      lookup: (_h, o, cb) => { const family = address.includes(':') ? 6 : 4; return o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family); },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); clearTimeout(timer); return reject(new Error(`http-${res.statusCode}`)); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > MAX_BYTES) { req.destroy(); clearTimeout(timer); reject(new Error('too-big')); } else chunks.push(c); });
      res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/**
 * What the station's own server says it played recently: [{ title, at }]
 * newest first, or [] (nothing found, or no known format). All paths are asked
 * at the same time; the first in the list that yields songs wins.
 */
async function serverHistory(streamUrl, opts = {}) {
  const get = opts.get || getText;
  const list = candidates(streamUrl);
  const answers = await Promise.all(list.map(async (c) => {
    try { return c.parse(await get(c.url)).slice(0, 30); } catch (_) { return []; }
  }));
  const found = answers.find((a) => a.length) || [];
  // Newest first: servers differ, so order by time when every entry has one.
  return found.every((s) => s.at) ? found.slice().sort((a, b) => b.at - a.at) : found;
}

/**
 * Merges song lists into one history: lists = [{ source, items: [{ title, at }] }]
 * in priority order (the first list that has a song gives its label), de-duplicated
 * by normalized title, newest first, at most `max`. Songs with no time (some
 * servers don't give one) come first, in their own order, as they are the
 * freshest the server knows.
 */
function mergeHistory(lists, max = 10) {
  const seen = new Map();
  const order = [];
  for (const { source, items } of lists) {
    (items || []).forEach((it, i) => {
      const key = plainTitle(it && it.title);
      if (!key) return;
      const have = seen.get(key);
      if (have) { if (!have.at && it.at) have.at = it.at; return; }
      const row = { title: String(it.title).trim(), at: it.at || null, source, rank: order.length };
      seen.set(key, row); order.push(row);
    });
  }
  const timed = order.filter((r) => r.at).sort((a, b) => b.at - a.at);
  const untimed = order.filter((r) => !r.at);
  return [...untimed, ...timed].slice(0, max).map(({ title, at, source }) => ({ title, at, source }));
}

module.exports = { mergeHistory, plainTitle, serverHistory, candidates, getText, parseShoutcastJson, parseShoutcastHtml, parseAzuraCast, parseCentova, songsFromJson };
