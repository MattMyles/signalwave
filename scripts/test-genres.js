// Offline tests for build 57: how closely genres are matched.
//   compound aliases, honest station counts, style-aware song checks (Apple labels and
//   MusicBrainz tags), untagged stations, songs in other scripts, the scout's schedule,
//   and the WRONG GENRE? suggestions. Run by `npm test` (after scripts/test-shelf.js).
process.env.SW_ALLOW_PRIVATE = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  pass  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); }
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

(async () => {
  const cfg = require('../lib/config');
  const vet = require('../lib/vet');
  const { translateTags } = require('../lib/translate');
  const tm = require('../lib/tagmatch');

  /* ---------- Part 1: compound aliases ---------- */
  console.log('Compound aliases');
  await t("'a+b' needs a tag for each term; one tag may satisfy both; plain names still match by substring", () => {
    assert(tm.nameHits(['dub', 'reggae', 'roots'], 'roots+reggae'));
    assert(tm.nameHits(['reggae roots'], 'roots+reggae'));
    assert(tm.nameHits(['roots reggae'], 'roots+reggae'));
    assert(!tm.nameHits(['roots', 'americana'], 'roots+reggae'));
    assert(!tm.nameHits(['reggae'], 'roots+reggae'));
    assert(tm.nameHits(['classic rock'], 'rock') && !tm.nameHits(['jazz'], 'rock'));
    assert.deepStrictEqual(tm.searchTerms(['roots reggae', 'roots+reggae', 'rasta', 'fusion+jazz']), ['roots reggae', 'roots', 'rasta', 'fusion']);
    assert.deepStrictEqual(tm.plainNames(['a', 'b+c']), ['a']);
    assert(tm.tagHits('roots', ['reggae', 'roots'], ['roots+reggae']) && !tm.tagHits('roots', ['roots', 'folk'], ['roots+reggae']));
  });
  // Would the app play a station with these tags for this style?
  const accepts = (style, tags, name = 'Some Station') => {
    const spec = vet.resolveGenre(null, style);
    const raw = vet.splitTags(tags), tr = translateTags(raw);
    return vet.isMusicStation(tr, spec.tags) && vet.matchesGenre(tr, spec) && vet.isFocused(raw, name, spec);
  };
  await t('Roots Reggae keeps reggae stations and drops Americana, Celtic and roots-rock ones', () => {
    for (const tags of ['dub,reggae,roots', 'reggae,roots', 'reggae roots', 'roots reggae,dancehall', 'rasta,jamaica', 'reggae,roots,rasta']) assert(accepts('roots reggae', tags), tags);
    for (const tags of ['roots,americana,folk', 'celtic,roots,folk', 'roots rock,classic rock', 'roots', 'americana,roots,country']) assert(!accepts('roots reggae', tags), tags);
  });
  await t('Jazz Fusion needs jazz beside fusion; Industrial Metal needs metal beside industrial', () => {
    for (const tags of ['jazz fusion', 'fusion,jazz', 'jazz-fusion', 'smooth jazz,fusion']) assert(accepts('jazz fusion', tags), tags);
    for (const tags of ['world fusion,latin', 'fusion,food', 'fusion']) assert(!accepts('jazz fusion', tags), tags);
    for (const tags of ['industrial metal', 'industrial,metal', 'metal,industrial']) assert(accepts('industrial metal', tags), tags);
    for (const tags of ['industrial,techno', 'industrial,ebm', 'industrial']) assert(!accepts('industrial metal', tags), tags);
  });
  await t('the genre-focus check understands compound names (and a station name that says it)', () => {
    const rr = vet.resolveGenre(null, 'roots reggae');
    assert(vet.isFocused(['dub', 'reggae', 'roots'], 'Reggae.fr', rr));
    assert(!vet.isFocused(['pop', 'rock', 'jazz', 'hits', 'reggae', 'roots'], 'Hit mix', rr)); // a variety station
    assert(vet.isFocused(['folk'], 'Roots Reggae Radio', rr)); // the name says it
    assert(!vet.isFocused(['roots', 'folk'], 'Roots Radio', rr));
  });
  await t('every compound alias has two terms of 3+ letters, and the audited bare words are gone', () => {
    const all = Object.values(cfg.TAG_ALIASES).flat();
    for (const a of all.filter(tm.isCompound)) { const terms = tm.termsOf(a); assert.strictEqual(terms.length, 2, a); assert(terms.every((x) => x.length >= 3), a); }
    for (const bare of ['roots', 'fusion', 'industrial', 'goa', 'banda', 'psychedelic', 'darkwave']) assert(!all.includes(bare), `${bare} is too broad on its own`);
    assert.deepStrictEqual(cfg.TAG_ALIASES['roots reggae'], ['roots+reggae', 'rasta', 'roots rock reggae', 'reggae roots']);
    assert.deepStrictEqual(cfg.TAG_ALIASES['jazz fusion'], ['fusion+jazz', 'jazz-fusion']);
    assert.deepStrictEqual(cfg.TAG_ALIASES['industrial metal'], ['industrial+metal']);
  });
  await t('compound names are searched by their first term, in the live search and the scout', () => {
    const rr = vet.resolveGenre(null, 'roots reggae');
    const terms = tm.searchTerms(rr.tags);
    assert(terms.includes('roots') && !terms.some((x) => x.includes('+')));
    assert(read('scripts/scout.js').includes('searchTerms(spec.tags)'));
    const { STYLE_TAGS } = require('../lib/shelf');
    assert(!STYLE_TAGS.some((x) => x.includes('+')) && !STYLE_TAGS.includes('roots'));
  });

  /* ---------- Part 2: honest counts ---------- */
  console.log('Genre editor counts');
  const { genreCounts, resetCounts } = require('../lib/genrecounts');
  const st = (id, tags, over = {}) => ({ stationuuid: id, tags, url_resolved: `https://${id}.test/s`, geo_lat: 1, geo_long: 2, ...over });
  const searches = [];
  const search = async ({ tag, limit }) => {
    searches.push(tag);
    const big = tag === 'dancehall' ? Array.from({ length: limit }, (_, i) => st(`dh${i}`, 'dancehall')) : null;
    return big || ({
      'reggae': [st('r1', 'reggae,roots'), st('r2', 'reggae,dub'), st('x1', 'reggae', { url_resolved: 'http://plain.test/s' })],
      'roots reggae': [st('r1', 'reggae,roots')],
      roots: [st('r1', 'reggae,roots'), st('r3', 'dub,reggae,roots'), st('a1', 'roots,americana'), st('a2', 'celtic,roots'), st('a3', 'roots,folk')],
      'reggae roots': [st('r3', 'dub,reggae,roots')],
    }[tag] || []);
  };
  let rpcCalls = 0;
  const shelfDb = (rows) => ({ rpc: async (fn) => { rpcCalls++; if (rows instanceof Error) throw rows; return rows; } });
  await t('the directory number filters a compound alias; the verified number is the shelf', async () => {
    resetCounts(); searches.length = 0;
    const c = await genreCounts('reggae', { search, db: shelfDb([{ key: '*', n: 99 }, { key: 'src:radiobrowser', n: 5 }, { key: 'dead', n: 3 }, { key: 'reggae', n: 9 }, { key: 'tag:roots reggae', n: 2 }]) });
    assert.strictEqual(c['tag:roots reggae'].n, 2); // r1 and r3; the three Americana, Celtic and folk stations the word 'roots' finds are filtered out
    assert.strictEqual(c['tag:roots reggae'].verified, 2);
    assert.strictEqual(c.reggae.verified, 9); assert.strictEqual(c.reggae.n, 302); // r1, r2 and 300 dancehall stations; the plain-http one doesn't count
    assert.strictEqual(c['tag:dub'].verified, 0); // none on the shelf yet: 0, not unknown
    assert(!('*' in c) && Object.keys(c).includes('tag:dancehall'));
  });
  await t('"300+" when a search hits its cap; shelf missing means verified is null', async () => {
    resetCounts();
    const c = await genreCounts('reggae', { search, db: shelfDb(Object.assign(new Error('missing'), { status: 404 })) });
    assert.strictEqual(c['tag:dancehall'].more, true); assert.strictEqual(c['tag:dancehall'].n, 300);
    assert.strictEqual(c['tag:dancehall'].verified, null); assert.strictEqual(c['tag:ska'].more, false);
  });
  await t('verified counts are re-read every 10 minutes, directory searches once a day', async () => {
    resetCounts(); searches.length = 0; rpcCalls = 0;
    const db = shelfDb([{ key: 'reggae', n: 1 }]);
    await genreCounts('reggae', { search, db }); await genreCounts('reggae', { search, db });
    assert.strictEqual(rpcCalls, 1); assert.strictEqual(searches.filter((x) => x === 'roots').length, 1);
  });
  await t('the endpoint says unknown genres are 400 and lets responses be cached 15 minutes', async () => {
    const f = require.resolve('../lib/genrecounts');
    const real = require.cache[f];
    require.cache[f] = { id: f, filename: f, loaded: true, exports: { ...real.exports, genreCounts: async () => ({ rock: { n: 1, more: false, verified: 1 } }) }, children: [], paths: [] };
    delete require.cache[require.resolve('../api/genre-counts')];
    const handler = require('../api/genre-counts');
    const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } });
    const bad = res(); await handler({ url: '/api/genre-counts?genre=nope', headers: {} }, bad); assert.strictEqual(bad.statusCode, 400);
    const ok = res(); await handler({ url: '/api/genre-counts?genre=rock', headers: {} }, ok);
    assert.strictEqual(ok.statusCode, 200); assert(/s-maxage=900/.test(ok.headers['Cache-Control']), ok.headers['Cache-Control']); assert.strictEqual(ok.body.counts.rock.verified, 1);
    require.cache[f] = real; delete require.cache[require.resolve('../api/genre-counts')];
  });

  /* ---------- Part 3: style-aware song check ---------- */
  console.log('Style-aware song check');
  const songs = require('../lib/songcheck');
  const labels = require('../lib/stylelabels');
  const fit = (key, genres, year, mb) => songs.partFits({ key }, { genres: genres.map((g) => g.toLowerCase()), year: year || null, mb });
  await t('Synthwave takes generic Electronic and Dance, not Techno or House or Pop', () => {
    assert.strictEqual(fit('tag:synthwave', ['Electronic']), true);
    assert.strictEqual(fit('tag:synthwave', ['Dance']), true);
    assert.strictEqual(fit('tag:synthwave', ['Techno']), false);
    assert.strictEqual(fit('tag:synthwave', ['House']), false);
    assert.strictEqual(fit('tag:synthwave', ['Pop']), false); // outside the family, as before
    assert.strictEqual(fit('tag:synthwave', ['Electronic', 'Techno']), true); // any label that fits is enough
    assert.strictEqual(fit('tag:synthwave', ['Synthwave']), true);
  });
  await t('Techno takes Techno and Electronic, not House or Trance', () => {
    assert.strictEqual(fit('tag:techno', ['Techno']), true);
    assert.strictEqual(fit('tag:techno', ['Electronic']), true);
    assert.strictEqual(fit('tag:techno', ['House']), false);
    assert.strictEqual(fit('tag:techno', ['Trance']), false);
    assert.strictEqual(fit('tag:house', ['House']), true); assert.strictEqual(fit('tag:house', ['Deep House']), true);
    assert.strictEqual(fit('tag:deep house', ['House']), true); assert.strictEqual(fit('tag:deep house', ['Techno']), false);
    assert.strictEqual(fit('tag:psytrance', ['Trance']), true); // Apple has nothing finer
    assert.strictEqual(fit('tag:drum and bass', ["Jungle/Drum'n'bass"]), true);
    assert.strictEqual(fit('tag:drum and bass', ['Dubstep']), false);
  });
  await t('Roots Reggae takes Reggae and Roots Reggae, not Dancehall, Dub, Reggaeton or Dubstep', () => {
    assert.strictEqual(fit('tag:roots reggae', ['Reggae']), true);
    assert.strictEqual(fit('tag:roots reggae', ['Roots Reggae']), true);
    assert.strictEqual(fit('tag:roots reggae', ['Dancehall']), false);
    assert.strictEqual(fit('tag:roots reggae', ['Dub']), false);
    assert.strictEqual(fit('tag:roots reggae', ['Reggaeton']), false);
    assert.strictEqual(fit('tag:roots reggae', ['Dubstep']), false);
    assert.strictEqual(fit('tag:dancehall', ['Dancehall']), true); assert.strictEqual(fit('tag:dancehall', ['Roots Reggae']), false);
    assert.strictEqual(fit('tag:ska', ['Ska']), true); assert.strictEqual(fit('tag:ska', ['Skate Punk']), false);
  });
  await t('Classic Rock keeps the year rule on top of the whole rock family', () => {
    assert.strictEqual(fit('tag:classic rock', ['Hard Rock'], 1975), true);
    assert.strictEqual(fit('tag:classic rock', ['Hard Rock'], 2010), false);
    assert.strictEqual(fit('tag:classic rock', ['Rock'], 1994), true); assert.strictEqual(fit('tag:classic rock', ['Rock'], 1995), false);
    assert.strictEqual(fit('tag:classic rock', ['Pop'], 1975), false);
    assert.strictEqual(fit('tag:80s', ['Pop'], 1985), true); assert.strictEqual(fit('tag:80s', ['Pop'], 1995), false);
  });
  await t('Metal: any rock-ish label for the main genre; a death metal pick still takes Metal and Hard Rock but not Doom', () => {
    assert.strictEqual(fit('metal', ['Hard Rock']), true); // same family, adjacent (Apple files a lot of metal under Rock)
    assert.strictEqual(fit('metal', ['Rock']), true); assert.strictEqual(fit('metal', ['Pop']), false);
    assert.strictEqual(fit('tag:death metal', ['Metal']), true); assert.strictEqual(fit('tag:death metal', ['Hard Rock']), true);
    assert.strictEqual(fit('tag:death metal', ['Heavy Metal']), true); assert.strictEqual(fit('tag:death metal', ['Doom Metal']), false);
    assert.strictEqual(fit('tag:death metal', ['Alternative']), false);
    assert.strictEqual(fit('tag:grunge', ['Alternative']), true); assert.strictEqual(fit('tag:grunge', ['Hard Rock']), false);
  });
  await t('Jazz Fusion takes Fusion and Jazz, not Bebop; other families work the same way', () => {
    assert.strictEqual(fit('tag:jazz fusion', ['Bebop']), false);
    assert.strictEqual(fit('tag:jazz fusion', ['Jazz']), true); assert.strictEqual(fit('tag:jazz fusion', ['Fusion']), true);
    assert.strictEqual(fit('tag:bebop', ['Bebop']), true); assert.strictEqual(fit('tag:bebop', ['Smooth Jazz']), false);
    assert.strictEqual(fit('tag:salsa', ['Salsa y Tropical']), true); assert.strictEqual(fit('tag:tango', ['Salsa y Tropical']), false);
    assert.strictEqual(fit('tag:k-pop', ['K-Pop']), true); assert.strictEqual(fit('tag:k-pop', ['J-Pop']), false); assert.strictEqual(fit('tag:k-pop', ['Pop']), true);
    assert.strictEqual(fit('tag:trap', ['Hip-Hop/Rap']), true); assert.strictEqual(fit('tag:trap', ['Dancehall']), false);
    assert.strictEqual(fit('tag:bluegrass', ['Bluegrass']), true); assert.strictEqual(fit('tag:bluegrass', ['Country']), true); assert.strictEqual(fit('tag:bluegrass', ['Americana']), false);
    assert.strictEqual(fit('country', ['Roots Reggae']), false); assert.strictEqual(fit('country', ['Americana']), true);
  });
  await t('main genres keep working on whole families, and World is never judged', () => {
    assert.strictEqual(fit('electronic', ['Techno']), true); assert.strictEqual(fit('electronic', ['Dancehall']), false); assert.strictEqual(fit('electronic', ['Reggaeton']), false);
    assert.strictEqual(fit('reggae', ['Reggaeton']), false); assert.strictEqual(fit('reggae', ['Dancehall']), true); assert.strictEqual(fit('reggae', ['Roots Reggae']), true);
    assert.strictEqual(fit('rock', ['Metal']), true); assert.strictEqual(fit('pop', ['Dancehall']), false);
    assert.strictEqual(fit('world', ['Reggae']), null); assert.strictEqual(fit('tag:celtic', ['Rock']), null);
  });
  await t('every style has a table (or is an era, or World), and a song labelled with the style itself fits it', () => {
    for (const [main, styles] of Object.entries(cfg.STYLES)) {
      for (const style of styles) {
        if (main === 'world') { assert.strictEqual(fit(`tag:${style}`, ['Anything']), null, style); continue; }
        if (labels.BROAD.has(style)) continue;
        assert(labels.STYLE_LABELS[style], `${style} has no Apple labels in lib/stylelabels.js`);
        assert.strictEqual(fit(`tag:${style}`, [style]), true, `${style} should fit a song labelled ${style}`);
      }
    }
    for (const style of Object.keys(labels.STYLE_LABELS)) assert(Object.values(cfg.STYLES).flat().includes(style), `${style} is not a style`);
  });
  await t('MusicBrainz gives a second opinion only when Apple says just the generic label', () => {
    assert.strictEqual(fit('tag:synthwave', ['Electronic'], null, ['techno', 'electronic']), false); // top genres name Techno
    assert.strictEqual(fit('tag:synthwave', ['Electronic'], null, ['synthwave', 'electronic']), true);
    assert.strictEqual(fit('tag:synthwave', ['Electronic'], null, ['electronic', 'pop']), true); // nothing for or against
    assert.strictEqual(fit('tag:synthwave', ['Electronic'], null, ['electronic', 'ambient', 'house']), false); // only the top 3 count, and house is third
    assert.strictEqual(fit('tag:synthwave', ['Electronic'], null, ['electronic', 'ambient', 'pop', 'house']), true); // fourth: ignored
  });
  await t('MusicBrainz: this style anywhere in the list beats a different style on top; Apple naming the style is final', () => {
    assert.strictEqual(fit('tag:techno', ['Electronic'], null, ['house', 'techno']), true);
    assert.strictEqual(fit('tag:techno', ['Electronic'], null, ['house', 'deep house']), false);
    assert.strictEqual(fit('tag:techno', ['Techno'], null, ['house', 'deep house']), true);
    assert.strictEqual(fit('tag:techno', ['House'], null, ['techno']), false); // MusicBrainz can't rescue a different Apple label
    assert.strictEqual(fit('tag:death metal', ['Metal'], null, ['thrash metal', 'metal']), false);
    assert.strictEqual(fit('tag:heavy metal', ['Metal'], null, ['heavy metal']), true);
    assert.strictEqual(fit('tag:grunge', ['Alternative'], null, undefined), true);
  });
  await t('fitKeys and namedKeys: generic labels fit styles without naming them', () => {
    const generic = { genres: ['electronic'], year: 2015 };
    assert(songs.fitKeys(generic).includes('tag:synthwave') && songs.fitKeys(generic).includes('tag:techno') && songs.fitKeys(generic).includes('electronic'));
    for (const k of ['tag:synthwave', 'tag:techno', 'tag:house', 'tag:trance', 'electronic']) assert(!songs.namedKeys(generic).includes(k), k);
    const techno = { genres: ['techno'], year: 2015 };
    assert(songs.fitKeys(techno).includes('tag:techno') && !songs.fitKeys(techno).includes('tag:synthwave') && !songs.fitKeys(techno).includes('tag:trance'));
    assert(songs.namedKeys(techno).includes('tag:techno') && !songs.namedKeys(techno).includes('electronic'));
    assert(songs.namedKeys({ genres: ['electronic'], mb: ['synthwave'] }).includes('tag:synthwave'));
  });
  await t('songFits uses MusicBrainz tags that are already on file (and never asks for them)', async () => {
    const realFetch = global.fetch; const asked = [];
    global.fetch = async (u) => { asked.push(String(u)); return { ok: true, json: async () => ({ results: [{ artistName: 'Some DJ', trackName: 'Night Drive', primaryGenreName: 'Electronic', releaseDate: '2019-01-01' }] }) }; };
    try {
      const sw = vet.resolveGenre(null, 'synthwave');
      assert.strictEqual(await songs.songFits('Some DJ - Night Drive', sw, { artists: { get: () => undefined } }), true);
      const onFile = { get: (k) => (k === 'some dj' ? { country: 'DE', tags: ['techno', 'minimal'] } : undefined) };
      assert.strictEqual(await songs.songFits('Some DJ - Night Drive', sw, { artists: onFile }), false);
      assert.strictEqual(await songs.songFits('Some DJ - Night Drive', vet.resolveGenre('electronic'), { artists: onFile }), true);
      assert(asked.every((u) => u.includes('itunes.apple.com')), 'only Apple was asked');
    } finally { global.fetch = realFetch; }
  });
  await t('MusicBrainz: country, genres and tags come back in one request, cached in memory and in artist_info', async () => {
    const { artistInfo, artistCountry } = require('../lib/artistcheck');
    const { makeArtistCache } = require('../lib/artistcache');
    const realFetch = global.fetch; const urls = [];
    global.fetch = async (u) => { urls.push(String(u)); return { ok: true, json: async () => ({ artists: [{ name: 'Kavinsky', score: 100, country: 'FR', genres: [{ name: 'Synthwave', count: 5 }, { name: 'electro', count: 2 }], tags: [{ name: 'electronic', count: 4 }, { name: 'synthwave', count: 1 }] }] }) }; };
    try {
      const store = new Map(); const writes = [];
      const cache = { get: (k) => store.get(k), set: (k, v) => { store.set(k, v); writes.push(k); } };
      const info = await artistInfo('Kavinsky', { cache });
      assert.deepStrictEqual(info, { country: 'FR', tags: ['synthwave', 'electro', 'electronic'] });
      assert(/inc=genres\+tags/.test(urls[0]), urls[0]); assert.strictEqual(urls.length, 1);
      assert.strictEqual(await artistCountry('Kavinsky'), 'FR'); assert.strictEqual(urls.length, 1); // memory
      assert.deepStrictEqual(writes, ['kavinsky']);
      // The persistent cache: one read, rows older than 30 days are ignored, writes are batched.
      const rows = [{ name: 'daft punk', country: 'FR', tags: 'house|electronic', looked_at: new Date().toISOString() }, { name: 'old one', country: 'GB', tags: 'rock', looked_at: '2020-01-01T00:00:00Z' }];
      const gets = []; const upserts = [];
      const ac = makeArtistCache({ get: async (p) => { gets.push(p); return rows; }, upsert: async (tb, r) => { upserts.push([tb, r]); } });
      await ac.prefetch(['daft punk', 'old one']);
      assert.deepStrictEqual(ac.get('daft punk'), { country: 'FR', tags: ['house', 'electronic'] }); assert.strictEqual(ac.get('old one'), undefined); assert.strictEqual(gets.length, 1);
      ac.set('new artist', { country: 'JP', tags: ['rock'] }); await ac.flush();
      assert.strictEqual(upserts[0][0], 'artist_info'); assert.deepStrictEqual([upserts[0][1][0].name, upserts[0][1][0].tags], ['new artist', 'rock']);
    } finally { global.fetch = realFetch; }
  });
  await t('stations qualify for a style from songs that name it, with no tags or the wrong tags', () => {
    const { qualifyGenres } = require('../lib/shelf');
    const sample = (named, fits = ['electronic']) => ({ title: 'A - B', at: 'x', known: true, fits: [...fits, ...named], named });
    const techno = [sample(['tag:techno']), sample(['tag:techno']), sample(['tag:techno'])];
    assert(qualifyGenres({ rawTags: [], name: 'Station', samples: techno }).includes('tag:techno')); // no tags at all
    assert(qualifyGenres({ rawTags: ['house'], name: 'Station', samples: techno }).includes('tag:techno')); // mis-tagged
    assert(!qualifyGenres({ rawTags: ['house'], name: 'Station', samples: techno }).includes('tag:house')); // and the tag alone no longer vouches for house
    const generic = [sample([]), sample([]), sample([])];
    assert(!qualifyGenres({ rawTags: [], name: 'Station', samples: generic }).includes('tag:techno')); // generic Electronic names no style
    assert(qualifyGenres({ rawTags: [], name: 'Station', samples: generic }).includes('electronic')); // but fits the main genre
    assert(qualifyGenres({ rawTags: ['techno'], name: 'Station', samples: generic.slice(0, 1) }).includes('tag:techno')); // tags still qualify
    assert(!qualifyGenres({ rawTags: [], name: 'Station', samples: techno.slice(0, 2) }).includes('tag:techno')); // needs 3 identified songs
    assert(!qualifyGenres({ rawTags: [], name: 'Station', samples: [sample(['tag:techno']), sample([]), sample([]), sample([])] }).includes('tag:techno')); // 25%
  });

  /* ---------- Part 4: untagged stations ---------- */
  console.log('Untagged stations');
  const scoutlist = require('../lib/scoutlist');
  const ctx = { haveUuid: new Set(), haveUrl: new Set(), styleExtra: [] };
  const rb = (over = {}) => ({ stationuuid: 'c0000000-0000-4000-8000-000000000001', name: 'Radio Mirchi', url_resolved: 'https://mirchi.test/live', homepage: 'https://mirchi.test', tags: '', countrycode: 'IN', country: 'India', geo_lat: '19.07', geo_long: '72.87', bitrate: 128, codec: 'MP3', ...over });
  await t('a station with no tags gets in unless its name or homepage says talk, news, sport or religion', async () => {
    const ok = await scoutlist.offlineCheck(rb(), ctx);
    assert(ok.cand && ok.cand.untagged === true && ok.cand.rawTags.length === 0);
    for (const over of [{ name: 'Akashvani News FM' }, { homepage: 'https://talkfm.example' }, { name: 'ニュースラジオ' }, { name: 'Sports Station' }, { name: 'Radio Church of Christ' }]) {
      assert.strictEqual((await scoutlist.offlineCheck(rb(over), ctx)).skip, 'skip_not_music', JSON.stringify(over));
    }
    assert.strictEqual((await scoutlist.offlineCheck(rb({ tags: 'news' }), ctx)).skip, 'skip_not_music'); // tagged stations are judged as before
    assert.strictEqual((await scoutlist.offlineCheck(rb({ tags: 'community,local' }), ctx)).skip, 'skip_not_music');
    assert.strictEqual((await scoutlist.offlineCheck(rb({ tags: 'pop' }), ctx)).cand.untagged, false);
    assert.strictEqual((await scoutlist.offlineCheck(rb({ url_resolved: 'http://plain.test/x' }), ctx)).skip, 'skip_not_https'); // every other check still applies
  });
  await t('an untagged station shows the genre it was picked for (or the first one it qualifies for), and Any waits for 2 identified songs', () => {
    const { toStation } = require('../lib/pool');
    const row = { uuid: 'u', name: 'N', url: 'https://x.test/s', tags: '', genres: ['rock', 'tag:classic rock'], samples: [], country: 'India', country_code: 'IN', city: 'Mumbai', source: 'radiobrowser' };
    assert.strictEqual(toStation(row, null).genre, 'rock');
    assert.strictEqual(toStation(row, vet.resolveGenre('rock')).genre, 'rock');
    assert.strictEqual(toStation({ ...row, genres: [] }, null).genre, 'music');
    const sql = read('supabase/migrations/20261118100000_genre_judging.sql');
    assert(/coalesce\(s\.tags, ''\) <> ''/.test(sql) && /e->>'known' = 'true'\) >= 2/.test(sql), 'pool_candidates holds back untagged stations for Any until 2 songs are known');
    assert(/create table if not exists public\.artist_info/.test(sql) && /add column if not exists suggested/.test(sql));
  });

  /* ---------- Part 5: songs in other scripts ---------- */
  console.log('Songs in other scripts');
  await t('splitSong understands the separators CJK stations use', () => {
    assert.deepStrictEqual(songs.splitSong('米津玄師 - Lemon'), { artist: '米津玄師', song: 'Lemon' });
    assert.deepStrictEqual(songs.splitSong('YOASOBI／アイドル'), { artist: 'YOASOBI', song: 'アイドル' });
    assert.deepStrictEqual(songs.splitSong('宇多田ヒカル「First Love」'), { artist: '宇多田ヒカル', song: 'First Love' });
    assert.deepStrictEqual(songs.splitSong('아이유 / 좋은 날'), { artist: '아이유', song: '좋은 날' });
    assert.strictEqual(songs.splitSong('Just Some Words'), null);
    assert.strictEqual(songs.splitSong('AC / DC'), null); // " / " only splits CJK titles
    assert.deepStrictEqual(songs.splitSong('Artist - Song'), { artist: 'Artist', song: 'Song' });
  });
  await t('names are compared on letters of any script (NFKC, brackets and punctuation dropped); Latin keys are unchanged', () => {
    assert.strictEqual(songs.fold('ＹＯＡＳＯＢＩ'), 'yoasobi'); assert.strictEqual(songs.fold('아이유 (IU)'), '아이유'); assert.strictEqual(songs.fold('Lemon【Remastered】'), 'lemon');
    assert.strictEqual(songs.fold('ｱｲﾄﾞﾙ'), 'アイドル'); assert.strictEqual(songs.fold('ヒカル feat. Someone'), 'ヒカル');
    assert.strictEqual(songs.songKey('Beyoncé', 'Halo (Live)'), 'beyonce - halo'); // as it always was
    assert.strictEqual(songs.songKey('米津玄師', 'Lemon'), '米津玄師 - lemon');
    assert.notStrictEqual(songs.songKey('米津玄師', 'レモン'), songs.songKey('米津玄師', 'Lemon'));
    assert.notStrictEqual(songs.songKey('米津玄師', 'レモン'), songs.songKey('宇多田ヒカル', 'レモン'));
    assert.deepStrictEqual(songs.storesFor('JP'), ['JP']); assert.deepStrictEqual(songs.storesFor('cn'), ['TW', 'HK', null]); assert.deepStrictEqual(songs.storesFor(''), [null]);
  });
  await t('a Japanese or Korean title is looked up in the station\'s country store, cached under its own key, and judged', async () => {
    const realFetch = global.fetch; const asked = [];
    const fixtures = {
      JP: [{ artistName: '米津玄師', trackName: 'Lemon', primaryGenreName: 'J-Pop', releaseDate: '2018-02-27' }, { artistName: 'YOASOBI', trackName: 'アイドル', primaryGenreName: 'J-Pop', releaseDate: '2023-04-12' }],
      KR: [{ artistName: '아이유 (IU)', trackName: '좋은 날', primaryGenreName: 'K-Pop', releaseDate: '2010-12-09' }],
    };
    global.fetch = async (u) => { const q = new URL(u).searchParams; asked.push({ country: q.get('country'), term: q.get('term') }); return { ok: true, json: async () => ({ results: fixtures[q.get('country')] || [] }) }; };
    try {
      const store = new Map(); const sets = [];
      const cache = { get: (k) => store.get(k), set: (k, v) => { store.set(k, v); sets.push(k); } };
      const jp = await songs.songInfo('米津玄師 - Lemon', { cache, gate: async () => true, country: 'JP' });
      assert.strictEqual(jp.known, true); assert.deepStrictEqual(jp.info.genres, ['j-pop']); assert.strictEqual(jp.info.year, 2018);
      assert.strictEqual(asked[0].country, 'JP'); assert.strictEqual(jp.key, '米津玄師 - lemon'); assert.deepStrictEqual(sets, ['米津玄師 - lemon']);
      assert.strictEqual(songs.fitOf([{ key: 'tag:j-pop' }], jp.info), true); assert.strictEqual(songs.fitOf([{ key: 'rock' }], jp.info), false); assert.strictEqual(songs.fitOf([{ key: 'pop' }], jp.info), true);
      assert.strictEqual(songs.fitOf([{ key: 'tag:k-pop' }], jp.info), false);
      await songs.songInfo('米津玄師 - Lemon', { cache, gate: async () => true, country: 'JP' }); assert.strictEqual(asked.length, 1); // cached
      const kr = await songs.songInfo('아이유 - 좋은 날', { cache: new Map(), gate: async () => true, country: 'KR' });
      assert.strictEqual(kr.known, true); assert.deepStrictEqual(kr.info.genres, ['k-pop']); assert.strictEqual(asked[asked.length - 1].country, 'KR');
      assert.strictEqual((await songs.songInfo('YOASOBI／アイドル', { gate: async () => true, country: 'JP' })).known, true);
      const missing = await songs.songInfo('知らない歌手 - 知らない歌', { cache, gate: async () => true, country: 'JP' }); // not in the catalogue: remembered as unknown
      assert.strictEqual(missing.known, false); assert(store.has('知らない歌手 - 知らない歌') && store.get('知らない歌手 - 知らない歌') === null);
    } finally { global.fetch = realFetch; }
  });
  await t('China uses the Taiwan and Hong Kong stores then the default one, each request counts against the budget', async () => {
    const realFetch = global.fetch; const asked = [];
    global.fetch = async (u) => { const c = new URL(u).searchParams.get('country'); asked.push(c); return { ok: true, json: async () => ({ results: c === 'HK' ? [{ artistName: '周杰倫', trackName: '晴天', primaryGenreName: 'Mandopop', releaseDate: '2003-07-31' }] : [] }) }; };
    try {
      let budget = 5; const gate = async () => budget-- > 0;
      const r = await songs.songInfo('周杰倫 - 晴天', { gate, country: 'CN' });
      assert.deepStrictEqual(asked, ['TW', 'HK']); assert.strictEqual(r.known, true); assert.strictEqual(budget, 3);
      asked.length = 0; budget = 1;
      const limited = await songs.songInfo('王菲 - 红豆', { gate: async () => budget-- > 0, country: 'CN' }); // only one request allowed
      assert.deepStrictEqual(asked, ['TW']); assert.strictEqual(limited.known, false);
      asked.length = 0;
      await songs.songInfo('張學友 - 吻別', { gate: async () => true }); // no country: the default store
      assert.deepStrictEqual(asked, [null]);
    } finally { global.fetch = realFetch; }
  });

  /* ---------- Part 6: the scout's schedule ---------- */
  console.log('Scout schedule');
  await t("the scout runs at :17 and :47 (GitHub drops :00 and :30 runs under load) and can still be started by hand", () => {
    const y = read('.github/workflows/scout.yml');
    const cron = y.split('\n').filter((l) => /^\s*-\s*cron:/.test(l)).map((l) => l.replace(/^\s*-\s*cron:\s*/, '').replace(/['"]/g, '').trim());
    assert.deepStrictEqual(cron, ['17,47 * * * *']);
    assert(/workflow_dispatch:/.test(y) && !/\*\/30/.test(y.replace(/#.*$/gm, '')));
  });

  /* ---------- Part 7: WRONG GENRE? suggestions ---------- */
  console.log('Genre suggestions');
  const S = require('../public/suggest.js');
  const app = read('public/app.js');
  const catalog = new Function(`return [${app.split('const CATALOG = [')[1].split('\n  ];')[0]}]`)();
  const special = new Function(`return ${/const SPECIAL_LABELS = (\{.*\});/.exec(app)[1]}`)();
  const labelOf = (id) => { const x = id.slice(4); return special[x] || x.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()); };
  const names = (() => { const w = { window: {} }; new Function('window', read('public/genre-names.js'))(w.window); return w.window.GENRE_NAMES; })();
  const entries = S.buildEntries(catalog, labelOf, names);
  const ask = (q, n) => S.suggest(q, entries, n);
  await t('every genre and style in the app is suggestable, and nothing else (the server accepts exactly these keys)', () => {
    assert.deepStrictEqual(entries.map((e) => e.id).sort(), [...songs.ALL_KEYS].sort());
  });
  await t('dnb suggests Drum & Bass, retrowave suggests Synthwave, other names and translations work', () => {
    assert.strictEqual(ask('dnb')[0].id, 'tag:drum and bass'); assert.strictEqual(ask('dnb')[0].via, 'dnb'); assert.strictEqual(ask('dnb')[0].parent, 'Electronic');
    assert.strictEqual(ask('retrowave')[0].id, 'tag:synthwave');
    assert.strictEqual(ask('drum and')[0].id, 'tag:drum and bass'); assert.strictEqual(ask('drum & b')[0].id, 'tag:drum and bass');
    assert.strictEqual(ask('hip hop')[0].id, 'hiphop'); assert.strictEqual(ask('rnb')[0].id, 'tag:rnb');
    assert.strictEqual(ask('ジャズ')[0].id, 'jazz'); assert.strictEqual(ask('rock progresivo')[0].id, 'tag:progressive rock');
    assert.strictEqual(ask('  ROOTS  ')[0].id, 'tag:roots reggae');
  });
  await t('the parent genre comes with a style; prefix matches come before substring matches; at most 8', () => {
    const d = ask('dancehall')[0]; assert.deepStrictEqual([d.id, d.label, d.parent], ['tag:dancehall', 'Dancehall', 'Reggae & Ska']);
    assert.strictEqual(ask('rock')[0].id, 'rock'); assert.strictEqual(ask('rock')[0].parent, null);
    const metal = ask('metal').map((x) => x.id);
    assert.strictEqual(metal[0], 'metal'); assert(metal.indexOf('tag:metalcore') < metal.indexOf('tag:heavy metal')); // starts with it, then a word that does
    const wave = ask('wave').map((x) => x.label);
    assert(wave.includes('Synthwave') && wave.includes('Chillwave')); // inside a word: substring, last
    assert(ask('o', 20).length > 8 && ask('o').length === 8);
    assert.deepStrictEqual(ask(''), []); assert.deepStrictEqual(ask('zzzzqq'), []);
    for (const q of ['ro', 'ja', 'hou', 'trap', 'sam']) assert(ask(q).every((x) => songs.ALL_KEYS.includes(x.id)), q);
  });

  const generated = require('../scripts/gen-genre-names');
  await t('public/genre-names.js is up to date with TAG_ALIASES and the translations (run scripts/gen-genre-names.js)', () => {
    assert.strictEqual(read('public/genre-names.js'), generated.render());
  });

  // The feedback endpoint.
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://feedback-test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const realFetch = global.fetch;
  const posts = [];
  const mkRes = () => ({ headers: {}, setHeader() {}, end(b) { this.body = b ? JSON.parse(b) : null; } });
  const body = (over = {}) => ({ visitor: 'd0000000-0000-4000-8000-000000000001', genres: ['tag:dancehall', 'reggae'], song: 'A - B', station: { uuid: 'a0000000-0000-4000-8000-000000000001', name: 'X', city: 'Y', countryCode: 'JM', genre: 'reggae' }, ...over });
  const post = async (b, rejectSuggested = false) => {
    posts.length = 0;
    global.fetch = async (u, init = {}) => {
      const rows = init.body ? JSON.parse(init.body) : null;
      posts.push(rows);
      const refuse = rejectSuggested && rows && rows.some((r) => 'suggested' in r);
      return { ok: !refuse, status: refuse ? 400 : 201, json: async () => [], text: async () => '' };
    };
    delete require.cache[require.resolve('../api/feedback')];
    const res = mkRes(); await require('../api/feedback')({ method: 'POST', headers: {}, body: b }, res);
    return res;
  };
  await t('the feedback report carries the chosen genre on every row, only when it is a genre the app lists', async () => {
    let res = await post(body({ suggested: 'tag:dancehall' }));
    assert.strictEqual(res.statusCode, 204); assert.strictEqual(posts.length, 1); assert.strictEqual(posts[0].length, 2);
    assert(posts[0].every((r) => r.suggested === 'tag:dancehall' && r.status === 'pending'));
    res = await post(body({ suggested: 'reggae' })); assert(posts[0].every((r) => r.suggested === 'reggae'));
    for (const bad of ['tag:not a genre', 'dancehall', '', 7, null, { a: 1 }, 'x'.repeat(200)]) { await post(body({ suggested: bad })); assert(posts[0].every((r) => !('suggested' in r)), JSON.stringify(bad)); }
    await post(body()); assert(posts[0].every((r) => !('suggested' in r))); // skipped: no key at all, so it works before the migration
  });
  await t('before the migration (no suggested column) the report is saved again without it', async () => {
    const res = await post(body({ suggested: 'tag:dancehall' }), true);
    assert.strictEqual(res.statusCode, 204); assert.strictEqual(posts.length, 2);
    assert('suggested' in posts[0][0] && !('suggested' in posts[1][0])); assert.strictEqual(posts[1].length, 2);
  });
  global.fetch = realFetch;
  for (const [k, v] of [['SUPABASE_URL', saved.u], ['SUPABASE_SERVICE_ROLE_KEY', saved.k]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }

  console.log(failures ? `\n${failures} failed` : '\nAll genre tests passed');
  process.exit(failures ? 1 : 0);
})();
