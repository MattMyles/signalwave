#!/usr/bin/env node
// The station scout: fills and tends the shelf (Supabase station_pool) that
// /api/next draws from, so listeners get a vetted station straight away
// instead of waiting for a live search. Run by .github/workflows/scout.yml
// every 30 minutes, or by hand: `node scripts/scout.js`.
//
// Each run:
//   1. DISCOVER  new stations from Radio Browser (a different slice of the
//      genres and countries each run, so the catalogue is covered over a day
//      or two) and from the Icecast directory (dir.xiph.org/yp.xml); they go
//      through the same hard checks as live play, with patient timeouts.
//   2. RE-CHECK  stations already on the shelf, oldest check first: is the
//      stream up, what song is on. Each check adds a song sample (last 8 kept).
//   3. JUDGE     every station's genres from what it actually plays across its
//      samples (songs looked up once in Apple's catalog, cached in
//      song_lookups), plus how local its artists are (MusicBrainz).
//   4. SAVE      upserts rows in batches and writes a scout_runs row.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; without them it says so
// and exits 0. SCOUT_MINUTES (default 20) is the time budget.
const { serviceEnv } = require('../lib/supabase-env');
const { makeDb } = require('../lib/sbrest');
const cfg = require('../lib/config');
const { searchStations } = require('../lib/radio');
const { probeStream } = require('../lib/icy');
const { locateStation, cityAnywhere } = require('../lib/geo');
const { translateTags } = require('../lib/translate');
const { nativeWords } = require('../lib/genre-words');
const vet = require('../lib/vet');
const songs = require('../lib/songcheck');
const { artistCountry } = require('../lib/artistcheck');
const shelf = require('../lib/shelf');

const DAY = 86400000;
const COLUMNS = ['uuid', 'source', 'name', 'url', 'homepage', 'favicon', 'tags', 'country', 'country_code', 'city', 'lat', 'lng', 'codec', 'bitrate', 'cors',
  'genres', 'samples', 'local_ratio', 'ok_count', 'fail_streak', 'status', 'first_seen_at', 'last_checked_at', 'last_ok_at'];
const MAIN_IDS = Object.keys(cfg.GENRES);
const COUNTRIES = [...new Set(Object.values(cfg.REGIONS).flat())].sort();
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (cc) => { try { return (regionNames && regionNames.of(cc)) || cc; } catch (_) { return cc; } };

const DEFAULTS = {
  budgetMs: (Number(process.env.SCOUT_MINUTES) > 0 ? Number(process.env.SCOUT_MINUTES) : 20) * 60000,
  chunk: 64,             // stations probed per step
  concurrency: 16,       // streams probed at once
  probeOpts: { firstByteMs: 6000, totalMs: 10000 }, // patient: the live path allows 4 s and 6 s
  itunesSpacingMs: 4000, // iTunes allows about 20 requests a minute; stay at 15
  itunesMax: 250,        // new iTunes lookups per run
  itunesPerChunk: 14,
  mbMax: 900,            // MusicBrainz lookups per run (they're spaced about 1 s apart)
  mbPerChunk: 45,
  keysPerRun: 10,        // genres and styles searched worldwide per run
  countriesPerRun: 5,    // countries searched per run
  maxNew: 900,           // new Radio Browser stations to check per run
  maxIcecast: 300,       // new Icecast stations to check per run
  recheckActive: 1500,
  recheckDead: 150,
  deadRetryDays: 7,
  discoverShare: 0.3,    // of the budget, at most, spent searching directories
  newShare: 0.5,         // of the remaining time, at most, spent on new stations
  safetyMs: 45000,       // stop starting work this long before the budget ends
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();

function defaults() {
  return {
    now: () => Date.now(),
    log: (...a) => console.log(...a),
    search: searchStations,
    fetchYp: async () => {
      const r = await fetch('https://dir.xiph.org/yp.xml', { headers: { 'User-Agent': cfg.USER_AGENT }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      console.log(`Icecast directory: HTTP ${r.status}, ${r.headers.get('content-type') || 'no content type'}, from ${r.url}`);
      return r.text();
    },
    probe: probeStream,
    songInfo: songs.songInfo,
    artistCountry,
    sleep,
    sliceIndex: () => (process.env.SCOUT_SLICE != null && process.env.SCOUT_SLICE !== '' ? Number(process.env.SCOUT_SLICE) : Math.floor(Date.now() / (30 * 60000))),
  };
}

// The song cache in Supabase (song_lookups), in front of iTunes.
function makeSongCache(db, now) {
  const mem = new Map(); // key -> info | null
  const fresh = [];
  return {
    async prefetch(keys) {
      const want = [...new Set(keys)].filter((k) => k && !mem.has(k) && !/["\\,()]/.test(k));
      for (let i = 0; i < want.length; i += 60) {
        const part = want.slice(i, i + 60);
        let rows = [];
        try { rows = await db.get(`/song_lookups?select=key,genre,year,found,looked_at&key=in.(${part.map((k) => `"${encodeURIComponent(k)}"`).join(',')})`); } catch (_) { /* cache only */ }
        for (const r of rows || []) {
          if (r.found) mem.set(r.key, { genres: String(r.genre || '').split('|').filter(Boolean), year: r.year || null });
          else if (now() - Date.parse(r.looked_at) < 30 * DAY) mem.set(r.key, null); // "not found" is rechecked after 30 days
        }
      }
    },
    get: (key) => (mem.has(key) ? mem.get(key) : undefined),
    set(key, info) {
      mem.set(key, info);
      if (key.length <= 400) fresh.push({ key, genre: info ? info.genres.join('|') : null, year: info ? info.year : null, found: Boolean(info), looked_at: iso(now()) });
    },
    async flush() {
      if (!fresh.length) return;
      const rows = fresh.splice(0, fresh.length);
      try { await db.upsert('song_lookups', rows); } catch (_) { /* cache only */ }
    },
  };
}

async function run(overrides = {}) {
  const D = { ...defaults(), ...DEFAULTS, ...overrides };
  const { db, log } = D;
  const t0 = D.now();
  const budgetEnd = t0 + D.budgetMs;
  const stopAt = budgetEnd - Math.min(D.safetyMs, D.budgetMs * 0.15);
  let aborted = false;
  const stopped = () => aborted || D.now() >= stopAt;
  const onSignal = () => { aborted = true; };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  const stats = { discovered: 0, checked: 0, added: 0, now_dead: 0, active_total: 0 };
  const notes = [];
  const note = (s) => { notes.push(s); log(`  ${s}`); };
  const counts = {}; // reasons, for the notes
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  const used = { itunes: 0, mb: 0 };

  let runId = null;
  try {
    const made = await db.insert('scout_runs', [{ started_at: iso(t0), notes: 'running' }]);
    runId = made && made[0] && made[0].id;
  } catch (e) {
    note(`scout_runs unavailable (${e.message}). Has the station_pool migration been run?`);
    process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
    throw e;
  }

  try {
    /* ---------- What's already on the shelf ---------- */
    const index = await db.getAll('/station_pool?select=uuid,url,status&order=uuid');
    const haveUuid = new Set(index.map((r) => r.uuid));
    const haveUrl = new Set(index.map((r) => shelf.normalizeUrl(r.url)));
    log(`Shelf has ${index.length} stations on file.`);

    /* ---------- 1. Discover ---------- */
    const discoverEnd = t0 + D.budgetMs * D.discoverShare;
    const slice = D.sliceIndex();
    const pickSlice = (list, n) => Array.from({ length: Math.min(n, list.length) }, (_, j) => list[(Math.abs(slice) * n + j) % list.length]);
    const keys = pickSlice(shelf.SPECS.size ? [...shelf.SPECS.keys()] : [], D.keysPerRun);
    const countries = pickSlice(COUNTRIES, D.countriesPerRun);
    log(`Slice ${slice}: ${keys.join(', ')} | ${countries.join(' ')}`);

    const jobs = [];
    for (const key of keys) {
      const spec = shelf.SPECS.get(key);
      for (const tag of [...new Set(spec.tags)].slice(0, 5)) jobs.push({ tag, limit: 200 });
    }
    for (const cc of countries) {
      jobs.push({ countrycode: cc, limit: 200 });
      for (const id of MAIN_IDS) {
        jobs.push({ tag: cfg.GENRES[id].tags[0], countrycode: cc, limit: 100 });
        const native = nativeWords(cfg.GENRES[id].tags[0], cc)[0];
        if (native) jobs.push({ tag: native, countrycode: cc, limit: 100 });
      }
    }
    const raw = new Map(); // stationuuid -> station
    let cursor = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (cursor < jobs.length && D.now() < discoverEnd && !stopped()) {
        const job = jobs[cursor++];
        try { for (const s of await D.search(job)) if (s && s.stationuuid && !raw.has(s.stationuuid)) raw.set(s.stationuuid, s); } catch (_) { bump('search_failed'); }
      }
    }));
    log(`Radio Browser: ${jobs.length} searches planned, ${cursor} run, ${raw.size} distinct stations.`);

    const seenUrl = new Set();
    const candidates = [];
    const styleExtra = shelf.STYLE_TAGS;
    for (const s of vet.shuffle([...raw.values()])) {
      if (candidates.length >= D.maxNew || stopped() || D.now() > discoverEnd + 60000) break;
      const url = s.url_resolved;
      if (haveUuid.has(s.stationuuid)) continue;
      if (!url || !url.startsWith('https://')) { bump('skip_not_https'); continue; }
      if (url.length > 2000) continue;
      const nu = shelf.normalizeUrl(url);
      if (haveUrl.has(nu) || seenUrl.has(nu)) { bump('skip_duplicate'); continue; }
      if (/m3u8|\.pls$|\.m3u$/i.test(url) || s.hls === 1) { bump('skip_playlist'); continue; }
      const place = await locateStation(s);
      if (!place) { bump('skip_no_city'); continue; }
      const rawTags = vet.splitTags(s.tags);
      if (!vet.isMusicStation(translateTags(rawTags), styleExtra)) { bump('skip_not_music'); continue; }
      seenUrl.add(nu);
      candidates.push({
        uuid: s.stationuuid, source: 'radiobrowser', name: vet.cleanName(s.name) || 'Unnamed station', url,
        homepage: s.homepage || null, favicon: /^https:\/\//.test(s.favicon || '') ? s.favicon : null,
        rawTags, country: s.country || countryName((s.countrycode || place.countryCode || '').toUpperCase()) || 'Unknown',
        country_code: (s.countrycode || place.countryCode || '').toUpperCase() || null,
        city: place.city, lat: place.lat, lng: place.lng, codec: s.codec || null, bitrate: Number(s.bitrate) || null,
      });
    }

    // The Icecast directory.
    let icecast = 0;
    try {
      const xml = await D.fetchYp();
      const entries = shelf.parseYp(xml);
      if (!entries.length) {
        // Show what the directory sent, so a format change can be fixed.
        log(`Icecast directory sent ${String(xml || '').length} characters but no entries. Start: ${JSON.stringify(String(xml || '').slice(0, 400))}`);
      }
      log(`Icecast directory: ${entries.length} entries${entries.length >= 1000 && entries.length % 1000 === 0 ? ' (a round number: the directory may be capped)' : ''}.`);
      notes.push(`icecast_entries=${entries.length}`);
      const fresh = [];
      for (const e of vet.shuffle(entries)) {
        if (fresh.length >= D.maxIcecast) break;
        if (e.type && !/^audio\/(mpeg|mp3|aac|aacp)\b/.test(e.type)) { bump('ice_skip_type'); continue; } // Ogg doesn't play on iPhones
        if (e.bitrate && e.bitrate < (/aac/.test(e.type || '') ? cfg.LIMITS.minKbpsAac : cfg.LIMITS.minKbps)) { bump('ice_skip_quality'); continue; }
        let url = e.url;
        try {
          const u = new URL(url);
          // Browsers block plain http streams on an https page: only addresses
          // that also answer on https (port 80 -> 443) can be used.
          if (u.protocol === 'http:') {
            if (u.port && u.port !== '80') { bump('ice_skip_not_https'); continue; }
            u.protocol = 'https:'; u.port = '';
            url = u.toString();
          }
        } catch (_) { continue; }
        if (url.length > 2000) continue;
        const nu = shelf.normalizeUrl(url);
        const uuid = shelf.icecastId(url);
        if (!nu || haveUuid.has(uuid) || haveUrl.has(nu) || seenUrl.has(nu)) { bump('ice_skip_duplicate'); continue; }
        const place = cityAnywhere(`${e.name} ${e.genre}`);
        if (!place) { bump('ice_skip_no_city'); continue; }
        const rawTags = shelf.ypTags(e.genre);
        if (!vet.isMusicStation(translateTags(rawTags), styleExtra)) { bump('ice_skip_not_music'); continue; }
        seenUrl.add(nu);
        fresh.push({
          uuid, source: 'icecast', name: vet.cleanName(e.name) || 'Unnamed station', url, homepage: null, favicon: null, rawTags,
          country: countryName(place.countryCode), country_code: place.countryCode, city: place.city, lat: place.lat, lng: place.lng,
          codec: /aac/.test(e.type || '') ? 'AAC' : 'MP3', bitrate: e.bitrate,
        });
      }
      icecast = fresh.length;
      candidates.push(...fresh);
    } catch (e) {
      note(`Icecast directory unavailable (${e.message})`);
    }
    stats.discovered = candidates.length;
    log(`New candidates: ${candidates.length} (${candidates.length - icecast} Radio Browser, ${icecast} Icecast).`);

    /* ---------- 2. Stations to re-check ---------- */
    const rechecks = [];
    try {
      const active = await db.getAll('/station_pool?select=*&status=eq.active&order=last_checked_at.asc,uuid.asc', { max: D.recheckActive });
      const dead = await db.getAll(`/station_pool?select=*&status=eq.dead&last_checked_at=lt.${encodeURIComponent(iso(t0 - D.deadRetryDays * DAY))}&order=last_checked_at.asc,uuid.asc`, { max: D.recheckDead });
      rechecks.push(...active, ...dead);
    } catch (e) { note(`Couldn't load stations to re-check (${e.message})`); }

    /* ---------- 3. Check, judge, save ---------- */
    const songCache = makeSongCache(db, D.now);
    const itunesGate = (() => {
      let next = 0;
      return async () => {
        if (used.itunes >= D.itunesMax || stopped()) return false;
        used.itunes++;
        const wait = next - D.now();
        next = Math.max(next, D.now()) + D.itunesSpacingMs;
        if (wait > 0) await D.sleep(wait);
        return true;
      };
    })();

    async function probeItem(item) {
      if (stopped()) { item.skipped = true; return item; }
      const { row } = item;
      let p;
      try { p = await D.probe(row.url, D.probeOpts); } catch (e) { p = { ok: false, reason: `error:${e.message}` }; }
      item.p = p;
      if (p.ok) {
        const kbps = p.bitrate || row.bitrate || 0;
        const floor = /aac/i.test(`${row.codec || ''} ${p.contentType || ''}`) ? cfg.LIMITS.minKbpsAac : cfg.LIMITS.minKbps;
        if (kbps && kbps < floor) { item.result = 'low_quality'; item.definite = true; }
        else if (vet.looksLikeSong(p.title, row.name)) { item.result = 'ok'; item.title = String(p.title).trim(); }
        else if (item.isNew || row.status === 'dead') { item.result = 'no_song_titles'; item.definite = true; }
        else item.result = 'neutral'; // alive, but no song title right now (an ad break?)
      } else {
        item.result = 'fail';
        item.definite = !/^(slow|timeout|error:|ended|stream-error)/.test(p.reason || '');
      }
      return item;
    }

    // Looks songs up (iTunes) and artists' countries (MusicBrainz) for a chunk.
    async function lookups(items) {
      const withSong = items.filter((i) => i.result === 'ok');
      const keysWanted = withSong.map((i) => { const sp = songs.splitSong(i.title); return sp ? songs.songKey(sp.artist, sp.song) : null; });
      await songCache.prefetch(keysWanted);
      let itunesLeft = D.itunesPerChunk;
      const gate = async () => { if (itunesLeft <= 0) return false; const ok = await itunesGate(); if (ok) itunesLeft--; return ok; };
      // Stations with the fewest identified songs first.
      const order = [...withSong].sort((a, b) => (a.row.samples || []).filter((s) => s.known).length - (b.row.samples || []).filter((s) => s.known).length);
      const itunes = (async () => {
        for (const item of order) {
          try {
            const r = await D.songInfo(item.title, { cache: songCache, gate });
            item.known = r.known;
            item.fits = r.known ? songs.fitKeys(r.info) : [];
          } catch (_) { item.known = false; item.fits = []; }
        }
      })();
      // Artist countries: the new song first, then up to two older samples that were never looked up.
      const wanted = [];
      for (const item of withSong) wanted.push({ item, title: item.title, fresh: true });
      for (const item of withSong) {
        for (const s of [...(item.row.samples || [])].reverse().filter((s) => s.cc === undefined).slice(0, 2)) wanted.push({ item, sample: s, title: s.title });
      }
      const mb = (async () => {
        let n = 0;
        for (const w of wanted) {
          if (n >= D.mbPerChunk || used.mb >= D.mbMax || stopped()) break;
          const sp = songs.splitSong(w.title);
          if (!sp || !w.item.row.country_code) continue;
          n++; used.mb++;
          let cc = null;
          try { cc = await D.artistCountry(sp.artist); } catch (_) { /* unknown */ }
          if (w.fresh) w.item.cc = cc || null; else w.sample.cc = cc || null;
        }
      })();
      await Promise.all([itunes, mb]);
    }

    // Turns a probed item into the row to save (or null for "nothing to save").
    function finalize(item) {
      const now = iso(D.now());
      const row = item.row;
      if (item.isNew) {
        if (item.result === 'ok') {
          row.samples = shelf.addSample([], { title: item.title, at: now, known: Boolean(item.known), fits: item.fits || [], ...(item.cc !== undefined ? { cc: item.cc } : {}) });
          row.cors = item.p.cors; row.bitrate = item.p.bitrate || row.bitrate;
          row.ok_count = 1; row.fail_streak = 0; row.status = 'active'; row.last_ok_at = now; row.last_checked_at = now;
        } else if (item.definite) {
          row.samples = []; row.ok_count = 0; row.fail_streak = 3; row.status = 'dead'; row.last_checked_at = now; // checked: skipped for a week
        } else return null; // slow or flaky: may be fine next time, forget it
      } else if (item.result === 'ok') {
        const wasDead = row.status === 'dead';
        row.samples = shelf.addSample(row.samples, { title: item.title, at: now, known: Boolean(item.known), fits: item.fits || [], ...(item.cc !== undefined ? { cc: item.cc } : {}) });
        row.cors = item.p.cors; row.bitrate = item.p.bitrate || row.bitrate;
        row.ok_count = (row.ok_count || 0) + 1; row.fail_streak = 0; row.status = 'active'; row.last_ok_at = now; row.last_checked_at = now;
        if (wasDead) bump('revived');
      } else if (item.result === 'neutral') {
        row.last_checked_at = now;
      } else { // failed
        const was = row.status;
        row.fail_streak = Math.min((row.fail_streak || 0) + 1, 10);
        if (row.fail_streak >= 3) { row.status = 'dead'; if (was === 'active') stats.now_dead++; }
        row.last_checked_at = now;
      }
      row.genres = row.status === 'active' ? shelf.qualifyGenres({ rawTags: row.rawTags || vet.splitTags(row.tags), name: row.name, samples: row.samples }) : [];
      row.local_ratio = shelf.localRatio(row.samples, row.country_code);
      row.tags = (row.rawTags || vet.splitTags(row.tags)).join(',');
      return Object.fromEntries(COLUMNS.map((c) => [c, row[c] === undefined ? null : row[c]]));
    }

    // Upserts in batches; returns the ids of rows the database refused.
    async function save(rows) {
      const refused = new Set();
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        try { await db.upsert('station_pool', batch); } catch (_) {
          // One bad row (say, a stream address already on file) mustn't lose the batch.
          bump('batch_retry');
          for (const r of batch) { try { await db.upsert('station_pool', [r]); } catch (__) { bump('row_refused'); refused.add(r.uuid); } }
        }
      }
      return refused;
    }

    async function pipeline(items, phaseEnd) {
      let pending = null;
      for (let i = 0; i < items.length && !stopped() && D.now() < phaseEnd; i += D.chunk) {
        const chunk = items.slice(i, i + D.chunk);
        const out = [];
        let n = 0;
        await Promise.all(Array.from({ length: Math.min(D.concurrency, chunk.length) }, async () => {
          while (n < chunk.length) out.push(await probeItem(chunk[n++]));
        }));
        const probed = out.filter((it) => !it.skipped);
        if (pending) await pending;
        pending = (async () => {
          try {
            stats.checked += probed.length;
            await lookups(probed);
            const prepared = probed.map((it) => ({ it, row: finalize(it) })).filter((x) => x.row);
            const refused = await save(prepared.map((x) => x.row));
            for (const { it, row } of prepared) if (it.isNew && row.status === 'active' && !refused.has(row.uuid)) stats.added++;
            await songCache.flush();
          } catch (e) { note(`chunk error: ${e.message}`); }
        })();
      }
      if (pending) await pending;
    }

    const now0 = iso(t0);
    const newItems = candidates.map((c) => ({
      isNew: true,
      row: { ...c, tags: null, first_seen_at: now0, last_checked_at: now0, last_ok_at: null, genres: [], samples: [], ok_count: 0, fail_streak: 0, status: 'active', local_ratio: null, cors: null },
    }));
    const oldItems = rechecks.map((r) => ({ isNew: false, row: { ...r, rawTags: vet.splitTags(r.tags) } }));
    // New stations get up to half the time left (all of it when nothing is due for a re-check).
    const newEnd = oldItems.length ? D.now() + Math.max(0, stopAt - D.now()) * D.newShare : stopAt;
    await pipeline(newItems, newEnd);
    await pipeline(oldItems, stopAt);

    note(`checked ${stats.checked} (${newItems.length} new candidates, ${oldItems.length} due for re-check); added ${stats.added}, now dead ${stats.now_dead}; iTunes lookups ${used.itunes}, MusicBrainz ${used.mb}`);
    const skipped = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ');
    if (skipped) note(skipped);
    if (stopped()) note(aborted ? 'stopped early (signal)' : 'stopped at the time budget');
  } catch (e) {
    note(`error: ${e.message}`);
  }

  // Wrap up: servable total, then the run's row.
  try {
    const st = await db.rpc('pool_stats', {});
    const all = (st || []).find((r) => r.key === '*');
    stats.active_total = all ? all.n : 0;
  } catch (_) { /* leave 0 */ }
  if (runId != null) {
    try {
      await db.patch(`/scout_runs?id=eq.${runId}`, { finished_at: iso(D.now()), discovered: stats.discovered, checked: stats.checked, added: stats.added, now_dead: stats.now_dead, active_total: stats.active_total, notes: notes.join(' | ').slice(0, 1500) });
    } catch (e) { log(`Couldn't save the run: ${e.message}`); }
  }
  process.removeListener('SIGTERM', onSignal);
  process.removeListener('SIGINT', onSignal);
  const secs = Math.round((D.now() - t0) / 1000);
  log(`Scout done in ${secs}s: discovered ${stats.discovered}, checked ${stats.checked}, added ${stats.added}, now dead ${stats.now_dead}, on the shelf now ${stats.active_total}.`);
  return { ...stats, seconds: secs, notes, counts };
}

async function main() {
  const env = serviceEnv();
  if (!env) {
    console.log('Scout skipped: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set (add them as repository secrets).');
    return;
  }
  try {
    await run({ db: makeDb(env, { timeoutMs: 20000 }) });
  } catch (e) {
    console.error(`Scout failed: ${e.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { run, makeSongCache, DEFAULTS };
