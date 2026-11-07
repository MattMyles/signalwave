// The five checks a station must pass before Signal Wave plays it:
// 1 directory filters, 2 music only, 3 has a city, 4 alive and fast,
// 5 real song metadata. Passing stations are pooled per genre.
const { GENRES, TAG_PATTERN, MUSIC_TAGS, TALK_BLOCKLIST, REGIONS, LIMITS } = require('./config');
const { searchStations } = require('./radio');
const { probeStream } = require('./icy');
const { reverseGeocode } = require('./geo');
const { recordChecks } = require('./checklog');

const pools = new Map(); // genre -> Map(uuid -> station)
const failed = new Map(); // uuid -> time until which it's skipped
function markFailed(uuid, ms) { failed.set(uuid, Date.now() + ms); if (failed.size > 20000) failed.clear(); }
function isFailed(uuid) { const until = failed.get(uuid); return Boolean(until && until > Date.now()); }
const known = new Map(); // uuid -> stream url, for /api/nowplaying

const splitTags = (s) => String(s || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);

// A genre "spec" is { key, label, tags }: a main genre from config, or a
// single sub-genre tag the listener added. null means any music.
function resolveGenre(genre, tag) {
  const t = String(tag || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (t && TAG_PATTERN.test(t)) return { key: `tag:${t}`, label: t, tags: [t] };
  const g = String(genre || '').toLowerCase().replace(/[^a-z]/g, '');
  if (GENRES[g]) return { key: g, label: GENRES[g].label, tags: GENRES[g].tags };
  return null;
}

// extra = the requested genre's tags, so niche tags like "shoegaze" count as music.
function isMusicStation(tags, extra = []) {
  if (!tags.length) return false;
  if (tags.some((t) => TALK_BLOCKLIST.some((b) => t.includes(b)))) return false;
  return tags.some((t) => MUSIC_TAGS.some((m) => t.includes(m)) || extra.some((m) => t.includes(m)));
}

function matchesGenre(tags, spec) {
  if (!spec) return true;
  return tags.some((t) => spec.tags.some((g) => t.includes(g)));
}

// A title counts as a song when it looks like "Artist - Title" and isn't
// the station name, a slogan or an ad marker.
function looksLikeSong(title, stationName) {
  if (!title) return false;
  const t = title.trim();
  if (t.length < 5 || t.length > 200) return false;
  if (!/\S\s+[-–—|]\s+\S/.test(t)) return false;
  const lower = t.toLowerCase();
  const name = String(stationName || '').toLowerCase().trim();
  if (name && (lower === name || lower.startsWith(`${name} -`) || lower.endsWith(`- ${name}`))) return false;
  if (/(^|\W)(advert|advertisement|commercial|jingle|station id|unknown - unknown|sponsor)(\W|$)/.test(lower)) return false;
  if (/^(https?:\/\/|www\.)/.test(lower)) return false;
  return true;
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s\-_|.]+|[\s\-_|.]+$/g, '').trim();
}

function displayGenre(tags, spec) {
  if (spec) {
    const hit = tags.find((t) => spec.tags.some((g) => t.includes(g)));
    return hit || spec.label.toLowerCase();
  }
  return tags.filter((t) => MUSIC_TAGS.some((m) => t.includes(m))).slice(0, 2).join(' / ') || tags[0];
}

function getPool(genre) {
  const k = genre || 'any';
  if (!pools.has(k)) pools.set(k, new Map());
  const pool = pools.get(k);
  for (const [id, s] of pool) if (Date.now() - s.vettedAt > LIMITS.poolTtlMs) pool.delete(id);
  return pool;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const regionOf = (cc) => Object.keys(REGIONS).find((r) => REGIONS[r].includes(String(cc || '').toUpperCase())) || null;

// Picks a region the listener hasn't just heard, every region equally likely.
function chooseRegion(avoid) {
  const options = Object.keys(REGIONS).filter((r) => !avoid.has(r));
  return pick(options.length ? options : Object.keys(REGIONS));
}

// Searches up to four countries in the region at once. A genre uses several
// of its tags so small countries still return something.
async function searchRegion(spec, region) {
  const countries = shuffle(REGIONS[region]).slice(0, 4);
  const tags = spec ? shuffle(spec.tags).slice(0, 2) : [undefined];
  const jobs = [];
  for (const cc of countries) for (const tag of tags) jobs.push(searchStations({ tag, countrycode: cc, limit: 40 }).catch(() => []));
  return shuffle((await Promise.all(jobs)).flat());
}

async function vetRound(spec, exclude, region) {
  const raw = region
    ? await searchRegion(spec, region)
    : await searchStations({ tag: spec ? pick(spec.tags) : undefined });

  // Checks 1-3 are instant (no network): directory fields, music-only tags,
  // and a named city near the station's coordinates.
  const located = [];
  const log = []; // each station's result, for the dashboard
  const note = (s, result) => log.push({ uuid: s.stationuuid, result, cc: s.countrycode });
  for (const s of raw) {
    if (located.length >= LIMITS.candidatesPerRound) break;
    if (!s.stationuuid || exclude.has(s.stationuuid) || isFailed(s.stationuuid)) continue;
    if (!s.url_resolved || !s.url_resolved.startsWith('https://')) { note(s, 'not_https'); continue; }
    if (s.geo_lat == null || s.geo_long == null) { note(s, 'no_coords'); continue; }
    if (/m3u8|\.pls$|\.m3u$/i.test(s.url_resolved) || s.hls === 1) { note(s, 'playlist'); continue; }
    const tags = splitTags(s.tags);
    if (!isMusicStation(tags, spec ? spec.tags : [])) { note(s, 'not_music'); continue; }
    if (!matchesGenre(tags, spec)) continue; // a different genre isn't a failure
    const place = await reverseGeocode(s.geo_lat, s.geo_long, s.countrycode);
    if (!place) { markFailed(s.stationuuid, LIMITS.failedTtlMs); note(s, 'no_city'); continue; }
    located.push({ s, tags, place });
  }

  // Checks 4 and 5 (network): the stream answers fast and sends a real song title.
  const probed = await mapLimit(located, LIMITS.probeConcurrency, async (c) => {
    const p = await probeStream(c.s.url_resolved);
    if (p.ok && looksLikeSong(p.title, c.s.name)) { note(c.s, 'passed'); return { ...c, p }; }
    // A wrong answer (no titles, not audio, 404) is remembered for hours; a
    // slow or flaky connection only briefly, since it may be fine next time.
    const transient = !p.ok && /^(slow|timeout|error:|ended|stream-error)/.test(p.reason || '');
    markFailed(c.s.stationuuid, transient ? LIMITS.retryTtlMs : LIMITS.failedTtlMs);
    note(c.s, p.ok ? 'no_song_titles' : transient ? 'slow_or_offline' : 'not_audio');
    return null;
  });

  const passed = [];
  for (const hit of probed.filter(Boolean)) {
    const station = {
      uuid: hit.s.stationuuid,
      name: cleanName(hit.s.name) || 'Unnamed station',
      url: hit.s.url_resolved,
      homepage: hit.s.homepage || null,
      favicon: /^https:\/\//.test(hit.s.favicon || '') ? hit.s.favicon : null,
      tags: hit.tags,
      genre: displayGenre(hit.tags, spec),
      city: hit.place.city,
      country: hit.s.country || 'Unknown',
      countryCode: (hit.s.countrycode || hit.place.countryCode || '').toUpperCase() || null,
      lat: Number(hit.s.geo_lat),
      lng: Number(hit.s.geo_long),
      bitrate: hit.p.bitrate || hit.s.bitrate || null,
      codec: hit.s.codec || null,
      cors: hit.p.cors,
      title: hit.p.title,
      vettedAt: Date.now(),
    };
    known.set(station.uuid, station.url);
    passed.push(station);
  }
  await recordChecks(log);
  return passed;
}

/**
 * Returns one vetted station for the genre, or null if none could be found in time.
 * recent = country codes the listener just heard; their regions are skipped
 * so consecutive stations land in different parts of the world.
 */
async function nextStation(spec, exclude = new Set(), recent = []) {
  const gkey = spec ? spec.key : 'any';
  const avoid = new Set(recent.map(regionOf).filter(Boolean));
  const tried = new Set(avoid);

  const deadline = Date.now() + LIMITS.vetDeadlineMs;
  while (Date.now() < deadline - LIMITS.probeTotalMs) {
    const region = chooseRegion(tried);
    tried.add(region);
    const pool = getPool(`${gkey}:${region}`);
    const ready = [...pool.values()].filter((s) => !exclude.has(s.uuid));
    if (ready.length) return pick(ready);

    const passed = await vetRound(spec, exclude, region);
    for (const s of passed) getPool(`${gkey}:${regionOf(s.countryCode) || region}`).set(s.uuid, s);
    if (passed.length) return passed[0];
    if (tried.size >= Object.keys(REGIONS).length) tried.clear();
  }
  // Last resort: an unfiltered worldwide search, so the listener still gets music.
  const passed = await vetRound(spec, exclude, null);
  return passed[0] || null;
}

function knownStreamUrl(uuid) { return known.get(uuid) || null; }
function rememberStream(uuid, url) { known.set(uuid, url); }

module.exports = { nextStation, resolveGenre, knownStreamUrl, rememberStream, isMusicStation, looksLikeSong, splitTags, matchesGenre };
