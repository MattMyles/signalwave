// Offline tests for the station shelf: Icecast parsing, stream addresses,
// genre qualification, serving from the shelf and the scout's run loop.
// Run by `npm test` (after scripts/test.js).
process.env.SW_ALLOW_PRIVATE = '1';
const assert = require('assert');

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  pass  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const shelf = require('../lib/shelf');
  const { cityAnywhere } = require('../lib/geo');

  console.log('Icecast directory');
  await t('parses entries, decodes entities, tolerates missing fields', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<directory>
<entry>
  <server_name>Rock &amp; Roll &quot;Berlin&quot; &#252;ber &#x41;ll</server_name>
  <listen_url>https://stream.example.com/rock.mp3</listen_url>
  <server_type>audio/mpeg</server_type>
  <bitrate>128</bitrate>
  <channels>2</channels>
  <genre>Rock, Classic Rock</genre>
  <current_song>Led Zeppelin - Kashmir</current_song>
</entry>
<entry>
  <server_name><![CDATA[Chill <FM>]]></server_name>
  <listen_url>http://chill.example.org:8000/live</listen_url>
</entry>
<entry><server_name>No address</server_name></entry>
</directory>`;
    const e = shelf.parseYp(xml);
    assert.strictEqual(e.length, 2);
    assert.deepStrictEqual(e[0], { name: 'Rock & Roll "Berlin" über All', url: 'https://stream.example.com/rock.mp3', type: 'audio/mpeg', bitrate: 128, genre: 'Rock, Classic Rock', song: 'Led Zeppelin - Kashmir' });
    assert.deepStrictEqual(e[1], { name: 'Chill <FM>', url: 'http://chill.example.org:8000/live', type: '', bitrate: null, genre: '', song: '' });
    assert.deepStrictEqual(shelf.parseYp(''), []);
    assert.deepStrictEqual(shelf.parseYp(null), []);
  });
  await t('genre text becomes phrase and word tags', () => {
    assert.deepStrictEqual(shelf.ypTags('Classic Rock, 80s'), ['classic rock', '80s', 'classic', 'rock']);
  });

  console.log('Stream addresses');
  await t('the same stream normalizes to one address', () => {
    const a = shelf.normalizeUrl('https://Radio.Example.com:443/Live/');
    for (const u of ['http://radio.example.com/Live', 'HTTP://RADIO.EXAMPLE.COM:80/Live/', 'https://radio.example.com/Live?x=1']) assert.strictEqual(shelf.normalizeUrl(u), a, u);
    assert.notStrictEqual(shelf.normalizeUrl('http://radio.example.com:8000/Live'), a);
    assert.notStrictEqual(shelf.normalizeUrl('https://radio.example.com/live'), a); // paths are case-sensitive
    assert.strictEqual(shelf.normalizeUrl('ftp://x/y'), '');
    assert.strictEqual(shelf.normalizeUrl('nonsense'), '');
  });
  await t('Icecast ids are deterministic, UUID-shaped, version 5, and tell themselves apart', () => {
    const id = shelf.icecastId('https://stream.example.com/rock.mp3');
    assert(UUID.test(id), id);
    assert.strictEqual(id[14], '5');
    assert(/[89ab]/.test(id[19]));
    assert.strictEqual(shelf.icecastId('http://STREAM.example.com/rock.mp3/'), id);
    assert.notStrictEqual(shelf.icecastId('https://stream.example.com/other.mp3'), id);
    assert(shelf.isIcecastId(id));
    assert(!shelf.isIcecastId('96062f4b-0601-11e8-ae97-52543be04c81')); // a directory id (version 1)
    assert(!shelf.isIcecastId('9a1f8e51-3c4d-4f7e-8a2b-5c6d7e8f9a0b')); // random version 4
  });

  console.log('Cities without a country');
  await t('a big city with a unique name is found', () => {
    const at = (x) => (cityAnywhere(x) || {}).city || null;
    assert.strictEqual(at('Radio Lagos 90.1'), 'Lagos');
    assert.strictEqual(at('Berlin Techno Bunker'), 'Berlin');
    assert.strictEqual(at('Mexico City Synth'), 'Mexico City');
    assert.strictEqual(cityAnywhere('Tokyo Jazz Lounge').countryCode, 'JP');
  });
  await t('ambiguous names, ordinary words and part-words are not', () => {
    for (const x of ['Radio Valencia', 'San Jose FM', 'Cordoba Rock', 'Nice Music Only', 'Paradise FM', 'Phoenix Rising', 'Love Radio', 'Berlinale', 'Unterberlin', '', null]) assert.strictEqual(cityAnywhere(x), null, String(x));
  });

  console.log('Genre qualification');
  const sample = (fits, known = true) => ({ title: 'A - B', at: 'x', known, fits });
  const q = (rawTags, samples, name = 'Station') => shelf.qualifyGenres({ rawTags, name, samples });
  await t('(a) songs alone qualify: 3+ identified songs, 60%+ fitting', () => {
    assert(q(['hits', 'pop'], [sample(['jazz']), sample(['jazz']), sample(['pop'])]).includes('jazz')); // 2 of 3 = 67%
    assert(!q(['hits', 'pop'], [sample(['jazz']), sample(['pop']), sample(['pop'])]).includes('jazz')); // 1 of 3
    assert(!q(['hits'], [sample(['jazz']), sample(['jazz'])]).includes('jazz')); // only 2 identified
    assert(q(['hits'], [sample(['jazz']), sample(['jazz']), sample(['jazz']), sample([], false), sample([], false)]).includes('jazz')); // unknown songs don't count against it
  });
  await t('(b) tags qualify with few identified songs, or half of them fitting', () => {
    assert(q(['jazz'], []).includes('jazz'));
    assert(q(['jazz'], [sample(['rock'])]).includes('jazz')); // 1 identified: tags decide
    assert(!q(['jazz'], [sample(['rock']), sample(['rock'])]).includes('jazz')); // 2 identified, none fit
    assert(q(['jazz'], [sample(['jazz']), sample(['rock'])]).includes('jazz')); // 50%
    assert(!q(['jazz'], [sample(['jazz']), sample(['rock']), sample(['rock'])]).includes('jazz')); // 33%
  });
  await t('an untagged-for-it genre is not qualified by tags it lacks', () => {
    assert(!q(['jazz'], []).includes('rock'));
    assert(!q(['pop', 'dance', 'hits', 'rock', 'jazz', 'classical'], []).includes('rock')); // variety station: focus check fails
  });
  await t('World qualifies from tags alone, whatever the songs', () => {
    const keys = q(['world music', 'celtic'], [sample(['rock']), sample(['rock']), sample(['rock'])]);
    assert(keys.includes('world') && keys.includes('tag:celtic'));
    assert(!q(['jazz'], []).includes('world'));
  });
  await t('era styles follow the songs\' release years', () => {
    const a = { title: 'Led Zeppelin - Kashmir', known: true };
    const songs = require('../lib/songcheck');
    const old = songs.fitKeys({ genres: ['rock'], year: 1975 }), recent = songs.fitKeys({ genres: ['rock'], year: 2013 });
    assert(old.includes('tag:classic rock') && recent.includes('rock') && !recent.includes('tag:classic rock'));
    const classic = q(['rock'], [1, 2, 3].map(() => ({ ...a, fits: old })));
    assert(classic.includes('rock') && classic.includes('tag:classic rock'));
    const modern = q(['rock'], [1, 2, 3].map(() => ({ ...a, fits: recent })));
    assert(modern.includes('rock') && !modern.includes('tag:classic rock'));
  });
  await t('foreign tags count, and keys are all real genre keys', () => {
    const keys = q(['ロック', '邦楽'], []);
    assert(keys.includes('rock'));
    const { ALL_KEYS } = require('../lib/songcheck');
    for (const k of q(['rock', 'classic rock', 'world music'], [])) assert(ALL_KEYS.includes(k), k);
  });
  await t('local ratio and sample bookkeeping', () => {
    assert.strictEqual(shelf.localRatio([{ cc: 'JP' }, { cc: 'GB' }, { cc: 'JP' }, {}, { cc: null }], 'jp'), 2 / 3);
    assert.strictEqual(shelf.localRatio([{}, { cc: null }], 'JP'), null);
    let s = [];
    for (let i = 0; i < 12; i++) s = shelf.addSample(s, { title: `Artist - Song ${i}`, at: String(i), known: false, fits: [] });
    assert.strictEqual(s.length, 10); assert.strictEqual(s[0].title, 'Artist - Song 2');
    s = shelf.addSample(s, { title: 'Artist - Song 9', at: 'later', known: false, fits: [] });
    assert.strictEqual(s.length, 10); assert.strictEqual(s.find((x) => x.title === 'Artist - Song 9').at, 'later');
  });

  console.log('Song lookups with an injected cache');
  {
    const songs = require('../lib/songcheck');
    const realFetch = global.fetch;
    let requests = 0;
    global.fetch = async () => { requests++; return { ok: true, json: async () => ({ results: [{ artistName: 'Cache Test Band', trackName: 'Cache Test Song', primaryGenreName: 'Jazz', releaseDate: '1999-01-01' }] }) }; };
    const store = new Map(); const sets = [];
    const cache = { get: (k) => store.get(k), set: (k, v) => { store.set(k, v); sets.push(k); } };
    await t('a spent budget asks nobody and caches nothing', async () => {
      const r = await songs.songInfo('Cache Test Band - Cache Test Song', { cache, gate: async () => false });
      assert.strictEqual(r.known, false); assert.strictEqual(requests, 0); assert.strictEqual(sets.length, 0);
    });
    await t('a lookup is asked once, cached, and gives every genre it fits', async () => {
      const r = await songs.songInfo('Cache Test Band - Cache Test Song', { cache, gate: async () => true });
      assert.strictEqual(r.known, true); assert.strictEqual(requests, 1); assert.deepStrictEqual(sets, ['cache test band - cache test song']);
      const keys = songs.fitKeys(r.info);
      assert(keys.includes('jazz') && keys.includes('tag:bebop') && !keys.includes('rock') && !keys.includes('world'));
    });
    await t('the persistent cache answers before iTunes', async () => {
      store.set('persisted band - persisted song', { genres: ['rock'], year: 1970 });
      const r = await songs.songInfo('Persisted Band - Persisted Song', { cache, gate: async () => { throw new Error('should not ask'); } });
      assert.strictEqual(r.known, true); assert.strictEqual(requests, 1);
    });
    await t('songs in other scripts are looked up too (see scripts/test-genres.js), but a title with nothing to match on is not', async () => {
      const r = await songs.songInfo('!!! - ???', { cache, gate: async () => true });
      assert.strictEqual(r.known, false); assert.strictEqual(requests, 1);
    });
    global.fetch = realFetch;
  }

  console.log('Serving from the shelf');
  const { poolNext, poolLookup, resetPool, takeWeighted } = require('../lib/pool');
  const { resolveGenre, resolveGenres } = require('../lib/vet');
  const savedEnv = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://shelf-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const realFetch = global.fetch;
  const row = (over = {}) => ({
    uuid: 'a0000000-0000-4000-8000-000000000001', source: 'radiobrowser', name: 'Tokyo Classic FM', url: 'https://stream.test/a', homepage: null, favicon: 'https://x/f.png',
    tags: 'classic rock,70s', country: 'Japan', country_code: 'JP', city: 'Tokyo', lat: 35.7, lng: 139.7, codec: 'MP3', bitrate: 128, cors: false,
    genres: ['rock', 'tag:classic rock'], samples: [{ title: 'Old - Song', at: '2026-11-01T00:00:00Z' }, { title: 'The Pillows - Funny Bunny', at: '2026-11-02T00:00:00Z' }],
    local_ratio: 0.8, ok_count: 3, fail_streak: 0, status: 'active', ...over,
  });
  let calls;
  function mockShelf(handler) {
    calls = [];
    global.fetch = async (url, init = {}) => {
      const u = String(url);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: u, body });
      if (u.includes('/genre_reports')) return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
      const r = await handler(u, body);
      return { ok: r.status === undefined || r.status < 400, status: r.status || 200, json: async () => r.json, text: async () => JSON.stringify(r.json === undefined ? null : r.json) };
    };
  }
  const okProbe = async () => ({ ok: true, bitrate: 192, cors: true });

  await t('no Supabase settings: null, no requests', async () => {
    mockShelf(() => ({ json: [] }));
    assert.strictEqual(await poolNext(null, new Set(), [], { env: null, probe: okProbe }), null);
    assert.strictEqual(calls.length, 0);
  });
  await t('shelf not set up (function missing): null, and not asked again for a while', async () => {
    resetPool();
    mockShelf(() => ({ status: 404, json: { code: 'PGRST202', message: 'Could not find the function public.pool_candidates in the schema cache' } }));
    assert.strictEqual(await poolNext(null, new Set(), [], { probe: okProbe }), null);
    const first = calls.filter((c) => c.url.includes('pool_candidates')).length;
    assert(first >= 1);
    assert.strictEqual(await poolNext(null, new Set(), [], { probe: okProbe }), null);
    assert.strictEqual(calls.filter((c) => c.url.includes('pool_candidates')).length, first);
    resetPool();
  });
  await t('a failing Supabase gives null quietly', async () => {
    resetPool();
    mockShelf(() => ({ status: 500, json: { message: 'boom' } }));
    assert.strictEqual(await poolNext(null, new Set(), [], { probe: okProbe }), null);
    resetPool();
  });
  await t('an empty shelf for the pick gives null (live vetting takes over)', async () => {
    resetPool();
    mockShelf(() => ({ json: [] }));
    assert.strictEqual(await poolNext(resolveGenre(null, 'doom metal'), new Set(), [], { probe: okProbe }), null);
  });
  await t('returns the station in the live shape, asking for the pick\'s genre keys and leaving out heard stations', async () => {
    resetPool();
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [row()] } : { json: null }));
    const spec = resolveGenres('rock,tag:classic rock');
    const s = await poolNext(spec, new Set(['heard-1', 'heard-2']), ['US'], { probe: okProbe });
    const ask = calls.find((c) => c.url.includes('pool_candidates')).body;
    assert.deepStrictEqual(ask.p_keys.sort(), ['rock', 'tag:classic rock']);
    assert(ask.p_exclude.includes('heard-1') && ask.p_exclude.includes('heard-2')); assert.strictEqual(ask.p_limit, 60);
    assert.deepStrictEqual(Object.keys(s).sort(), ['bitrate', 'city', 'codec', 'cors', 'country', 'countryCode', 'favicon', 'genre', 'homepage', 'lat', 'lng', 'localArtist', 'name', 'region', 'source', 'tags', 'title', 'url', 'uuid'].sort());
    assert.strictEqual(s.uuid, row().uuid); assert.strictEqual(s.title, 'The Pillows - Funny Bunny'); // the latest sample
    assert.strictEqual(s.localArtist, true); assert.strictEqual(s.countryCode, 'JP'); assert.strictEqual(s.bitrate, 192); assert.strictEqual(s.cors, true);
    assert(Array.isArray(s.tags) && s.tags.includes('classic rock')); assert.strictEqual(s.genre, 'classic rock');
    assert(require('../lib/vet').knownStreamUrl(s.uuid) === 'https://stream.test/a');
  });
  await t('any genre asks with no keys; reported stations are excluded too', async () => {
    resetPool();
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [row()] } : { json: null }));
    await poolNext(null, new Set(['x']), [], { probe: okProbe });
    assert.deepStrictEqual(calls.find((c) => c.url.includes('pool_candidates')).body.p_keys, []);
  });
  await t('regions just heard are avoided when others have stations; then it looks anywhere', async () => {
    resetPool();
    const { REGIONS } = require('../lib/config');
    mockShelf((u, b) => (u.includes('pool_candidates') ? { json: b.p_countries ? [] : [row()] } : { json: null }));
    const s = await poolNext(null, new Set(), ['US', 'DE'], { probe: okProbe });
    assert(s);
    const asked = calls.filter((c) => c.url.includes('pool_candidates')).map((c) => c.body.p_countries);
    assert.strictEqual(asked.length, 4); assert.strictEqual(asked[3], null);
    for (const list of asked.slice(0, 3)) { assert(!list.includes('US') && !list.includes('DE')); assert(Object.values(REGIONS).some((r) => r.join() === list.join())); }
    assert.strictEqual(new Set(asked.slice(0, 3).map((l) => l.join())).size, 3);
  });
  await t('a station that is offline is marked and the next one is tried', async () => {
    resetPool();
    const rows = [row({ uuid: 'a0000000-0000-4000-8000-00000000000a', url: 'https://dead.test/a' }), row({ uuid: 'a0000000-0000-4000-8000-00000000000b', url: 'https://live.test/b', city: 'Osaka' })];
    mockShelf((u) => (u.includes('pool_candidates') ? { json: rows } : { json: null }));
    const probe = async (url) => (url.includes('dead') ? { ok: false, reason: 'slow' } : { ok: true });
    const rand = Math.random; Math.random = () => 0; // the first row is tried first
    let s;
    try { s = await poolNext(null, new Set(), [], { probe }); } finally { Math.random = rand; }
    assert.strictEqual(s.url, 'https://live.test/b');
    const marks = calls.filter((c) => c.url.includes('pool_mark_fail'));
    assert.strictEqual(marks.length, 1); assert.strictEqual(marks[0].body.p_uuid, 'a0000000-0000-4000-8000-00000000000a');
  });
  await t('nine offline stations in a row: null, all nine marked (the rest are never tried)', async () => {
    resetPool();
    const rows = Array.from({ length: 12 }, (_, i) => row({ uuid: `a0000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, url: `https://dead.test/${i}` }));
    mockShelf((u) => (u.includes('pool_candidates') ? { json: rows } : { json: null }));
    assert.strictEqual(await poolNext(null, new Set(), [], { probe: async () => ({ ok: false }) }), null);
    assert.strictEqual(calls.filter((c) => c.url.includes('pool_mark_fail')).length, 9);
  });

  console.log('Song check before serving');
  {
    const spec = resolveGenre(null, 'classic rock');
    const A = 'a0000000-0000-4000-8000-0000000002', id = (n) => `${A}0${n}`;
    const rows = ['a', 'b', 'c', 'd'].map((n, i) => row({ uuid: id(i), url: `https://song.test/${n}`, city: 'Osaka' }));
    const first = async (probe, extra = {}, sp = spec) => {
      resetPool();
      mockShelf((u) => (u.includes('pool_candidates') ? { json: rows } : { json: null }));
      const rand = Math.random; Math.random = () => 0; // weighted order = row order
      try { return await poolNext(sp, new Set(), [], { probe, ...extra }); } finally { Math.random = rand; }
    };
    const seen = [];
    const titled = (titles) => async (url, o) => { seen.push({ url, o }); return { ok: true, bitrate: 128, title: titles[url.slice(-1)] || null }; };
    const stub = (answers) => async (title) => (title in answers ? answers[title] : null);
    const marks = () => calls.filter((c) => c.url.includes('pool_mark_fail'));

    await t('with a genre picked, streams are probed for their song title (no skipMeta)', async () => {
      seen.length = 0;
      await first(titled({ a: 'X - One' }), { songFits: stub({}) });
      assert(seen.length >= 1 && seen.every((x) => x.o.skipMeta !== true && x.o.totalMs === 4000 && x.o.firstByteMs === 2500), JSON.stringify(seen.map((x) => x.o)));
    });
    await t('a station playing a clear mismatch is skipped, without being marked offline', async () => {
      const s = await first(titled({ a: 'Pop - Bad', b: 'Rock - Good' }), { songFits: stub({ 'Pop - Bad': false, 'Rock - Good': true }) });
      assert.strictEqual(s.uuid, id(1)); assert.strictEqual(s.title, 'Rock - Good');
      assert.strictEqual(marks().length, 0);
    });
    await t('an unknown song (null) passes, and the first in weighted order wins even when later ones also fit', async () => {
      const s = await first(titled({ a: 'Local Band - Obscure', b: 'Rock - Good' }), { songFits: stub({ 'Rock - Good': true }) });
      assert.strictEqual(s.uuid, id(0)); assert.strictEqual(s.title, 'Local Band - Obscure');
    });
    await t('a station with no song title passes (no judgement possible)', async () => {
      const s = await first(titled({}), { songFits: stub({}) });
      assert.strictEqual(s.uuid, id(0)); assert.strictEqual(s.title, 'The Pillows - Funny Bunny'); // falls back to the shelf's latest sample
    });
    await t('a mismatch and a dead stream in one batch: the dead one is marked, the next batch supplies the winner', async () => {
      const probe = async (url) => (url.endsWith('a') ? { ok: false } : { ok: true, title: url.endsWith('d') ? 'Rock - Good' : `Pop - Bad ${url.slice(-1)}` });
      const s = await first(probe, { songFits: async (t) => t === 'Rock - Good' });
      assert.strictEqual(s.uuid, id(3));
      assert.deepStrictEqual(marks().map((c) => c.body.p_uuid), [id(0)]);
    });
    await t('every station mismatching gives null (live vetting takes over) and marks nothing', async () => {
      const s = await first(titled({ a: 'P - 1', b: 'P - 2', c: 'P - 3', d: 'P - 4' }), { songFits: async () => false });
      assert.strictEqual(s, null); assert.strictEqual(marks().length, 0);
    });
    await t('a song check that throws counts as unknown', async () => {
      const s = await first(titled({ a: 'A - B' }), { songFits: async () => { throw new Error('boom'); } });
      assert.strictEqual(s.uuid, id(0));
    });
    await t('no genre picked: songs are never checked, probing stays quick', async () => {
      seen.length = 0; let judged = 0;
      const s = await first(titled({ a: 'Pop - Bad' }), { songFits: async () => { judged++; return false; } }, null);
      assert.strictEqual(judged, 0); assert.strictEqual(s.uuid, id(0));
      assert(seen.every((x) => x.o.skipMeta === true));
    });
    await t('the real song check runs against the persistent cache (a known song costs no iTunes lookup)', async () => {
      const real = global.fetch; let itunes = 0;
      resetPool();
      mockShelf((u) => {
        if (u.includes('pool_candidates')) return { json: rows.slice(0, 2) };
        if (u.includes('/song_lookups?')) return { json: [{ key: 'madonna - holiday', genre: 'pop', year: 1983, found: true, looked_at: '2026-11-01T00:00:00Z' }, { key: 'led zeppelin - kashmir', genre: 'rock', year: 1975, found: true, looked_at: '2026-11-01T00:00:00Z' }] };
        return { json: null };
      });
      const wrapped = global.fetch;
      global.fetch = async (u, i) => { if (String(u).includes('itunes.apple.com')) { itunes++; throw new Error('offline'); } return wrapped(u, i); };
      const rand = Math.random; Math.random = () => 0;
      let s;
      try { s = await poolNext(spec, new Set(), [], { probe: titled({ a: 'Madonna - Holiday', b: 'Led Zeppelin - Kashmir' }) }); } finally { Math.random = rand; global.fetch = real; }
      assert.strictEqual(s.uuid, id(1)); assert.strictEqual(itunes, 0);
      assert.strictEqual(marks().length, 0);
    });
  }

  await t('picks lean to local-artist stations but others still come up', () => {
    const n = { local: 0, mixed: 0, foreign: 0, unknown: 0 };
    for (let i = 0; i < 4000; i++) {
      const pool = [{ k: 'local', local_ratio: 1 }, { k: 'mixed', local_ratio: 0.5 }, { k: 'foreign', local_ratio: 0 }, { k: 'unknown', local_ratio: null }];
      n[takeWeighted(pool).k]++;
    }
    assert(n.local > n.mixed && n.mixed > n.foreign, JSON.stringify(n));
    assert(n.unknown > n.foreign && n.foreign > 300, JSON.stringify(n));
  });
  await t('stations with no known city are served at country level (city null, region kept) and are picked a bit less often', async () => {
    resetPool();
    const noCity = row({ name: 'Indiana FM', city: null, region: 'Indiana', country: 'United States', country_code: 'US', lat: 38.8, lng: -93 });
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [noCity] } : { json: null }));
    const s = await poolNext(null, new Set(), [], { probe: okProbe });
    assert.strictEqual(s.city, null); assert.strictEqual(s.region, 'Indiana'); assert.strictEqual(s.country, 'United States'); assert.strictEqual(s.countryCode, 'US');
    // An older row (no region column at all) and a city row never show a region.
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [row({ city: null })] } : { json: null }));
    assert.strictEqual((await poolNext(null, new Set(), [], { probe: okProbe })).region, null);
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [row({ region: 'Kanto' })] } : { json: null }));
    const withCity = await poolNext(null, new Set(), [], { probe: okProbe });
    assert.strictEqual(withCity.city, 'Tokyo'); assert.strictEqual(withCity.region, null);
    // Weights: the same local ratio, a city vs no city is 1 : 0.6.
    const { weightOf, NO_CITY_WEIGHT } = require('../lib/pool');
    assert.strictEqual(NO_CITY_WEIGHT, 0.6);
    for (const ratio of [null, 0, 0.5, 1]) assert(Math.abs(weightOf({ local_ratio: ratio, city: null }) - 0.6 * weightOf({ local_ratio: ratio, city: 'Tokyo' })) < 1e-9, String(ratio));
    const n = { city: 0, none: 0 };
    for (let i = 0; i < 6000; i++) { const list = [{ k: 'city', city: 'Tokyo', local_ratio: 0.5 }, { k: 'none', city: null, local_ratio: 0.5 }]; n[takeWeighted(list).k]++; }
    assert(n.city > n.none && n.none > 1800, JSON.stringify(n)); // about 62.5% / 37.5%
    assert(Math.abs(n.none / 6000 - 0.375) < 0.04, JSON.stringify(n));
  });
  await t('localArtist: 0.5+ yes, 0.2 or less no, between and unknown null', async () => {
    resetPool();
    const out = [];
    for (const r of [0.5, 0.2, 0.35, null]) {
      mockShelf((u) => (u.includes('pool_candidates') ? { json: [row({ local_ratio: r })] } : { json: null }));
      out.push((await poolNext(null, new Set(), [], { probe: okProbe })).localArtist);
    }
    assert.deepStrictEqual(out, [true, false, null, null]);
  });
  await t('poolLookup finds one station by id, and answers null when it cannot', async () => {
    resetPool();
    mockShelf((u) => ({ json: u.includes('station_pool?uuid=eq.') ? [row()] : [] }));
    assert.strictEqual((await poolLookup(row().uuid)).name, 'Tokyo Classic FM');
    assert.strictEqual(await poolLookup(row().uuid, { env: null }), null);
    mockShelf(() => ({ status: 500, json: {} }));
    assert.strictEqual(await poolLookup(row().uuid), null);
    resetPool();
  });

  console.log('Quick liveness check');
  {
    const http = require('http');
    const { probeStream } = require('../lib/icy');
    const srv = http.createServer((req, res) => {
      if (req.url === '/slow') return void setTimeout(() => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(10)); }, 1500);
      // Metadata every 4096 bytes, but the second block of audio arrives late: a full probe would wait for it.
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '4096', 'icy-br': '96' });
      res.write(Buffer.alloc(100, 0xff));
      setTimeout(() => res.end(Buffer.alloc(5000, 0xff)), 1200);
    }).listen(0);
    const base = `http://127.0.0.1:${srv.address().port}`;
    await t('skipMeta answers as soon as audio flows, without a title', async () => {
      const t0 = Date.now();
      const p = await probeStream(`${base}/live`, { skipMeta: true, firstByteMs: 2500, totalMs: 3500 });
      assert(p.ok && p.title === null && p.bitrate === 96, JSON.stringify(p)); assert(Date.now() - t0 < 800, `${Date.now() - t0} ms`);
    });
    await t('the first-byte limit can be tightened per call', async () => {
      const p = await probeStream(`${base}/slow`, { firstByteMs: 400, totalMs: 1000, skipMeta: true });
      assert(!p.ok && p.reason === 'slow', JSON.stringify(p));
    });
    srv.close();
  }

  console.log('/api/next');
  {
    const Module = require('module');
    const path = require('path');
    const real = { vet: require('../lib/vet'), pool: require('../lib/pool'), radio: require('../lib/radio') };
    const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports, children: [], paths: [] }; };
    async function ask(poolResult, liveResult) {
      const clicks = [];
      stub('../lib/vet', { ...real.vet, nextStation: async () => liveResult });
      stub('../lib/pool', { ...real.pool, poolNext: async () => { if (poolResult instanceof Error) throw poolResult; return poolResult; } });
      stub('../lib/radio', { ...real.radio, reportClick: (u) => clicks.push(u) });
      delete require.cache[require.resolve('../api/next')];
      const handler = require('../api/next');
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
      await handler({ url: '/api/next?genres=rock', method: 'GET', headers: {} }, res);
      for (const f of ['../lib/vet', '../lib/pool', '../lib/radio']) delete require.cache[require.resolve(f)];
      delete require.cache[require.resolve('../api/next')];
      return { res, clicks };
    }
    await t('the shelf answers first and its bookkeeping field is not sent on', async () => {
      const { res, clicks } = await ask({ uuid: 'u1', name: 'Shelf', source: 'radiobrowser' }, { uuid: 'live', name: 'Live' });
      assert.strictEqual(res.statusCode, 200); assert.strictEqual(res.body.station.uuid, 'u1'); assert(!('source' in res.body.station)); assert.deepStrictEqual(clicks, ['u1']);
    });
    await t('Icecast-only stations are not reported to Radio Browser', async () => {
      const { res, clicks } = await ask({ uuid: 'u2', name: 'Ice', source: 'icecast' }, null);
      assert.strictEqual(res.body.station.uuid, 'u2'); assert.deepStrictEqual(clicks, []);
    });
    await t('an empty or broken shelf falls back to live vetting', async () => {
      for (const p of [null, new Error('boom')]) {
        const { res } = await ask(p, { uuid: 'live', name: 'Live', vettedAt: 1 });
        assert.strictEqual(res.statusCode, 200); assert.strictEqual(res.body.station.uuid, 'live'); assert(!('vettedAt' in res.body.station));
      }
    });
    await t('nothing anywhere still answers 503', async () => {
      const { res } = await ask(null, null);
      assert.strictEqual(res.statusCode, 503);
    });
    void Module; void path;
  }
  global.fetch = realFetch;

  console.log('/api/nowplaying with genres');
  {
    const http = require('http');
    const { rememberStream } = require('../lib/vet');
    const meta = (title) => { const text = `StreamTitle='${title}';`; const n = Math.ceil(text.length / 16); return Buffer.concat([Buffer.from([n]), Buffer.from(text.padEnd(n * 16, '\0'))]); };
    const srv = http.createServer((req, res) => {
      const title = decodeURIComponent(req.url.slice(1));
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '16' });
      res.write(Buffer.concat([Buffer.alloc(16, 0xff), title ? meta(title) : Buffer.from([0]), Buffer.alloc(64, 0xff)]));
    }).listen(0);
    const base = `http://127.0.0.1:${srv.address().port}`;
    const real = global.fetch;
    let certRows = []; // certified_stations, for the certified test below
    global.fetch = async (u) => { // Apple's catalog, and a song cache that is down
      if (String(u).includes('/certified_stations')) return { ok: true, status: 200, json: async () => certRows, text: async () => JSON.stringify(certRows) };
      if (String(u).includes('itunes.apple.com')) {
        const term = new URL(u).searchParams.get('term');
        const hit = /Holiday/.test(term) ? [{ artistName: 'Madonna', trackName: 'Holiday', primaryGenreName: 'Pop', releaseDate: '1983-09-07T00:00:00Z' }] : [];
        return { ok: true, status: 200, json: async () => ({ results: hit }) };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const ask = async (n, qs) => {
      const handler = require('../api/nowplaying');
      const uuid = `b0000000-0000-4000-8000-00000000030${n}`;
      const path = ['/Madonna%20-%20Holiday', '/Nobody%20Known%20-%20Nothing', '/'][n];
      rememberStream(uuid, `${base}${path}`);
      const res = { headers: {}, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
      await handler({ url: `/api/nowplaying?uuid=${uuid}${qs}`, method: 'GET', headers: {} }, res);
      return res.body;
    };
    await t('without genres the answer is just { ok, title }', async () => {
      assert.deepStrictEqual(await ask(0, ''), { ok: true, title: 'Madonna - Holiday' });
    });
    await t('with genres it says whether the song fits: false for a clear mismatch, true for a match', async () => {
      const bad = await ask(0, '&genres=tag:classic%20rock');
      assert.strictEqual(bad.ok, true); assert.strictEqual(bad.title, 'Madonna - Holiday'); assert.strictEqual(bad.fits, false);
      assert.strictEqual((await ask(0, '&genres=rock,pop')).fits, true);
    });
    await t('a station certified for a picked genre is never dropped by the song check (the admin\'s judgment wins)', async () => {
      const { resetCertified } = require('../lib/certified');
      const uuid = 'b0000000-0000-4000-8000-000000000300'; // plays Madonna - Holiday: Apple says Pop, so Classic Rock is a clear mismatch
      assert.strictEqual((await ask(0, '&genres=tag:classic%20rock')).fits, false);
      certRows = [{ uuid, genre_key: 'tag:classic rock', station: { uuid, name: 'Certified FM', url: `${base}/Madonna%20-%20Holiday`, lat: 1, lng: 2 }, certified_by: 'admin@example.com', certified_at: '2026-11-18T00:00:00Z' }];
      resetCertified();
      const ok = await ask(0, '&genres=tag:classic%20rock');
      assert.strictEqual(ok.fits, true); assert.strictEqual(ok.certified, true); assert.strictEqual(ok.title, 'Madonna - Holiday');
      assert.strictEqual((await ask(0, '&genres=jazz')).fits, false); // certified for a different genre than the pick: judged as usual
      assert.strictEqual((await ask(0, '&genres=jazz,tag:classic%20rock')).fits, true); // any picked key counts
      certRows = []; resetCertified();
    });
    await t('with genres, a song Apple does not know or no title gives fits null', async () => {
      assert.strictEqual((await ask(1, '&genres=rock')).fits, null);
      const none = await ask(2, '&genres=rock');
      assert.strictEqual(none.ok, true); assert.strictEqual(none.title, null); assert.strictEqual(none.fits, null);
    });
    await t('with genres, a dead stream gives ok false and fits null', async () => {
      const uuid = 'b0000000-0000-4000-8000-000000000399';
      rememberStream(uuid, 'http://127.0.0.1:1/none');
      const handler = require('../api/nowplaying');
      const res = { headers: {}, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
      await handler({ url: `/api/nowplaying?uuid=${uuid}&genres=rock`, method: 'GET', headers: {} }, res);
      assert.strictEqual(res.body.ok, false); assert.strictEqual(res.body.fits, null);
    });
    global.fetch = real;
    srv.close();
  }

  console.log("A station's own history, and what we record");
  {
    const H = require('../lib/stationhistory');
    const { noteSong, storedSongs, resetSongLog } = require('../lib/songlog');
    const T = 1700000000;
    await t('SHOUTcast JSON: titles and times; HTML: titles only; junk: nothing', () => {
      const j = JSON.stringify([{ playedat: T + 300, title: 'Madonna - Holiday', metadata: {} }, { playedat: String(T + 100), title: 'Queen - Radio Ga Ga' }]);
      assert.deepStrictEqual(H.parseShoutcastJson(j), [{ title: 'Madonna - Holiday', at: (T + 300) * 1000 }, { title: 'Queen - Radio Ga Ga', at: (T + 100) * 1000 }]);
      const html = '<table><tr><td><b>Current Song</b></td><td>x</td></tr><tr><td>10:15:02</td><td>Artist &amp; Co - Song &#39;One&#39;</td></tr><tr><td>10:11:40</td><td><a href="/x">Other - Two</a></td></tr></table>';
      assert.deepStrictEqual(H.parseShoutcastHtml(html), [{ title: "Artist & Co - Song 'One'", at: null }, { title: 'Other - Two', at: null }]);
      for (const junk of ['', 'not json', '{}', '[]', '<html></html>', 'null', '[1,2,{"a":1}]']) { assert.deepStrictEqual(H.parseShoutcastJson(junk), [], junk); assert.deepStrictEqual(H.parseShoutcastHtml(junk), [], junk); }
    });
    await t('AzuraCast: song_history with text or artist and title; the answer may be a list', () => {
      const entry = { station: { name: 'X' }, now_playing: { song: { text: 'Now - Playing' } }, song_history: [
        { sh_id: 2, played_at: T + 200, song: { id: 'a', text: 'Band - Tune', artist: 'Band', title: 'Tune' } },
        { sh_id: 1, played_at: T + 50, song: { artist: 'Solo', title: 'Piece' } }] };
      const want = [{ title: 'Band - Tune', at: (T + 200) * 1000 }, { title: 'Solo - Piece', at: (T + 50) * 1000 }];
      assert.deepStrictEqual(H.parseAzuraCast(JSON.stringify(entry)), want);
      assert.deepStrictEqual(H.parseAzuraCast(JSON.stringify([entry])), want);
      assert.deepStrictEqual(H.parseAzuraCast(JSON.stringify({ song_history: [] })), []);
      assert.deepStrictEqual(H.parseAzuraCast('<html>'), []);
    });
    await t('Centova Cast: a plain list, a {data} wrapper and nested track objects', () => {
      assert.deepStrictEqual(H.parseCentova(JSON.stringify([{ title: 'A - B', artist: 'A', song: 'B', date: T }])), [{ title: 'A - B', at: T * 1000 }]);
      assert.deepStrictEqual(H.parseCentova(JSON.stringify([{ artist: 'A', song: 'B' }])), [{ title: 'A - B', at: null }]);
      assert.deepStrictEqual(H.parseCentova(JSON.stringify({ type: 'result', data: [{ track: { artist: 'X', title: 'Y' }, date: T }] })), [{ title: 'X - Y', at: T * 1000 }]);
      assert.deepStrictEqual(H.parseCentova(JSON.stringify({ type: 'error', message: 'nope' })), []);
    });
    await t('which pages are tried: https only, by the stream address', () => {
      assert.deepStrictEqual(H.candidates('http://radio.test/stream'), []);
      assert.deepStrictEqual(H.candidates('nonsense'), []);
      const urls = (u) => H.candidates(u).map((c) => c.url);
      assert.deepStrictEqual(urls('https://radio.test:8443/stream'), ['https://radio.test:8443/played?sid=1&type=json', 'https://radio.test:8443/played.html?sid=1']);
      assert.strictEqual(urls('https://az.test/listen/my_station/radio.mp3')[0], 'https://az.test/api/nowplaying/my_station');
      const c = urls('https://cast6.my-control-panel.com/proxy/magiccityradio/stream');
      assert.deepStrictEqual(c.slice(0, 2), ['https://cast6.my-control-panel.com/recentfeed/magiccityradio/json', 'https://cast6.my-control-panel.com/external/rpc.php?m=recenttracks.get&username=magiccityradio']);
      assert(!urls('https://x.test/proxy/a%2Fb/stream').some((x) => x.includes('/recentfeed/'))); // odd names are not passed on
    });
    await t('the first page in order that yields songs wins; failures and unknown formats give nothing', async () => {
      const asked = [];
      const get = async (url) => { asked.push(url); if (url.includes('/recentfeed/')) throw new Error('http-404'); if (url.includes('recenttracks')) return JSON.stringify({ data: [{ track: { artist: 'A', title: 'Old' }, date: T }, { track: { artist: 'B', title: 'New' }, date: T + 60 }] }); return JSON.stringify([{ title: 'Late - Shoutcast', playedat: T }]); };
      const r = await H.serverHistory('https://cast.test/proxy/user1/stream', { get });
      assert.deepStrictEqual(r.map((x) => x.title), ['B - New', 'A - Old']); // newest first
      assert.strictEqual(asked.length, 4);
      assert.deepStrictEqual(await H.serverHistory('https://cast.test/stream', { get: async () => '<html>nothing</html>' }), []);
      assert.deepStrictEqual(await H.serverHistory('http://cast.test/stream', { get }), []);
    });
    await t('private addresses are refused (no way to reach internal services)', async () => {
      const prev = process.env.SW_ALLOW_PRIVATE; process.env.SW_ALLOW_PRIVATE = '';
      try {
        for (const u of ['https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5:8443/played', 'https://[::1]/x', 'https://169.254.169.254/latest']) {
          await assert.rejects(H.getText(u), /blocked-private-address|ENOTFOUND|EAI_AGAIN/, u);
        }
        assert.deepStrictEqual(await H.serverHistory('https://127.0.0.1:8000/stream'), []);
        await assert.rejects(H.getText('http://example.com/x'), /https only/);
      } finally { process.env.SW_ALLOW_PRIVATE = prev; }
    });
    await t('history merges by normalized title, newest first, labelled by the first source, at most 10', () => {
      const m = H.mergeHistory([
        { source: 'SERVER', items: [{ title: 'Madonna - Holiday', at: 5000 }, { title: 'Untimed - Song', at: null }] },
        { source: 'LISTENERS', items: [{ title: 'madonna – holiday!', at: 4000 }, { title: 'Queen - Radio Ga Ga', at: 9000 }] },
        { source: 'SCOUT', items: [{ title: 'Queen - Radio Ga Ga', at: 8000 }, { title: 'Old - Thing', at: 100 }] },
        { source: 'REPORT', items: [{ title: 'Old - Thing', at: 2000 }, { title: '', at: 1 }, { title: 'Only - Report', at: 3000 }] },
      ]);
      assert.deepStrictEqual(m.map((x) => [x.title, x.source]), [['Untimed - Song', 'SERVER'], ['Queen - Radio Ga Ga', 'LISTENERS'], ['Madonna - Holiday', 'SERVER'], ['Only - Report', 'REPORT'], ['Old - Thing', 'SCOUT']]);
      assert.strictEqual(m.find((x) => x.title === 'Old - Thing').at, 100);
      const many = H.mergeHistory([{ source: 'SERVER', items: Array.from({ length: 25 }, (_, i) => ({ title: `A - ${i}`, at: i + 1 })) }]);
      assert.strictEqual(many.length, 10); assert.strictEqual(many[0].title, 'A - 24');
    });

    const U = 'c0000000-0000-4000-8000-000000000001';
    await t('station_songs: a new title is stored once; the same title again costs nothing; a title already stored is not repeated', async () => {
      resetSongLog(); resetPool();
      mockShelf((u, b) => (u.includes('station_songs?uuid=') ? { json: [{ title: 'Stored - Newest' }] } : { json: null }));
      assert.strictEqual(await noteSong(U, 'Stored - Newest'), false); // already the newest in the table
      assert.strictEqual(await noteSong(U, 'Stored - Newest'), false);
      assert.strictEqual(calls.filter((c) => c.url.includes('/station_songs') && c.body).length, 0);
      assert.strictEqual(await noteSong(U, 'Brand - New'), true);
      assert.strictEqual(await noteSong(U, 'Brand - New'), false); // no more database traffic for a repeat
      const ins = calls.filter((c) => c.url.endsWith('/station_songs'));
      assert.strictEqual(ins.length, 1); assert.deepStrictEqual(ins[0].body, [{ uuid: U, title: 'Brand - New' }]);
      assert.strictEqual(calls.filter((c) => c.url.includes('station_songs?uuid=')).length, 1); // one read, for the first sight of the station
      assert.strictEqual(await noteSong(U, ''), false); assert.strictEqual(await noteSong(U, null), false);
    });
    await t('station_songs: no table yet or a failing database stays silent, and is not asked again for a while', async () => {
      resetSongLog(); resetPool();
      mockShelf(() => ({ status: 404, json: { code: '42P01', message: 'relation "public.station_songs" does not exist' } }));
      assert.strictEqual(await noteSong(U, 'A - B'), false);
      const n = calls.length;
      assert.strictEqual(await noteSong(U, 'C - D'), false);
      assert.strictEqual(calls.length, n);
      resetSongLog();
      mockShelf(() => ({ status: 500, json: {} }));
      assert.strictEqual(await noteSong(U, 'A - B'), false);
      assert.strictEqual(await noteSong(U, 'A - B', { env: null }), false);
      assert.deepStrictEqual(await storedSongs(U), []);
      resetSongLog();
    });

    console.log('Feedback strikes and admin song history');
    process.env.ADMIN_EMAILS = 'boss@example.com'; process.env.SUPABASE_ANON_KEY = 'anon-test-key';
    const asUser = (email) => (u, b) => (u.includes('/auth/v1/user') ? { json: { id: 'u-1', email } } : null);
    const mkRes = () => ({ headers: {}, setHeader() {}, end(b) { this.body = b ? JSON.parse(b) : null; } });
    await t("everyone's reports wait for review, the admin's included (nothing is approved on the spot)", async () => {
      for (const email of ['boss@example.com', 'someone@example.com']) {
        mockShelf((u, b) => asUser(email)(u, b) || { json: null });
        const handler = require('../api/feedback');
        const res = mkRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer tok-' + email }, body: { visitor: 'd0000000-0000-4000-8000-000000000001', genres: ['rock', 'tag:classic rock'], song: 'A - B', station: { uuid: U, name: 'X', city: 'Y', countryCode: 'JP', genre: 'rock' } } }, res);
        const post = calls.find((c) => c.url.endsWith('/genre_reports') && c.body);
        assert(post, email); assert.strictEqual(post.body.length, 2);
        assert(post.body.every((r) => r.status === 'pending' && r.reviewed_at === null), JSON.stringify(post.body));
      }
    });
    await t('admin history: four sources merged and labelled, Apple genre and fit per song, admin only', async () => {
      resetPool(); resetSongLog();
      const row0 = row({ uuid: U, url: 'http://cast.test/stream', samples: [{ title: 'Scout - Sample', at: '2026-11-17T10:00:00Z' }, { title: 'Led Zeppelin - Kashmir', at: '2026-11-17T09:00:00Z' }] });
      const itunes = [];
      const real = global.fetch;
      mockShelf((u, b) => {
        const a = asUser('boss@example.com')(u, b); if (a) return a;
        if (u.includes('/station_pool?uuid=')) return { json: [row0] };
        if (u.includes('/station_songs?uuid=')) return { json: [{ title: 'Listener - Heard', first_seen: '2026-11-18T08:00:00Z' }, { title: 'Dua Lipa - Levitating', first_seen: '2026-11-18T07:00:00Z' }] };
        if (u.includes('/song_lookups?')) return { json: [{ key: 'led zeppelin - kashmir', genre: 'rock', year: 1975, found: true, looked_at: '2026-11-17T00:00:00Z' }] };
        return { json: null };
      });
      const wrapped = global.fetch;
      global.fetch = async (u, i) => {
        if (String(u).includes('itunes.apple.com')) {
          const term = new URL(u).searchParams.get('term'); itunes.push(term);
          const hit = /Levitating/.test(term) ? [{ artistName: 'Dua Lipa', trackName: 'Levitating', primaryGenreName: 'Pop', releaseDate: '2020-03-27T00:00:00Z' }] : [];
          return { ok: true, status: 200, json: async () => ({ results: hit }) };
        }
        if (String(u).includes('/genre_reports?select=song')) { const body = [{ song: 'Dua Lipa - Levitating', created_at: '2026-11-18T07:30:00Z' }, { song: 'Reported - Only', created_at: '2026-11-18T06:00:00Z' }]; return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }; }
        return wrapped(u, i);
      };
      try {
        const handler = require('../api/admin-stats');
        const res = mkRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer hist-admin' }, body: { action: 'history', uuid: U, genres: ['tag:classic rock'] } }, res);
        assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
        const by = Object.fromEntries(res.body.songs.map((x) => [x.title, x]));
        assert.deepStrictEqual(res.body.songs.map((x) => x.title), ['Listener - Heard', 'Dua Lipa - Levitating', 'Reported - Only', 'Scout - Sample', 'Led Zeppelin - Kashmir']);
        assert.strictEqual(by['Dua Lipa - Levitating'].source, 'LISTENERS'); assert.strictEqual(by['Reported - Only'].source, 'REPORT'); assert.strictEqual(by['Scout - Sample'].source, 'SCOUT');
        assert.deepStrictEqual([by['Dua Lipa - Levitating'].genres, by['Dua Lipa - Levitating'].fit], [['pop'], false]); // pop is no classic rock
        assert.deepStrictEqual([by['Led Zeppelin - Kashmir'].genres, by['Led Zeppelin - Kashmir'].fit], [['rock'], true]); // from the cache, 1975
        assert.strictEqual(by['Listener - Heard'].fit, null); assert.strictEqual(by['Reported - Only'].fit, null); // not in the catalog: unknown
        assert(!itunes.some((q) => /Kashmir/.test(q)), 'cached songs are not looked up again');
        assert.strictEqual(res.body.server, false);
        // not an admin: nothing
        mockShelf((u, b) => asUser('nobody@example.com')(u, b) || { json: null });
        const no = mkRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer hist-nobody' }, body: { action: 'history', uuid: U, genres: [] } }, no);
        assert.strictEqual(no.statusCode, 403);
        const bad = mkRes(); mockShelf((u, b) => asUser('boss@example.com')(u, b) || { json: null });
        await handler({ method: 'POST', headers: { authorization: 'Bearer hist-admin' }, body: { action: 'history', uuid: '../etc', genres: [] } }, bad);
        assert.strictEqual(bad.statusCode, 400);
      } finally { global.fetch = real; }
    });
    delete process.env.ADMIN_EMAILS; delete process.env.SUPABASE_ANON_KEY;
    global.fetch = realFetch;
  }

  console.log('Full station list');
  {
    const fs = require('fs');
    const os = require('os');
    const pathMod = require('path');
    const radio = require('../lib/radio');
    const sl = require('../lib/scoutlist');
    const jsonRes = (json, status = 200, headers = {}) => ({ ok: status < 400, status, url: '', headers: { get: (k) => headers[k.toLowerCase()] || null }, json: async () => json, text: async () => (typeof json === 'string' ? json : JSON.stringify(json)) });
    const saved = global.fetch;
    const makeList = (n) => Array.from({ length: n }, (_, i) => ({ stationuuid: `e0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `S${i}`, url_resolved: `https://l${i}.test/s`, tags: 'rock', countrycode: 'JP', changetimestamp: 'x', votes: 5, clickcount: 9, ssl_error: 0, hls: 0, lastcheckok: 1 }));

    await t('allStations pages with hidebroken and order=stationuuid until a short page, keeping only the fields we use', async () => {
      radio.resetServers();
      const all = makeList(25); const calls = [];
      global.fetch = async (url, init = {}) => {
        const u = new URL(url);
        if (u.pathname === '/json/servers') return jsonRes([{ name: 'm1.test' }]);
        calls.push({ q: Object.fromEntries(u.searchParams), path: u.pathname, ua: (init.headers || {})['User-Agent'], signal: Boolean(init.signal) });
        const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
        return jsonRes(all.slice(off, off + lim));
      };
      let out;
      try { out = await radio.allStations({ pageSize: 10 }); } finally { global.fetch = saved; }
      assert.strictEqual(out.length, 25); assert.strictEqual(calls.length, 3);
      assert.deepStrictEqual(calls.map((c) => c.q.offset), ['0', '10', '20']);
      for (const c of calls) { assert.strictEqual(c.path, '/json/stations'); assert.strictEqual(c.q.hidebroken, 'true'); assert.strictEqual(c.q.order, 'stationuuid'); assert.strictEqual(c.q.limit, '10'); assert(/NeoEarthRadio/.test(c.ua)); assert(c.signal); }
      assert(!('votes' in out[0]) && !('clickcount' in out[0]) && !('changetimestamp' in out[0]));
      for (const k of ['stationuuid', 'name', 'url_resolved', 'tags', 'countrycode', 'ssl_error', 'hls', 'lastcheckok']) assert(k in out[0], k);
      assert.deepStrictEqual(out.map((x) => x.stationuuid), all.map((x) => x.stationuuid));
    });
    await t('an exactly full last page costs one empty page; a default page size is 10,000', async () => {
      radio.resetServers();
      const all = makeList(20); const asked = [];
      global.fetch = async (url) => {
        const u = new URL(url);
        if (u.pathname === '/json/servers') return jsonRes([{ name: 'm1.test' }]);
        asked.push(u.searchParams.get('limit') + '@' + u.searchParams.get('offset'));
        const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
        return jsonRes(all.slice(off, off + lim));
      };
      try { assert.strictEqual((await radio.allStations({ pageSize: 10 })).length, 20); assert.strictEqual(asked.length, 3); asked.length = 0; await radio.allStations(); } finally { global.fetch = saved; }
      assert.deepStrictEqual(asked, ['10000@0']);
    });
    await t('a mirror that fails is skipped, and the one that works is kept for the following pages', async () => {
      radio.resetServers();
      const all = makeList(25); const hits = { 'm1.test': 0, 'm2.test': 0 }; const okHosts = [];
      global.fetch = async (url) => {
        const u = new URL(url);
        if (u.pathname === '/json/servers') return jsonRes([{ name: 'm1.test' }, { name: 'm2.test' }]);
        hits[u.hostname]++;
        if (u.hostname === 'm1.test') return jsonRes({}, 500);
        okHosts.push(u.hostname);
        const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
        return jsonRes(all.slice(off, off + lim));
      };
      try { assert.strictEqual((await radio.allStations({ pageSize: 10 })).length, 25); } finally { global.fetch = saved; }
      assert.deepStrictEqual(okHosts, ['m2.test', 'm2.test', 'm2.test']); assert(hits['m1.test'] <= 1, JSON.stringify(hits));
    });
    await t('when every mirror fails the download throws instead of returning half a list', async () => {
      radio.resetServers();
      const all = makeList(25); let page = 0;
      global.fetch = async (url) => {
        const u = new URL(url);
        if (u.pathname === '/json/servers') return jsonRes([{ name: 'm1.test' }, { name: 'm2.test' }]);
        if (page++ >= 1) return jsonRes({}, 503);
        return jsonRes(all.slice(0, 10));
      };
      try { await assert.rejects(() => radio.allStations({ pageSize: 10 }), /503/); } finally { global.fetch = saved; }
    });
    await t('searchStations can ask for the newest changes first', async () => {
      radio.resetServers(); let q;
      global.fetch = async (url) => { const u = new URL(url); if (u.pathname === '/json/servers') return jsonRes([{ name: 'm1.test' }]); q = Object.fromEntries(u.searchParams); return jsonRes([]); };
      try { await radio.searchStations({ recent: true, limit: 500 }); } finally { global.fetch = saved; }
      assert.strictEqual(q.order, 'changetimestamp'); assert.strictEqual(q.reverse, 'true'); assert.strictEqual(q.limit, '500'); assert.strictEqual(q.hidebroken, 'true');
    });

    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'scoutcache-'));
    const file = pathMod.join(dir, 'sub', 'rb-stations.json.gz');
    let clock = 1700000000000; const H = 3600000;
    const now = () => clock;
    let downloads = 0; let mode = 'ok'; let generation = 0;
    const download = async () => { downloads++; if (mode === 'fail') throw new Error('mirrors down'); if (mode === 'tiny') return makeList(1); generation++; return makeList(5).map((x) => ({ ...x, name: `gen${generation}` })); };
    const load = (extra = {}) => sl.loadFullList({ file, download, now, minCount: 2, log: () => {}, ...extra });
    await t('list cache: first run downloads and saves a gzipped file; a fresh file is used without downloading', async () => {
      let r = await load();
      assert.strictEqual(r.source, 'download'); assert.strictEqual(r.downloaded, true); assert.strictEqual(r.stations.length, 5); assert.strictEqual(downloads, 1);
      assert(fs.existsSync(file)); assert.deepStrictEqual([...fs.readFileSync(file).subarray(0, 2)], [0x1f, 0x8b]); assert(r.bytes > 0);
      clock += 23 * H;
      r = await load();
      assert.strictEqual(r.source, 'cache'); assert.strictEqual(r.downloaded, false); assert.strictEqual(downloads, 1); assert.strictEqual(r.stations[0].name, 'gen1'); assert.strictEqual(Math.round(r.ageMs / H), 23);
    });
    await t('list cache: a file over 24 h old triggers a fresh download', async () => {
      clock += 2 * H; // 25 h
      const r = await load();
      assert.strictEqual(r.source, 'download'); assert.strictEqual(downloads, 2); assert.strictEqual(r.stations[0].name, 'gen2'); assert.strictEqual(r.ageMs, 0);
      assert.strictEqual(sl.readCache(file).fetchedAt, clock); // the age is kept inside the file, not in its file time
    });
    await t('list cache: a failed download falls back to the old file, even a tiny list counts as failed, and no file at all gives null', async () => {
      clock += 30 * H; mode = 'fail';
      let r = await load();
      assert.strictEqual(r.source, 'stale'); assert.strictEqual(r.stations[0].name, 'gen2'); assert.strictEqual(Math.round(r.ageMs / H), 30); assert.strictEqual(r.downloaded, false);
      mode = 'tiny';
      r = await load();
      assert.strictEqual(r.source, 'stale'); assert.strictEqual(sl.readCache(file).stations.length, 5); // the tiny list was not saved over it
      fs.writeFileSync(file, 'not gzip at all'); // a damaged file counts as missing
      assert.strictEqual(await load(), null);
      fs.rmSync(file);
      mode = 'fail'; assert.strictEqual(await load(), null);
      mode = 'ok'; r = await load();
      assert.strictEqual(r.source, 'download'); assert(fs.existsSync(file));
    });
    fs.rmSync(dir, { recursive: true, force: true });

    console.log('Offline checks and fair order');
    const { orderCandidates, offlineCheck } = sl;
    const ctx = (over = {}) => ({ haveUuid: new Set(['on-file']), haveUrl: new Set([shelf.normalizeUrl('https://known.test/stream')]), styleExtra: shelf.STYLE_TAGS, ...over });
    const st = (over = {}) => ({ stationuuid: 'x1', name: 'Tokyo Rock', url_resolved: 'https://ok.test/stream', tags: 'rock,classic rock', countrycode: 'JP', geo_lat: '35.69', geo_long: '139.69', bitrate: 128, codec: 'MP3', hls: 0, ssl_error: 0, ...over });
    await t('offline checks give each station one reason, cheapest check first', async () => {
      const why = async (over) => { const r = await offlineCheck(st(over), ctx()); return r.skip || 'ok'; };
      assert.strictEqual(await why({}), 'ok');
      assert.strictEqual(await why({ stationuuid: 'on-file' }), 'on_shelf');
      assert.strictEqual(await why({ url_resolved: 'http://plain.test/x' }), 'skip_not_https');
      assert.strictEqual(await why({ url_resolved: '' }), 'skip_not_https');
      assert.strictEqual(await why({ ssl_error: 1 }), 'skip_ssl_error');
      assert.strictEqual(await why({ url_resolved: `https://long.test/${'a'.repeat(2000)}` }), 'skip_long_url');
      assert.strictEqual(await why({ url_resolved: 'https://known.test/stream/' }), 'skip_duplicate');
      assert.strictEqual(await why({ url_resolved: 'https://pl.test/live.m3u8' }), 'skip_playlist');
      assert.strictEqual(await why({ hls: 1 }), 'skip_playlist');
      assert.strictEqual(await why({ bitrate: 48 }), 'skip_low_bitrate'); // MP3 floor 64
      assert.strictEqual(await why({ bitrate: 48, codec: 'AAC+' }), 'ok'); // AAC floor 40
      assert.strictEqual(await why({ bitrate: 32, codec: 'AAC' }), 'skip_low_bitrate');
      assert.strictEqual(await why({ bitrate: 0 }), 'ok'); // unknown bitrate is judged by the probe
      assert.strictEqual(await why({ tags: 'news,talk' }), 'skip_not_music');
      assert.strictEqual(await why({ tags: 'ニュース' }), 'skip_not_music'); // translated before the blocklist
      // No city, and no usable country either: nowhere to put it. (With a country it is kept, at country level: see below.)
      assert.strictEqual(await why({ geo_lat: null, geo_long: null, countrycode: '', state: 'Somewhere', name: 'Mystery Rock' }), 'skip_no_city');
      assert.strictEqual(await why({ geo_lat: null, geo_long: null, countrycode: 'ZZ', name: 'Mystery Rock' }), 'skip_no_city');
      assert.strictEqual(await why({ geo_lat: null, geo_long: null, state: 'Somewhere', name: 'Mystery Rock' }), 'ok');
      const placed = await offlineCheck(st({ geo_lat: null, geo_long: null, state: 'Tokyo Prefecture' }), ctx());
      assert.strictEqual(placed.cand.place.city, 'Tokyo'); assert.strictEqual(placed.cand.place.how, 'state');
      assert.strictEqual((await offlineCheck(st(), ctx())).cand.place.how, 'coords');
      const country = (await offlineCheck(st({ geo_lat: null, geo_long: null, country: 'Japan', name: 'Some Rock', state: 'Somewhere' }), ctx())).cand.place;
      assert.strictEqual(country.how, 'country'); assert.strictEqual(country.city, null); assert.strictEqual(country.region, 'Somewhere'); assert.strictEqual(country.countryCode, 'JP');
    });

    const cand = (cc, i, how = 'coords', nu) => ({ cc, nu: nu || `${cc}-${i}`, place: { how }, i });
    const many = (cc, n, how) => Array.from({ length: n }, (_, i) => cand(cc, i, how));
    await t('order: countries with the fewest shelf stations come first, one station each per round', () => {
      const cands = [...many('US', 50), ...many('DE', 30), ...many('JP', 3), ...many('NZ', 2)];
      const { list, countries } = orderCandidates(cands, { US: 500, DE: 200 }, { max: 12 });
      const ccs = list.map((c) => c.cc);
      assert.deepStrictEqual(new Set(ccs.slice(0, 2)), new Set(['JP', 'NZ']));
      assert.deepStrictEqual(ccs.slice(2, 4), ['DE', 'US']);
      assert.deepStrictEqual(ccs.slice(4, 6).sort(), ['JP', 'NZ']); assert.deepStrictEqual(ccs.slice(6, 8), ['DE', 'US']);
      assert.strictEqual(countries, 4); assert.strictEqual(list.length, 12);
      // JP has 3 and NZ 2: once they run dry the rest are shared by DE and US
      assert.deepStrictEqual(ccs.slice(8), ['JP', 'DE', 'US', 'DE']);
    });
    await t('order: a run spreads over many countries, never more than the cap from one, and ties are broken differently per run', () => {
      const cands = [];
      for (let k = 0; k < 40; k++) cands.push(...many(`C${String(k).padStart(2, '0')}`, 30));
      cands.push(...many('US', 600));
      const { list, countries } = orderCandidates(cands, { US: 900 }, { max: 100, cap: 5 });
      assert.strictEqual(list.length, 100); assert.strictEqual(countries, 41);
      const per = {}; for (const c of list) per[c.cc] = (per[c.cc] || 0) + 1;
      assert(Math.max(...Object.values(per)) <= 5, JSON.stringify(per)); assert.strictEqual(per.US, 2); // US is last in each round
      const first = (rng) => orderCandidates(cands, {}, { max: 6, rng }).list.map((c) => c.cc).join();
      assert.notStrictEqual(first(() => 0), first(() => 0.99));
      assert.strictEqual(orderCandidates(cands, {}, { max: 41 }).countries, 41);
    });
    await t('order: within a country the best-placed come first, and one stream address is taken once', () => {
      const cands = [cand('FR', 1, 'homepage'), cand('FR', 2, 'name'), cand('FR', 3, 'coords'), cand('FR', 4, 'state'), cand('FR', 5, 'stream'), cand('FR', 6, 'coords'), cand('FR', 7, 'tags', 'FR-3')];
      const { list, duplicates } = orderCandidates(cands, {});
      assert.deepStrictEqual(list.slice(0, 2).map((c) => c.place.how), ['coords', 'coords']);
      assert.strictEqual(list[2].place.how, 'state'); assert.strictEqual(list[3].place.how, 'name');
      assert.deepStrictEqual(list.slice(4).map((c) => c.place.how).sort(), ['homepage', 'stream']);
      assert.strictEqual(duplicates, 1); assert.strictEqual(list.length, 6); assert(!list.some((c) => c.i === 7));
      assert.deepStrictEqual(orderCandidates([], {}).list, []);
      // Stations known only by their country (no city) come after every real-city one.
      const mixed = orderCandidates([cand('FR', 1, 'country'), cand('FR', 2, 'stream'), cand('FR', 3, 'country'), cand('FR', 4, 'coords')], {}).list.map((c) => c.place.how);
      assert.deepStrictEqual(mixed, ['coords', 'stream', 'country', 'country']);
    });

    console.log('Icecast directory formats');
    await t('JSON in any of the known shapes gives entries', () => {
      const arr = shelf.parseDirectory(JSON.stringify([
        { listen_url: 'https://a.test/1', server_name: 'A', genre: 'Rock', server_type: 'audio/mpeg', bitrate: '128', current_song: 'X - Y' },
        { listenurl: 'http://b.test:8000/2', stream_name: 'B', genres: ['jazz', 'blues'], content_type: 'audio/aacp', br: 64, song: 'P - Q' },
        { url: 'https://c.test/3', name: 'C', tags: 'pop, dance', type: 'MP3' }, // a bare codec name becomes its MIME type
        { stream: 'https://d.test/4', title: 'D Only Title' },
        { stream_url: 'https://e.test/5', name: 'E', title: 'The Song Playing' },
        { name: 'no address' }, { url: 'not a url', name: 'bad' }, null, 5,
      ]));
      assert.deepStrictEqual(arr.map((e) => e.url), ['https://a.test/1', 'http://b.test:8000/2', 'https://c.test/3', 'https://d.test/4', 'https://e.test/5']);
      assert.deepStrictEqual(arr[0], { name: 'A', url: 'https://a.test/1', type: 'audio/mpeg', bitrate: 128, genre: 'Rock', song: 'X - Y' });
      assert.deepStrictEqual([arr[1].name, arr[1].genre, arr[1].type, arr[1].bitrate, arr[1].song], ['B', 'jazz, blues', 'audio/aacp', 64, 'P - Q']);
      assert.deepStrictEqual([arr[2].genre, arr[2].type], ['pop, dance', 'audio/mpeg']);
      assert.deepStrictEqual([arr[3].name, arr[3].song], ['D Only Title', '']); // title is the name when nothing else is
      assert.deepStrictEqual([arr[4].name, arr[4].song], ['E', 'The Song Playing']); // ...and the song when a name exists
      const wrapped = (o) => shelf.parseDirectory(JSON.stringify(o)).length;
      assert.strictEqual(wrapped({ stations: [{ url: 'https://a.test/1' }, { url: 'https://a.test/2' }] }), 2);
      assert.strictEqual(wrapped({ whatever: [{ url: 'https://a.test/1' }], other: [{ url: 'https://a.test/2' }, { url: 'https://a.test/3' }] }), 2); // the longest list
      assert.strictEqual(wrapped({ data: { entries: [{ url: 'https://a.test/1' }] } }), 1);
      assert.strictEqual(wrapped({ count: 0 }), 0);
      assert.strictEqual(shelf.parseDirectory([{ url: 'https://a.test/1' }]).length, 1); // already parsed
    });
    await t('XML still parses, and empty, broken and HTML answers give nothing', () => {
      assert.strictEqual(shelf.parseDirectory('<directory><entry><server_name>A</server_name><listen_url>https://a.test/1</listen_url></entry></directory>').length, 1);
      for (const bad of ['', '   ', '<directory></directory>', '{not json', '[', null, undefined, '<!DOCTYPE html><html><body><entry><listen_url>https://a.test/1</listen_url></entry></body></html>', '<html><entry><listen_url>https://a.test/1</listen_url></entry></html>']) assert.deepStrictEqual(shelf.parseDirectory(bad), [], String(bad));
    });
    await t('endpoints are tried in order and the first with entries wins; every attempt is logged', async () => {
      const asked = []; const logs = [];
      const answers = {
        'https://dir.xiph.org/yp.xml': () => jsonRes('<directory></directory>', 200, { 'content-type': 'application/xml' }),
        'https://api.dir.xiph.org/experimental/full': () => jsonRes('Not found', 404, { 'content-type': 'text/html' }),
        'http://api.dir.xiph.org/experimental/full': () => jsonRes([{ listen_url: 'https://j.test/1', server_name: 'J', genre: 'rock' }], 200, { 'content-type': 'application/json' }),
      };
      const fetchImpl = async (url) => { asked.push(url); const f = answers[url]; if (!f) throw new Error('should not be asked'); return f(); };
      const res = await sl.fetchIcecastDirectory({ fetchImpl, log: (m) => logs.push(m) });
      assert.deepStrictEqual(asked, ['https://dir.xiph.org/yp.xml', 'https://api.dir.xiph.org/experimental/full', 'http://api.dir.xiph.org/experimental/full']);
      assert.strictEqual(res.used, 'http://api.dir.xiph.org/experimental/full'); assert.strictEqual(res.entries, 1); assert.strictEqual(shelf.parseDirectory(res.text).length, 1);
      assert.deepStrictEqual(res.tried.map((x) => [x.status, x.entries || 0]), [[200, 0], [404, 0], [200, 1]]);
      assert.strictEqual(logs.length, 3); assert(logs[0].includes('200') && logs[0].includes('application/xml') && logs[0].includes('<directory></directory>'), logs[0]);
      assert(logs[1].includes('404') && logs[1].includes('text/html'), logs[1]);
      const summary = sl.icecastSummary(res);
      assert(/via #3 \(1 entries\)/.test(summary) && summary.length < 250, summary);
    });
    await t('the first endpoint is enough when it works; an HTML page or a network error never counts; all failing gives none', async () => {
      let asked = [];
      let res = await sl.fetchIcecastDirectory({ fetchImpl: async (u) => { asked.push(u); return jsonRes('<directory><entry><server_name>A</server_name><listen_url>https://a.test/1</listen_url></entry></directory>', 200, { 'content-type': 'application/xml' }); }, log: () => {} });
      assert.strictEqual(asked.length, 1); assert.strictEqual(res.used, 'https://dir.xiph.org/yp.xml');
      asked = [];
      res = await sl.fetchIcecastDirectory({
        fetchImpl: async (u) => { asked.push(u); if (asked.length === 1) throw new Error('getaddrinfo ENOTFOUND'); return jsonRes('<html><entry><listen_url>https://h.test/1</listen_url></entry></html>', 200, { 'content-type': 'text/html; charset=utf-8' }); },
        log: () => {},
      });
      assert.strictEqual(asked.length, 4); assert.strictEqual(res.used, null); assert.strictEqual(res.text, ''); assert(res.tried[0].error.includes('ENOTFOUND'));
      assert(/none/.test(sl.icecastSummary(res)));
    });
    await t('the endpoints share one time box', async () => {
      let clock2 = 0; const asked = [];
      const res = await sl.fetchIcecastDirectory({
        fetchImpl: async (u) => { asked.push(u); clock2 += 25000; return jsonRes('', 200, { 'content-type': 'application/xml' }); },
        now: () => clock2, budgetMs: 60000, log: () => {},
      });
      assert.strictEqual(asked.length, 3); assert.strictEqual(res.used, null); assert(res.tried[3].error.includes('no time'));
    });
  }

  console.log('The scout');
  const { run } = require('../scripts/scout');
  const vet = require('../lib/vet');

  // An in-memory stand-in for Supabase.
  function fakeDb(initial = [], { regionColumn = true } = {}) {
    const pool = new Map(initial.map((r) => [r.uuid, { ...r }]));
    const runs = []; const songs = new Map(); const urls = new Map([...pool.values()].map((r) => [r.url, r.uuid]));
    return {
      pool, runs, songs, upserts: 0, regionRejected: 0,
      async insert(table, rows) { assert.strictEqual(table, 'scout_runs'); runs.push({ id: runs.length + 1, ...rows[0] }); return [runs[runs.length - 1]]; },
      async patch(path, body) { Object.assign(runs[runs.length - 1], body); },
      async upsert(table, rows) {
        this.upserts++;
        if (table === 'song_lookups') { for (const r of rows) songs.set(r.key, r); return; }
        assert.strictEqual(table, 'station_pool');
        // Before migration 20261118060000_station_region.sql the table has no region column: PostgREST refuses a row that has one.
        if (!regionColumn && rows.some((r) => 'region' in r)) {
          this.regionRejected++;
          const e = new Error('Supabase POST /station_pool answered 400: ' + "Could not find the 'region' column of 'station_pool' in the schema cache");
          e.status = 400; e.body = JSON.stringify({ code: 'PGRST204', message: "Could not find the 'region' column of 'station_pool' in the schema cache" });
          throw e;
        }
        for (const r of rows) {
          assert.deepStrictEqual(Object.keys(r).length, regionColumn ? 25 : 24, 'every column is sent');
          const owner = urls.get(r.url);
          if (owner && owner !== r.uuid) throw new Error('duplicate url');
          urls.set(r.url, r.uuid); pool.set(r.uuid, { ...r });
        }
      },
      async get(path) {
        if (path.includes('/song_lookups')) return [];
        const all = [...pool.values()];
        if (path.includes('status=eq.active')) return all.filter((r) => r.status === 'active').sort((a, b) => (a.last_checked_at < b.last_checked_at ? -1 : 1)).map((r) => JSON.parse(JSON.stringify(r)));
        if (path.includes('status=eq.dead')) return all.filter((r) => r.status === 'dead' && r.last_checked_at < new Date(Date.now() - 7 * 86400000).toISOString()).map((r) => JSON.parse(JSON.stringify(r)));
        return [];
      },
      async getAll(path) {
        if (path.includes('select=*')) return this.get(path);
        return [...pool.values()].map((r) => ({ uuid: r.uuid, url: r.url, status: r.status, country_code: r.country_code }));
      },
      async rpc(fn) { assert.strictEqual(fn, 'pool_stats'); return [{ key: '*', n: [...pool.values()].filter((r) => r.status === 'active').length }]; },
    };
  }
  const rb = (n, over = {}) => ({ stationuuid: `b0000000-0000-4000-8000-00000000000${n}`, name: `Station ${n}`, url_resolved: `https://s${n}.test/stream`, tags: 'rock,classic rock', countrycode: 'JP', country: 'Japan', geo_lat: '35.69', geo_long: '139.69', bitrate: 128, codec: 'MP3', ...over });
  const quiet = { log: () => {}, loadFull: async () => null, itunesSpacingMs: 0, sleep: async () => {}, sliceIndex: () => 0, artistCountry: async (a) => (/pillows/i.test(a) ? 'JP' : 'GB') };
  // What each fake stream "plays".
  const plays = { 1: 'The Pillows - Funny Bunny', 2: 'Led Zeppelin - Kashmir', 3: 'Third Band - Third Song', 5: 'Some Band - Some Song' };
  const fakeProbe = async (url) => {
    const n = Number((/s(\d)\.test|ice(\d)/.exec(url) || [])[1] || (/ice(\d)/.exec(url) || [])[1]);
    if (url.includes('slow')) return { ok: false, reason: 'slow' };
    if (url.includes('gone')) return { ok: false, reason: 'http-404' };
    if (url.includes('s4.test')) return { ok: true, bitrate: 128, cors: false, title: null };
    if (url.includes('s6.test')) return { ok: true, bitrate: 32, cors: false, title: 'Weak Band - Weak Song' };
    return { ok: true, bitrate: 128, cors: n === 1, title: plays[n] || 'Icy Band - Icy Song', contentType: 'audio/mpeg' };
  };
  const songInfo = async (title) => {
    const info = /Pillows|Zeppelin/.test(title) ? { genres: ['rock'], year: /Zeppelin/.test(title) ? 1975 : 1990 } : null;
    return { info, known: Boolean(info), key: title };
  };
  const yp = `<directory>
    <entry><server_name>Berlin Beats</server_name><listen_url>http://ice1.test/beats</listen_url><server_type>audio/mpeg</server_type><bitrate>128</bitrate><genre>Techno</genre></entry>
    <entry><server_name>Berlin Ogg</server_name><listen_url>https://ice2.test/ogg</listen_url><server_type>application/ogg</server_type><genre>Techno</genre></entry>
    <entry><server_name>Berlin Plain Port</server_name><listen_url>http://ice3.test:8000/x</listen_url><server_type>audio/mpeg</server_type><genre>Techno</genre></entry>
    <entry><server_name>Nowhere Radio</server_name><listen_url>https://ice4.test/x</listen_url><server_type>audio/mpeg</server_type><genre>Techno</genre></entry>
    <entry><server_name>Berlin Copy</server_name><listen_url>https://s1.test/stream</listen_url><server_type>audio/mpeg</server_type><genre>Techno</genre></entry>
  </directory>`;
  const base = (db, over = {}) => ({ db, ...quiet, budgetMs: 60000, search: async () => [rb(1), rb(2), rb(3), rb(4), rb(5, { url_resolved: 'https://slow.test/x' }), rb(6), rb(7, { url_resolved: 'https://gone.test/x' }), rb(8, { tags: 'news,talk' }), rb(9, { url_resolved: 'http://plain.test/x' })],
    fetchYp: async () => yp, probe: fakeProbe, songInfo, ...over });

  let db1;
  await t('first run: new stations are checked, judged and saved; others are turned away', async () => {
    db1 = fakeDb();
    const out = await run(base(db1));
    const rows = Object.fromEntries([...db1.pool.values()].map((r) => [r.name, r]));
    // Radio Browser: 1, 2, 3 pass; 4 has no titles (dead on file); 5 slow (forgotten); 6 weak; 7 gone (dead); 8 talk and 9 http never probed.
    for (const n of [1, 2, 3]) assert.strictEqual(rows[`Station ${n}`].status, 'active', `station ${n}`);
    assert.strictEqual(rows['Station 4'].status, 'dead'); assert.strictEqual(rows['Station 6'].status, 'dead'); assert.strictEqual(rows['Station 7'].status, 'dead');
    assert(!rows['Station 5'] && !rows['Station 8'] && !rows['Station 9']);
    // Icecast: Berlin Beats (http on port 80 upgraded to https) is kept; ogg, a plain-port http stream, no city and a duplicate of a Radio Browser stream are not.
    const ice = [...db1.pool.values()].filter((r) => r.source === 'icecast');
    assert.strictEqual(ice.length, 1); assert.strictEqual(ice[0].name, 'Berlin Beats'); assert.strictEqual(ice[0].url, 'https://ice1.test/beats');
    assert.strictEqual(ice[0].city, 'Berlin'); assert.strictEqual(ice[0].country_code, 'DE'); assert(UUID.test(ice[0].uuid)); assert(shelf.isIcecastId(ice[0].uuid));
    // Genres and local artists.
    assert(rows['Station 1'].genres.includes('rock') && rows['Station 1'].genres.includes('tag:classic rock'));
    assert.strictEqual(rows['Station 1'].local_ratio, 1); assert.strictEqual(rows['Station 2'].local_ratio, 0);
    assert.strictEqual(rows['Station 1'].samples.length, 1); assert.strictEqual(rows['Station 1'].samples[0].known, true);
    assert(rows['Station 1'].samples[0].fits.includes('rock')); assert.strictEqual(rows['Station 1'].cors, true);
    assert.strictEqual(rows['Station 1'].tags, 'rock,classic rock');
    assert.strictEqual(rows['Station 1'].last_ok_at !== null, true); assert.strictEqual(rows['Station 4'].last_ok_at, null);
    // The run is on record.
    assert.strictEqual(db1.runs.length, 1); const r = db1.runs[0];
    assert(r.finished_at); assert.strictEqual(r.added, 4); assert.strictEqual(r.active_total, 4); assert(r.discovered >= 8 && r.checked >= 8);
    assert.strictEqual(out.added, 4);
  });
  await t('stations without coordinates are placed from their region, tags or addresses, counted by how, and the unplaced music ones are sampled in the log', async () => {
    const db = fakeDb();
    const logs = [];
    const none = { geo_lat: null, geo_long: null };
    const out = await run(base(db, {
      log: (m) => logs.push(m), fetchYp: async () => '<directory></directory>',
      search: async () => [
        rb(1, { ...none, state: 'Tokyo Prefecture' }),
        rb(2, { ...none, state: '', homepage: 'https://www.radio-osaka.example.jp/', name: 'Kansai Rock' }),
        rb(3, { ...none, state: 'Somewhere', name: 'Mystery Rock', homepage: 'https://mystery.example.jp', tags: 'rock,classic rock' }),
        rb(4, { ...none, countrycode: '', country: '', state: 'Nowhere', name: 'Lost Rock', homepage: 'https://lost.example.com', tags: 'rock,classic rock' }),
        rb(5, { ...none, tags: 'news,talk', name: 'Talk Without A City' }),
      ],
    }));
    const rows = Object.fromEntries([...db.pool.values()].map((r) => [r.name, r]));
    assert.strictEqual(rows['Station 1'].city, 'Tokyo'); assert.strictEqual(rows['Station 1'].country_code, 'JP');
    assert.strictEqual(rows['Kansai Rock'].city, 'Osaka');
    // No city but a country: kept, placed at the country (city null, the region field as the region), and counted as placed_country.
    assert(rows['Mystery Rock'], 'a station with a country but no city stays on the shelf');
    assert.strictEqual(rows['Mystery Rock'].city, null); assert.strictEqual(rows['Mystery Rock'].region, 'Somewhere'); assert.strictEqual(rows['Mystery Rock'].country_code, 'JP');
    assert.strictEqual(rows['Station 1'].region, null); assert.strictEqual(rows['Kansai Rock'].region, null); // real cities carry no region
    assert(Math.abs(rows['Mystery Rock'].lat - 35) < 6 && Math.abs(rows['Mystery Rock'].lng - 137) < 8, `${rows['Mystery Rock'].lat},${rows['Mystery Rock'].lng}`); // near Japan's centre
    assert(!rows['Lost Rock'], 'no usable country: nowhere to put it');
    assert(out.notes.some((n) => n.split(' ').sort().join(' ') === 'placed_country=1 placed_homepage=1 placed_state=1'), out.notes.join(' / '));
    assert.strictEqual(out.counts.skip_no_city, 1); // only the music station with no country; the talk station is turned away as not music first
    assert.strictEqual(out.counts.skip_not_music, 1);
    assert(logs.some((l) => /still without a city: 1 /.test(l)), logs.join('\n'));
    assert(logs.some((l) => l.includes('| Nowhere | Lost Rock | https://lost.example.com | rock,classic rock')), logs.join('\n'));
    assert(!logs.some((l) => l.includes('Talk Without A City')));
  });
  await t('country-level stations get a region column value; without the column the scout retries without region and says so once', async () => {
    const none = { geo_lat: null, geo_long: null };
    const search = async () => [rb(1, { ...none, state: 'Somewhere' }), rb(2, { ...none, state: 'Tokyo Prefecture' }), rb(3, { ...none, state: 'kanagawa ken', name: 'Kanagawa Rock' })];
    // With the column: region is saved for the country-level station, left empty for the city one.
    const withCol = fakeDb();
    await run(base(withCol, { search, fetchYp: async () => '<directory></directory>' }));
    const a = Object.fromEntries([...withCol.pool.values()].map((r) => [r.name, r]));
    assert.strictEqual(a['Station 1'].city, null); assert.strictEqual(a['Station 1'].region, 'Somewhere'); assert.strictEqual(a['Station 2'].city, 'Tokyo'); assert.strictEqual(a['Station 2'].region, null);
    assert.strictEqual(a['Kanagawa Rock'].region, 'Kanagawa Ken'); // title-cased
    assert.strictEqual(withCol.regionRejected, 0);
    // Without it (migration not run yet): same stations saved, region left out, one notice, and the batch is not lost.
    const logs = [];
    const noCol = fakeDb([], { regionColumn: false });
    const out = await run(base(noCol, { search, fetchYp: async () => '<directory></directory>', log: (m) => logs.push(m) }));
    const b = Object.fromEntries([...noCol.pool.values()].map((r) => [r.name, r]));
    assert(b['Station 1'] && b['Station 2'] && b['Kanagawa Rock'], 'every station still saved');
    for (const r of noCol.pool.values()) assert(!('region' in r), 'no region key without the column');
    assert.strictEqual(b['Station 1'].city, null);
    assert.strictEqual(noCol.regionRejected, 1, 'asked once, then remembered');
    assert.strictEqual(out.notes.filter((n) => /no region column/.test(n)).length, 1);
    assert(out.notes.some((n) => /20261118060000_station_region/.test(n)));
    assert.strictEqual(out.counts.row_refused || 0, 0);
    // Other errors are not mistaken for a missing column.
    const badUrl = fakeDb();
    const out2 = await run(base(badUrl, { search: async () => [rb(1, { ...none, state: 'Somewhere' }), rb(2, { ...none, url_resolved: 'https://s1.test/stream' })], fetchYp: async () => '<directory></directory>' }));
    assert(!out2.notes.some((n) => /no region column/.test(n)));
  });
  await t('second run: nothing new is added twice; stations are re-checked and gain samples', async () => {
    const plays1 = plays[1];
    plays[1] = 'The Pillows - Another One';
    const out = await run(base(db1));
    plays[1] = plays1;
    const s1 = [...db1.pool.values()].find((r) => r.name === 'Station 1');
    assert.strictEqual(out.added, 0); assert.strictEqual(s1.samples.length, 2); assert.strictEqual(s1.ok_count, 2);
    assert.strictEqual([...db1.pool.values()].filter((r) => r.name === 'Berlin Beats').length, 1);
    assert.strictEqual(db1.runs.length, 2);
  });
  await t('three failed checks in a row make a station dead; a pass resets the count', async () => {
    const db = fakeDb([{ ...[...db1.pool.values()].find((r) => r.name === 'Station 2') }]);
    const only = base(db, { search: async () => [], fetchYp: async () => '<directory></directory>' });
    const flaky = { ok: false, reason: 'http-500' };
    let mode = flaky;
    const probe = async (url) => (mode.ok === false ? mode : fakeProbe(url));
    const get = () => [...db.pool.values()][0];
    await run({ ...only, probe }); assert.strictEqual(get().fail_streak, 1); assert.strictEqual(get().status, 'active');
    mode = { ok: true }; await run({ ...only, probe }); assert.strictEqual(get().fail_streak, 0);
    mode = flaky;
    await run({ ...only, probe }); await run({ ...only, probe }); assert.strictEqual(get().status, 'active');
    const out = await run({ ...only, probe }); assert.strictEqual(get().status, 'dead'); assert.strictEqual(out.now_dead, 1); assert.deepStrictEqual(get().genres, []);
    // Dead stations wait a week before being tried again.
    await run({ ...only, probe: async () => { throw new Error('should not be probed'); } });
    // ...and come back when they play again after that.
    db.pool.get(get().uuid).last_checked_at = new Date(Date.now() - 8 * 86400000).toISOString();
    mode = { ok: true }; await run({ ...only, probe }); assert.strictEqual(get().status, 'active'); assert.strictEqual(get().fail_streak, 0);
  });
  await t('an alive station without a song title is left alone, not failed', async () => {
    const db = fakeDb([{ ...[...db1.pool.values()].find((r) => r.name === 'Station 2') }]);
    const before = JSON.stringify(get(db).samples);
    await run({ ...base(db), search: async () => [], fetchYp: async () => '<directory></directory>', probe: async () => ({ ok: true, bitrate: 128, title: 'Station 2' }) });
    assert.strictEqual(get(db).fail_streak, 0); assert.strictEqual(JSON.stringify(get(db).samples), before);
    function get(d) { return [...d.pool.values()][0]; }
  });
  await t('a row the database refuses does not lose the rest, and is not counted as added', async () => {
    const db = fakeDb();
    const realUpsert = db.upsert.bind(db);
    db.upsert = async (table, rows) => { if (table === 'station_pool' && rows.length > 1) throw new Error('batch failed'); if (rows[0].name === 'Station 2') throw new Error('refused'); return realUpsert(table, rows); };
    const out = await run(base(db, { fetchYp: async () => '' }));
    const names = [...db.pool.values()].filter((r) => r.status === 'active').map((r) => r.name).sort();
    assert.deepStrictEqual(names, ['Station 1', 'Station 3']); assert.strictEqual(out.added, 2);
  });
  await t('the scout stops at its time budget and still records the run', async () => {
    const db = fakeDb();
    const many = Array.from({ length: 200 }, (_, i) => rb(1, { stationuuid: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, url_resolved: `https://many${i}.test/s`, name: `Many ${i}` }));
    const t0 = Date.now();
    const out = await run({ ...base(db), budgetMs: 700, chunk: 4, concurrency: 2, search: async () => many, fetchYp: async () => '', probe: async () => { await sleep(60); return { ok: true, bitrate: 128, title: 'Some Band - Some Song' }; } });
    const took = Date.now() - t0;
    assert(took < 1500, `took ${took} ms`);
    assert(out.checked > 0 && out.checked < 200, `checked ${out.checked}`);
    assert(db.runs[0].finished_at && /stopped at the time budget/.test(db.runs[0].notes));
    assert(db.pool.size > 0 && db.pool.size <= out.checked);
  });
  await t('MusicBrainz and iTunes limits per run are respected', async () => {
    const db = fakeDb();
    let itunes = 0, mb = 0;
    const many = Array.from({ length: 40 }, (_, i) => rb(1, { stationuuid: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, url_resolved: `https://lim${i}.test/s`, name: `Lim ${i}` }));
    await run({ ...base(db), itunesMax: 5, mbMax: 7, search: async () => many, fetchYp: async () => '', probe: async (u) => ({ ok: true, bitrate: 128, title: `Band${u.length} - Song ${u}` }),
      songInfo: async (title, opts) => { if (await opts.gate()) itunes++; return { info: null, known: false }; }, artistCountry: async () => { mb++; return 'JP'; } });
    assert(itunes <= 5, `itunes ${itunes}`); assert(mb <= 7, `mb ${mb}`);
    assert([...db.pool.values()].filter((r) => r.status === 'active').length === 40);
  });
  await t('untagged stations are probed, counted apart (untagged_added), saved without tags, and get genres only from songs', async () => {
    const db = fakeDb();
    const untagged = (n, over = {}) => rb(n, { tags: '', countrycode: 'IN', country: 'India', geo_lat: '19.07', geo_long: '72.87', ...over });
    const out = await run(base(db, {
      fetchYp: async () => '<directory></directory>',
      search: async () => [untagged(1, { name: 'Radio Mirchi' }), untagged(2, { name: 'Akashvani News' }), rb(3)],
      probe: async (u) => ({ ok: true, bitrate: 128, cors: false, title: u.includes('s1.') ? 'Led Zeppelin - Kashmir' : 'Some Band - Some Song' }),
    }));
    const rows = Object.fromEntries([...db.pool.values()].map((r) => [r.name, r]));
    assert(rows['Radio Mirchi'] && rows['Radio Mirchi'].status === 'active'); assert.strictEqual(rows['Radio Mirchi'].tags, ''); assert.strictEqual(rows['Radio Mirchi'].country_code, 'IN');
    assert.deepStrictEqual(rows['Radio Mirchi'].genres, []); // one song is no basis for a genre
    assert(!rows['Akashvani News']); assert.strictEqual(out.counts.untagged_candidates, 1); assert.strictEqual(out.counts.untagged_added, 1);
    assert(out.notes.some((n) => /untagged_added=1 of 1 untagged candidates/.test(n)), out.notes.join(' / '));
    // Run again with samples that identify it as rock three times: now it qualifies, with no tags at all.
    const known = { title: 'Led Zeppelin - Kashmir', at: 'x', known: true, fits: ['rock', 'tag:classic rock'], named: [] };
    db.pool.get(rows['Radio Mirchi'].uuid).samples = [known, { ...known, title: 'Led Zeppelin - Ramble On' }, { ...known, title: 'Led Zeppelin - Black Dog' }];
    await run(base(db, { fetchYp: async () => '<directory></directory>', search: async () => [], probe: async () => ({ ok: true, bitrate: 128, cors: false, title: 'Led Zeppelin - Kashmir' }) }));
    assert(db.pool.get(rows['Radio Mirchi'].uuid).genres.includes('rock'), JSON.stringify(db.pool.get(rows['Radio Mirchi'].uuid).genres));
  });
  await t('the scout saves what songs name (named), uses the station\'s country for the iTunes store, and reads MusicBrainz genres once per artist', async () => {
    const db = fakeDb();
    const asked = []; const mbAsked = [];
    await run(base(db, {
      fetchYp: async () => '<directory></directory>',
      search: async () => [rb(1, { tags: 'electronic', name: 'Mix Station' }), rb(2, { tags: '', name: 'No Tags FM' })],
      probe: async (u) => ({ ok: true, bitrate: 128, cors: false, title: u.includes('s1.') ? 'Some DJ - Night Drive' : 'Other DJ - Dark Hour' }),
      songInfo: async (title, opts) => { asked.push([title, opts.country]); return { info: { genres: ['electronic'], year: 2019 }, known: true, key: title }; },
      artistCountry: undefined,
      artistInfo: async (artist) => { mbAsked.push(artist); return { country: 'DE', tags: /Some/.test(artist) ? ['synthwave', 'electronic'] : ['techno', 'minimal'] }; },
    }));
    const rows = Object.fromEntries([...db.pool.values()].map((r) => [r.name, r]));
    assert.deepStrictEqual(asked.map((a) => a[1]), ['JP', 'JP']); // Japan's store for both
    assert.deepStrictEqual(mbAsked.sort(), ['Other DJ', 'Some DJ']);
    const a = rows['Mix Station'].samples[0], b = rows['No Tags FM'].samples[0];
    assert(a.fits.includes('tag:synthwave') && a.named.includes('tag:synthwave')); // Apple says only Electronic; MusicBrainz names the style
    assert(!b.fits.includes('tag:synthwave') && b.named.includes('tag:techno')); // MusicBrainz says Techno: not a Synthwave song
    assert(a.fits.includes('electronic') && !a.named.includes('electronic'));
  });
  // The full Radio Browser list.
  const SPOTS = { JP: ['35.69', '139.69'], DE: ['52.52', '13.40'], BR: ['-23.55', '-46.63'], NZ: ['-36.85', '174.76'] };
  const fullStation = (cc, i, over = {}) => ({ stationuuid: `f${cc.charCodeAt(0).toString(16)}${cc.charCodeAt(1).toString(16)}000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `${cc} Rock ${i}`, url_resolved: `https://${cc.toLowerCase()}${i}.full.test/s`, tags: 'rock', countrycode: cc, country: cc, geo_lat: SPOTS[cc][0], geo_long: SPOTS[cc][1], bitrate: 128, codec: 'MP3', ...over });
  const fullList = (spec) => Object.entries(spec).flatMap(([cc, n]) => Array.from({ length: n }, (_, i) => fullStation(cc, i)));
  const loaded = (stations, over = {}) => async () => ({ stations, source: 'cache', ageMs: 3.5 * 3600000, bytes: 4096, downloaded: false, ...over });
  const onShelf = (stn) => ({ uuid: stn.stationuuid, url: stn.url_resolved, source: 'radiobrowser', name: stn.name, tags: 'rock', country_code: stn.countrycode, status: 'active', genres: [], samples: [], ok_count: 2, fail_streak: 0, last_checked_at: new Date().toISOString(), first_seen_at: new Date().toISOString(), codec: 'MP3', bitrate: 128, local_ratio: null });
  await t('with the full list: stations on file are dropped, countries with the fewest shelf stations are served first, and only a small top-up is searched', async () => {
    const stations = fullList({ JP: 12, DE: 12, BR: 12 });
    const seeded = [0, 1, 2].map((i) => onShelf(fullStation('JP', i))); // JP already has 3 on the shelf
    const db = fakeDb(seeded);
    const jobs = [];
    const extra = fullStation('DE', 99, { name: 'Brand New Berlin Rock' });
    const out = await run({ ...base(db), loadFull: loaded(stations), maxNew: 5, perCountryCap: 3, fetchYp: async () => '',
      search: async (job) => { jobs.push(job); return job.recent ? [extra] : []; }, probe: async (u) => ({ ok: true, bitrate: 128, cors: false, title: `Band ${u.length} - Song ${u}` }) });
    const added = [...db.pool.values()].filter((r) => !seeded.some((x) => x.uuid === r.uuid));
    const byCc = {}; for (const r of added) byCc[r.country_code] = (byCc[r.country_code] || 0) + 1;
    assert.deepStrictEqual(byCc, { BR: 2, DE: 2, JP: 1 }); assert.strictEqual(out.added, 5);
    assert.strictEqual(out.counts.on_shelf, 3);
    assert(jobs.length <= 20 && jobs.length >= 1 && jobs[0].recent === true, JSON.stringify(jobs.slice(0, 3)));
    const notes = db.runs[0].notes;
    assert(/full list 36 stations, 3\.5 h old \(cache, 4 KB gz\)/.test(notes), notes);
    assert(/new to scout 34, pass offline 34, picked 5 from 3 countries/.test(notes), notes); // 36 + the recent one, minus 3 on file
    assert(/countries probed 3; added by region: europe=2 latinamerica=2 eastasia=1|countries probed 3; added by region: latinamerica=2 europe=2 eastasia=1/.test(notes), notes);
    assert(notes.length <= 1500);
    assert(db.runs[0].discovered === 5);
  });
  await t('with the full list the top-up stations are searched too, and a full-list run still re-checks the shelf', async () => {
    const stations = fullList({ NZ: 2 });
    const seeded = [onShelf(fullStation('JP', 0))];
    const db = fakeDb(seeded);
    const out = await run({ ...base(db), loadFull: loaded(stations), fetchYp: async () => '', search: async (job) => (job.recent ? [fullStation('DE', 7, { name: 'Recent Berlin' })] : []), probe: fakeProbe });
    const names = [...db.pool.values()].map((r) => r.name);
    assert(names.includes('Recent Berlin') && names.includes('NZ Rock 0') && names.includes('NZ Rock 1'), names.join());
    assert.strictEqual(out.checked, 4); // 3 new + the shelf station re-checked
    assert.strictEqual([...db.pool.values()].find((r) => r.name === 'JP Rock 0').ok_count, 3);
  });
  await t('negation: the scout sweeps the shelf, dropping genre keys a station\'s own words rule out, and counts negated stations in the full list', async () => {
    const forra = { ...onShelf(fullStation('DE', 50, { name: 'Radio Forra' })), tags: 'all genre on earth except trap,and things like trap,todos los géneros excepto trap y similares', genres: ['tag:trap', 'hiphop', 'pop'] };
    const metalNot = { ...onShelf(fullStation('DE', 51, { name: 'Everything but Metal' })), tags: 'pop,hits', genres: ['metal', 'tag:thrash metal', 'pop'] };
    const fine = { ...onShelf(fullStation('DE', 52, { name: 'Plain Rock' })), tags: 'rock,no copyright sounds', genres: ['rock'] };
    const db = fakeDb([forra, metalNot, fine]);
    const patches = [];
    const plainGetAll = db.getAll.bind(db);
    db.getAll = async (path) => (path.includes('select=uuid,name,tags,genres') ? [...db.pool.values()].map((r) => ({ uuid: r.uuid, name: r.name, tags: r.tags, genres: r.genres })) : plainGetAll(path));
    const runPatch = db.patch.bind(db);
    db.patch = async (path, body) => { if (path.startsWith('/station_pool?uuid=eq.')) { patches.push([decodeURIComponent(path.split('eq.')[1]), body]); db.pool.get(decodeURIComponent(path.split('eq.')[1])).genres = body.genres; return; } return runPatch(path, body); };
    const logs = [];
    const listed = [fullStation('DE', 70, { name: 'Radio Forra 2', tags: 'all genre on earth except trap' }), fullStation('DE', 71, { name: 'Trap-free Zone', tags: 'trap-free zone,hip hop' }), fullStation('DE', 72, { name: 'Normal', tags: 'rock,non-stop hits' })];
    const out = await run({ ...base(db), log: (m) => logs.push(m), loadFull: loaded(listed), fetchYp: async () => '', search: async () => [], probe: fakeProbe });
    // the sweep's own updates (the re-check that follows may judge the rows again, e.g. Forra's tags qualify nothing at all)
    assert.deepStrictEqual(patches.map(([id, body]) => [id, body.genres]).sort(), [[forra.uuid, ['hiphop', 'pop']], [metalNot.uuid, ['pop']]].sort());
    assert(!db.pool.get(forra.uuid).genres.includes('tag:trap') && !db.pool.get(metalNot.uuid).genres.includes('metal'));
    assert.deepStrictEqual(db.pool.get(fine.uuid).genres, ['rock']);
    assert.strictEqual(out.counts.negation_sweep_rows, 2); assert.strictEqual(out.counts.negation_sweep_keys, 3);
    assert.strictEqual(out.counts.negated_stations, 2);
    const notes = db.runs[0].notes;
    assert(/negation sweep: checked 3 shelf rows, fixed 2 stations \(3 genre keys dropped\)/.test(notes), notes);
    assert(/negated genre mentions: 2 of 3 stations/.test(notes), notes);
    const sample = logs.find((m) => /Negated genre mentions, 2 examples/.test(m));
    assert(sample && /Radio Forra 2 \| DE \| trap -> .*tag:trap/.test(sample) && /Trap-free Zone/.test(sample), String(sample));
    assert(notes.length <= 1500);
    // a second run has nothing left to fix
    const again = await run({ ...base(db), loadFull: loaded(listed), fetchYp: async () => '', search: async () => [], probe: fakeProbe });
    assert(!again.counts.negation_sweep_rows);
    assert(/fixed 0 stations/.test(db.runs[1].notes));
  });
  await t('the sweep never touches rows that do not change, respects its cap, and survives a failing update', async () => {
    const { sweepNegated } = require('../scripts/scout');
    const rows = Array.from({ length: 5 }, (_, i) => ({ uuid: `u${i}`, name: 'Everything but Metal', tags: 'pop', genres: ['metal', 'pop'] })).concat([{ uuid: 'ok', name: 'Metal FM', tags: 'metal', genres: ['metal'] }, { uuid: 'untagged', name: 'X', tags: null, genres: [] }]);
    const done = [];
    const db = { getAll: async () => rows, patch: async (path, body) => { if (path.includes('u1')) throw new Error('nope'); done.push([path, body]); } };
    const r = await sweepNegated(db, { max: 4 });
    assert.deepStrictEqual({ checked: r.checked, rows: r.rows, keys: r.keys, failed: r.failed }, { checked: 7, rows: 3, keys: 3, failed: 1 });
    assert(done.every(([, b]) => b.genres.length === 1 && b.genres[0] === 'pop'));
    assert(!done.some(([p]) => /ok|untagged/.test(p)));
  });
  await t('poolNext skips shelf rows whose own words negate the pick (rows judged before the rule existed)', async () => {
    const { negatesPick } = require('../lib/pool');
    const real = global.fetch;
    resetPool();
    const forraRow = row({ uuid: 'a0000000-0000-4000-8000-0000000000f1', name: 'Radio Forra', tags: 'all genre on earth except trap,and things like trap', genres: ['tag:trap'], url: 'https://stream.test/forra' });
    const goodRow = row({ uuid: 'a0000000-0000-4000-8000-0000000000f2', name: 'Trap Nation', tags: 'trap,hip-hop', genres: ['tag:trap'], url: 'https://stream.test/good' });
    const trapSpec = resolveGenre(null, 'trap');
    assert(negatesPick(forraRow, trapSpec) && !negatesPick(goodRow, trapSpec) && !negatesPick(forraRow, null));
    // a several-genres pick: only negated when every part the row is listed for is negated
    const both = resolveGenres('rock,tag:trap');
    assert(negatesPick(forraRow, both)); // listed for trap only
    assert(!negatesPick({ ...forraRow, genres: ['tag:trap', 'rock'] }, both)); // also listed for rock: still fine for rock
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [forraRow, goodRow] } : { json: null }));
    const probed = [];
    const s = await poolNext(trapSpec, new Set(), [], { probe: async (url) => { probed.push(url); return { ok: true, bitrate: 128, cors: false, title: 'A - B' }; }, songFits: async () => null });
    assert.strictEqual(s.uuid, goodRow.uuid); assert(!probed.some((u) => u.includes('forra')), 'Forra is not even probed');
    mockShelf((u) => (u.includes('pool_candidates') ? { json: [forraRow] } : { json: null }));
    assert.strictEqual(await poolNext(trapSpec, new Set(), [], { probe: okProbe, songFits: async () => null }), null); // nothing left: the live path takes over
    global.fetch = real;
    resetPool();
  });
  await t('no full list (missing or failing): the old rotating keyword searches run', async () => {
    for (const loadFull of [async () => null, async () => { throw new Error('boom'); }]) {
      const db = fakeDb(); const jobs = [];
      const out = await run({ ...base(db), loadFull, fetchYp: async () => '', search: async (job) => { jobs.push(job); return job.limit === 200 && !job.recent && jobs.length === 1 ? [rb(1), rb(2)] : []; } });
      assert(jobs.length > 40, `jobs ${jobs.length}`); assert(!jobs.some((j) => j.recent));
      assert.strictEqual(out.added, 2);
      assert(/no full list/.test(db.runs[0].notes), db.runs[0].notes);
    }
  });
  await t('the full list does not break the time budget', async () => {
    const db = fakeDb();
    const t0 = Date.now();
    const out = await run({ ...base(db), budgetMs: 700, chunk: 4, concurrency: 2, loadFull: loaded(fullList({ DE: 150, BR: 150 })), fetchYp: async () => '', search: async () => [],
      probe: async () => { await sleep(60); return { ok: true, bitrate: 128, title: 'Some Band - Some Song' }; } });
    const took = Date.now() - t0;
    assert(took < 1500, `took ${took} ms`); assert(out.checked > 0 && out.checked < 300, `checked ${out.checked}`);
    assert(db.runs[0].finished_at && /stopped at the time budget/.test(db.runs[0].notes));
  });
  await t('Icecast JSON works in a run and its endpoint details reach the notes', async () => {
    const db = fakeDb();
    const json = JSON.stringify({ stations: [{ listen_url: 'http://ice1.test/beats', server_name: 'Berlin Beats', genre: ['Techno'], server_type: 'MP3', bitrate: '128' }, { listen_url: 'https://ice4.test/x', server_name: 'Nowhere Radio', genre: 'Techno' }] });
    const report = { used: 'https://api.dir.xiph.org/experimental/full', entries: 2, tried: [{ url: 'https://dir.xiph.org/yp.xml', status: 200, type: 'application/xml', entries: 0 }, { url: 'https://api.dir.xiph.org/experimental/full', status: 200, type: 'application/json', entries: 2 }] };
    await run({ ...base(db), search: async () => [], fetchYp: async ({ report: r }) => { r(report); return json; } });
    const ice = [...db.pool.values()].filter((r) => r.source === 'icecast');
    assert.strictEqual(ice.length, 1); assert.strictEqual(ice[0].name, 'Berlin Beats'); assert.strictEqual(ice[0].url, 'https://ice1.test/beats');
    assert(/icecast via #2 \(2 entries\) \[1:200\/xml\/0 2:200\/json\/2\]/.test(db.runs[0].notes), db.runs[0].notes);
  });
  await t('without a shelf database the scout says so instead of crashing', async () => {
    const db = fakeDb(); db.insert = async () => { const e = new Error('Supabase POST /scout_runs answered 404'); e.status = 404; throw e; };
    await assert.rejects(() => run(base(db)), /404/);
  });

  console.log('/api/admin-stats');
  {
    const prev = { a: process.env.SUPABASE_ANON_KEY, e: process.env.ADMIN_EMAILS };
    process.env.SUPABASE_ANON_KEY = 'test-anon-key'; process.env.ADMIN_EMAILS = 'admin@example.com';
    delete require.cache[require.resolve('../api/admin-stats')];
    const handler = require('../api/admin-stats');
    async function stats(shelfReady) {
      global.fetch = async (url, init = {}) => {
        const u = String(url);
        const j = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
        if (u.includes('/auth/v1/user')) return j({ id: 'u1', email: 'admin@example.com' });
        if (u.includes('/rpc/admin_stats')) return j({ generated_at: 'x', daily: [] });
        if (u.includes('/rpc/admin_check_stats') || u.includes('genre_reports')) return j([]);
        if (u.includes('/rpc/pool_stats')) return shelfReady ? j([{ key: '*', n: 30 }, { key: 'src:radiobrowser', n: 25 }, { key: 'src:icecast', n: 5 }, { key: 'dead', n: 7 }, { key: 'stale', n: 2 }, { key: 'rock', n: 20 }, { key: 'tag:classic rock', n: 9 }]) : j({ code: 'PGRST202' }, 404);
        if (u.includes('/scout_runs')) return shelfReady ? j([{ id: 3, started_at: 'a', finished_at: 'b', discovered: 4, checked: 5, added: 6, now_dead: 7, active_total: 30, notes: 'n' }]) : j({}, 404);
        if (u.includes('radio-browser')) return j({ stations: 1, stations_broken: 0, countries: 1, tags: 1 });
        throw new Error(`unexpected ${u}`);
      };
      const res = { headers: {}, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
      await handler({ url: '/api/admin-stats', method: 'GET', headers: { authorization: 'Bearer tok-' + Math.random() } }, res);
      return res.body;
    }
    await t('the shelf summary reaches the dashboard', async () => {
      const b = await stats(true);
      assert.strictEqual(b.shelf.total, 30); assert.deepStrictEqual(b.shelf.sources, { radiobrowser: 25, icecast: 5 });
      assert.strictEqual(b.shelf.dead, 7); assert.strictEqual(b.shelf.stale, 2);
      assert.deepStrictEqual(b.shelf.counts, { rock: 20, 'tag:classic rock': 9 });
      assert.strictEqual(b.shelf.catalog.rock.label, 'Rock'); assert(b.shelf.catalog.rock.styles.includes('classic rock'));
      assert.strictEqual(b.shelf.run.added, 6);
    });
    await t('before the migration the shelf is null and the rest of the dashboard still loads', async () => {
      const b = await stats(false);
      assert.strictEqual(b.shelf, null); assert(b.stats);
    });
    for (const [k, v] of [['SUPABASE_ANON_KEY', prev.a], ['ADMIN_EMAILS', prev.e]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[require.resolve('../api/admin-stats')];
    global.fetch = realFetch;
  }

  for (const [k, v] of [['SUPABASE_URL', savedEnv.u], ['SUPABASE_SERVICE_ROLE_KEY', savedEnv.k]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  void vet;
  console.log(failures ? `\n${failures} failed` : '\nAll shelf tests passed');
  process.exit(failures ? 1 : 0);
})();
