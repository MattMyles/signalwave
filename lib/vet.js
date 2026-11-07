// The five checks a station must pass before Signal Wave plays it:
// 1 directory filters, 2 music only, 3 has a city, 4 alive and fast,
// 5 real song metadata. Passing stations are pooled per genre.
const { GENRES, TAG_PATTERN, MUSIC_TAGS, TALK_BLOCKLIST, REGIONS, LIMITS } = require('./config');
const { searchStations } = require('./radio');
const { probeStream } = require('./icy');
const { reverseGeocode } = require('./geo');

const pools = new Map(); // genre -> Map(uuid -> station)
const failed = new Map(); // uuid -> timestamp
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

  // Checks 1 and 2: directory fields and music-only tags (cheap, no network).
  const candidates = raw.filter((s) => {
    if (!s.stationuuid || exclude.has(s.stationuuid)) return false;
    const f = failed.get(s.stationuuid);
    if (f && Date.now() - f < LIMITS.failedTtlMs) return false;
    if (!s.url_resolved || !s.url_resolved.startsWith('https://')) return false;
    if (s.geo_lat == null || s.geo_long == null) return false;
    if (/m3u8|\.pls$|\.m3u$/i.test(s.url_resolved) || s.hls === 1) return false;
    const tags = splitTags(s.tags);
    return isMusicStation(tags, spec ? spec.tags : []) && matchesGenre(tags, spec);
  }).slice(0, LIMITS.candidatesPerRound);

  // Checks 4 and 5: stream answers fast and sends a real song title.
  const probed = await mapLimit(candidates, LIMITS.probeConcurrency, async (s) => {
    const p = await probeStream(s.url_resolved);
    const pass = p.ok && looksLikeSong(p.title, s.name);
    if (!pass) failed.set(s.stationuuid, Date.now());
    return pass ? { s, p } : null;
  });

  // Check 3: coordinates resolve to a named city (rate-limited, so last).
  const passed = [];
  for (const hit of probed.filter(Boolean)) {
    const place = await reverseGeocode(hit.s.geo_lat, hit.s.geo_long);
    if (!place || !place.city) { failed.set(hit.s.stationuuid, Date.now()); continue; }
    const tags = splitTags(hit.s.tags);
    const station = {
      uuid: hit.s.stationuuid,
      name: cleanName(hit.s.name) || 'Unnamed station',
      url: hit.s.url_resolved,
      homepage: hit.s.homepage || null,
      favicon: /^https:\/\//.test(hit.s.favicon || '') ? hit.s.favicon : null,
      tags,
      genre: displayGenre(tags, spec),
      city: place.city,
      country: hit.s.country || place.country || 'Unknown',
      countryCode: (hit.s.countrycode || '').toUpperCase() || null,
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
