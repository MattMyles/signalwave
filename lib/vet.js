// The five checks a station must pass before Signal Wave plays it:
// 1 directory filters, 2 music only, 3 has a city, 4 alive and fast,
// 5 real song metadata. Passing stations are pooled per genre.
const { GENRES, TAG_PATTERN, MUSIC_TAGS, TALK_BLOCKLIST, REGIONS, LIMITS, TAG_ALIASES } = require('./config');
const { searchStations } = require('./radio');
const { probeStream } = require('./icy');
const { locateStation } = require('./geo');
const { translateTags } = require('./translate');
const { songFits } = require('./songcheck');
const { noteSong, pickLocal } = require('./artistcheck');

// Stations whose current song didn't fit a genre, per genre: "rock|<uuid>" -> expiry.
// Skipped for that genre for a while (they may suit another genre fine).
const offGenre = new Map();
const OFF_GENRE_MS = 3 * 60 * 60 * 1000;
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
  if (t && TAG_PATTERN.test(t)) return { key: `tag:${t}`, label: t, tags: [t, ...(TAG_ALIASES[t] || [])] };
  const g = String(genre || '').toLowerCase().replace(/[^a-z]/g, '');
  if (GENRES[g]) return { key: g, label: GENRES[g].label, tags: GENRES[g].tags };
  return null;
}

// Several genres at once (up to 5): "electronic,tag:deep house,jazz".
// Matching accepts any of them; each search picks one at random so they all
// get equal airtime.
function resolveGenres(list) {
  const specs = [];
  for (const raw of String(list || '').split(',').slice(0, 5)) {
    const id = raw.trim();
    const spec = id.startsWith('tag:') ? resolveGenre(null, id.slice(4)) : resolveGenre(id);
    if (spec && !specs.some((x) => x.key === spec.key)) specs.push(spec);
  }
  if (!specs.length) return null;
  if (specs.length === 1) return specs[0];
  specs.sort((a, b) => a.key.localeCompare(b.key));
  return {
    key: specs.map((x) => x.key).join('+'),
    label: specs.map((x) => x.label).join(' + '),
    tags: [...new Set(specs.flatMap((x) => x.tags))],
    parts: specs,
  };
}
const onePart = (spec) => (spec && spec.parts ? spec.parts[Math.floor(Math.random() * spec.parts.length)] : spec);

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

// Directory tags are a free-for-all: many hits and variety stations list a
// dozen genres. For a chosen genre, a station only counts when it's really
// about that genre: at most one other-genre tag comes before it (or the
// genre is in its name), and it isn't spread across many unrelated main
// genres. rawTags keep the station's own order; translated
// foreign tags are checked in place of the original.
// Tags that say nothing about the style: decades, "music", languages and so on.
const NEUTRAL_TAG = /^(\d0s|\d{4}s?|19\d0s|20\d0s|music|musica|musik|radio|fm|am|live|local|english|international|various|mix|free|stereo|hd)$/;
const FOCUS_OFF_BEFORE = 2; // other-genre tags allowed ahead of the chosen genre
const VARIETY_FAMILIES = 4; // spread across this many main genres = a variety station
function isFocused(rawTags, name, spec) {
  if (!spec) return true;
  const hits = (t) => spec.tags.some((g) => t.includes(g));
  const n = String(name || '').toLowerCase();
  if (spec.tags.some((g) => g.length >= 4 && n.includes(g))) return true;
  // The chosen genre's family: hard rock or blues rock ahead of classic rock is fine.
  const family = Object.values(GENRES).filter((g) => g.tags.some((x) => spec.tags.some((t) => t.includes(x))));
  const onSide = (t) => hits(t) || family.some((g) => g.tags.some((x) => t.includes(x)));
  const tags = rawTags.map((t) => ({ t, en: translateTags([t]) })).filter((x) => !NEUTRAL_TAG.test(x.t));
  const pos = tags.findIndex((x) => x.en.some(hits));
  if (pos < 0) return false;
  const all = tags.flatMap((x) => x.en);
  const families = Object.values(GENRES).filter((g) => all.some((t) => g.tags.some((x) => t.includes(x)))).length;
  if (families >= VARIETY_FAMILIES) return false;
  const offBefore = tags.slice(0, pos).filter((x) => !x.en.some(onSide)).length;
  return offBefore < FOCUS_OFF_BEFORE;
}

// A title counts as a song when it looks like "Artist - Title" and isn't
// the station name, a slogan or an ad marker.
function looksLikeSong(title, stationName) {
  if (!title) return false;
  const t = title.trim();
  if (t.length < 5 || t.length > 200) return false;
  // "Artist - Title", plus formats Japanese and other CJK stations use:
  // full-width separators (／ ｜ －), 「Title」 quotes, and " / " in CJK text.
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t);
  const western = /\S\s+[-–—|]\s+\S/.test(t);
  const wide = /\S\s*[／｜－]\s*\S/.test(t) || /\S\s*[「『].+[」』]/.test(t);
  const slash = cjk && /\S\s+\/\s+\S/.test(t);
  if (!western && !wide && !slash) return false;
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
  const part = onePart(spec);
  // The style's own name always, plus one of its other names.
  const tags = part ? [part.tags[0], ...shuffle(part.tags.slice(1)).slice(0, 1)] : [undefined];
  const jobs = [];
  for (const cc of countries) {
    for (const tag of tags) jobs.push(searchStations({ tag, countrycode: cc, limit: 100 }).catch(() => []));
    // Plus a sample of the country's stations with no keyword: stations tagged
    // in their own language (ロック, música) never match an English search, so
    // they're matched here after translateTags.
    if (part) jobs.push(searchStations({ countrycode: cc, limit: 100 }).catch(() => []));
  }
  return shuffle((await Promise.all(jobs)).flat());
}

// Worldwide search across every name of the selected genres (main names
// first), so small styles like synthwave still find their few stations.
async function searchWorld(spec) {
  if (!spec) return searchStations({});
  const parts = spec.parts || [spec];
  const tags = [...new Set([...parts.map((p) => p.tags[0]), ...parts.flatMap((p) => p.tags.slice(1))])].slice(0, 8);
  const lists = await Promise.all(tags.map((tag) => searchStations({ tag, limit: 200 }).catch(() => [])));
  const seen = new Set();
  return shuffle(lists.flat().filter((s) => s.stationuuid && !seen.has(s.stationuuid) && seen.add(s.stationuuid)));
}

async function vetRound(spec, exclude, region) {
  const raw = region ? await searchRegion(spec, region) : await searchWorld(spec);

  // Checks 1-3 are instant (no network): directory fields, music-only tags,
  // and a named city near the station's coordinates.
  const located = [];
  const log = []; // each station's result, for the dashboard
  const note = (s, result) => log.push({ uuid: s.stationuuid, result, cc: s.countrycode });
  for (const s of raw) {
    if (located.length >= LIMITS.candidatesPerRound) break;
    if (!s.stationuuid || exclude.has(s.stationuuid) || isFailed(s.stationuuid)) continue;
    if (!s.url_resolved || !s.url_resolved.startsWith('https://')) { note(s, 'not_https'); continue; }
    if (/m3u8|\.pls$|\.m3u$/i.test(s.url_resolved) || s.hls === 1) { note(s, 'playlist'); continue; }
    const tags = translateTags(splitTags(s.tags)); // foreign tags get their English words too
    if (!isMusicStation(tags, spec ? spec.tags : [])) { note(s, 'not_music'); continue; }
    if (!matchesGenre(tags, spec)) continue; // a different genre isn't a failure
    if (!isFocused(splitTags(s.tags), s.name, spec)) continue; // tagged with the genre but mostly plays others
    if (spec && (offGenre.get(`${spec.key}|${s.stationuuid}`) || 0) > Date.now()) continue; // its songs didn't fit lately
    // A city from the station's coordinates, or (no coordinates) from its
    // listed region or a city in its name.
    const place = await locateStation(s);
    if (!place) { markFailed(s.stationuuid, LIMITS.failedTtlMs); note(s, s.geo_lat == null ? 'no_coords' : 'no_city'); continue; }
    located.push({ s, tags, place });
  }

  // Checks 4 and 5 (network): the stream answers fast and sends a real song title.
  // Plus a quality floor: streams below LIMITS.minKbps (AAC: minKbpsAac) are too weak.
  const probed = await mapLimit(located, LIMITS.probeConcurrency, async (c) => {
    const p = await probeStream(c.s.url_resolved);
    if (p.ok && looksLikeSong(p.title, c.s.name)) {
      const kbps = p.bitrate || c.s.bitrate || 0;
      const floor = /aac/i.test(`${c.s.codec || ''} ${p.contentType || ''}`) ? LIMITS.minKbpsAac : LIMITS.minKbps;
      if (kbps && kbps < floor) { markFailed(c.s.stationuuid, LIMITS.failedTtlMs); note(c.s, 'low_quality'); return null; }
      note(c.s, 'passed');
      return { ...c, p };
    }
    // A wrong answer (no titles, not audio, 404) is remembered for hours; a
    // slow or flaky connection only briefly, since it may be fine next time.
    const transient = !p.ok && /^(slow|timeout|error:|ended|stream-error)/.test(p.reason || '');
    markFailed(c.s.stationuuid, transient ? LIMITS.retryTtlMs : LIMITS.failedTtlMs);
    note(c.s, p.ok ? 'no_song_titles' : transient ? 'slow_or_offline' : 'not_audio');
    return null;
  });

  // Song check: the song playing now must fit the chosen genre (looked up in
  // Apple's catalog). Unknown songs pass; only a clear mismatch rejects.
  const fits = await Promise.all(probed.map((hit) => (hit ? songFits(hit.p.title, spec).catch(() => null) : null)));
  const passed = [];
  for (const [i, hit] of probed.entries()) {
    if (!hit) continue;
    if (fits[i] === false) {
      offGenre.set(`${spec.key}|${hit.s.stationuuid}`, Date.now() + OFF_GENRE_MS);
      if (offGenre.size > 20000) offGenre.clear();
      continue;
    }
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
      lat: hit.place.lat,
      lng: hit.place.lng,
      bitrate: hit.p.bitrate || hit.s.bitrate || null,
      codec: hit.s.codec || null,
      cors: hit.p.cors,
      title: hit.p.title,
      vettedAt: Date.now(),
    };
    known.set(station.uuid, station.url);
    passed.push(station);
  }
  // Local artists: note who this station is playing (a few per search, since
  // the lookup service is rate-limited). Never rejects; it steers picks.
  await Promise.all(passed.slice(0, 3).map(async (st) => {
    st.localArtist = await noteSong(st.uuid, st.countryCode, st.title).catch(() => null);
  }));
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
    if (ready.length) return pickLocal(ready);

    const passed = await vetRound(spec, exclude, region);
    for (const s of passed) getPool(`${gkey}:${regionOf(s.countryCode) || region}`).set(s.uuid, s);
    if (passed.length) return pickLocal(passed);
    // Every region tried once: a small genre won't do better region by
    // region, so go worldwide now instead of looping until the deadline.
    if (tried.size >= Object.keys(REGIONS).length) break;
  }
  // Worldwide across all of the genre's names, so the listener still gets music.
  const passed = await vetRound(spec, exclude, null);
  for (const s of passed) getPool(`${gkey}:${regionOf(s.countryCode) || 'world'}`).set(s.uuid, s);
  return pickLocal(passed);
}

function knownStreamUrl(uuid) { return known.get(uuid) || null; }
function rememberStream(uuid, url) { known.set(uuid, url); }

module.exports = { nextStation, resolveGenre, resolveGenres, knownStreamUrl, rememberStream, isMusicStation, looksLikeSong, splitTags, matchesGenre, isFocused };
