// Offline tests: filters, title checks, and ICY parsing against local mock streams.
//   npm test
process.env.SW_ALLOW_PRIVATE = '1';
const assert = require('assert');
const http = require('http');
const net = require('net');
const { probeStream, isPrivateIp } = require('../lib/icy');
const { isMusicStation, looksLikeSong, splitTags, matchesGenre, resolveGenre, resolveGenres } = require('../lib/vet');

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  pass  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

// Builds an ICY body: metaint bytes of "audio", then a metadata block.
function icyBody(metaint, title) {
  const meta = Buffer.from(`StreamTitle='${title}';StreamUrl='';`, 'utf8');
  const len = Math.ceil(meta.length / 16);
  const block = Buffer.alloc(len * 16); meta.copy(block);
  return Buffer.concat([Buffer.alloc(metaint, 0xff), Buffer.from([len]), block, Buffer.alloc(metaint, 0xff)]);
}

(async () => {
  console.log('NESE IDs');
  const { formatNeseId, parseNeseId } = require('../lib/nese');
  await t('formats IDs with four digits', () => { assert.strictEqual(formatNeseId(0), 'NESE-0000'); assert.strictEqual(formatNeseId(42), 'NESE-0042'); assert.strictEqual(formatNeseId(12345), 'NESE-12345'); });
  await t('reads IDs the way people type them', () => {
    for (const [input, n] of [['NESE-0007', 7], ['nese 7', 7], ['#7', 7], ['0007', 7], ['  NESE-0000 ', 0], ['nese:12', 12]]) assert.strictEqual(parseNeseId(input), n, input);
  });
  await t('rejects things that are not IDs', () => { for (const bad of ['', 'abc', 'NESE-', '7a', 'NESE-12-3', null]) assert.strictEqual(parseNeseId(bad), null, String(bad)); });

  console.log('Filters');
  const { cityFromText } = require('../lib/geo');
  const where = (st, n, cc) => (cityFromText(st, n, cc) || {}).city || null;
  await t('places a station by its listed region', () => { assert.strictEqual(where('Hamburg', 'Synth FM', 'DE'), 'Hamburg'); assert.strictEqual(where('New York', 'Hot 97', 'US'), 'New York City'); });
  await t('places a station by a big city in its name', () => { assert.strictEqual(where('', 'Radio Kraków Muzyka', 'PL'), 'Kraków'); assert.strictEqual(where('', 'Mexico City Synth', 'MX'), 'Mexico City'); });
  await t('does not place stations from ordinary words or other countries', () => {
    for (const [st, n, cc] of [['', 'Paradise FM', 'US'], ['', 'Love Radio', 'PH'], ['Bavaria', 'Radio Bob', 'DE'], ['', 'Radio Lyon', 'DE'], ['', 'Radio Lyon', '']]) assert.strictEqual(where(st, n, cc), null, n);
  });
  const { translateTags } = require('../lib/translate');
  const tr = (x) => translateTags(splitTags(x));
  await t('foreign tags count as music and match genres', () => {
    assert(isMusicStation(tr('ロック,邦楽'))); assert(matchesGenre(tr('ロック'), resolveGenre('rock')));
    assert(matchesGenre(tr('música electrónica'), resolveGenre('electronic')));
    assert(matchesGenre(tr('アニソン'), resolveGenre(null, 'j-pop')));
    assert(matchesGenre(tr('메탈'), resolveGenre('metal')));
  });
  await t('foreign talk, news, sport and religious stations stay blocked', () => {
    for (const x of ['noticias,música', 'ニュース,音楽', 'новости', 'deportes,futbol', 'música cristiana', '교회,음악']) assert(!isMusicStation(tr(x)), x);
  });
  await t('translation leaves unrelated tags alone', () => { assert(!tr('host,ghost').includes('soundtrack')); assert.deepStrictEqual(tr('house,techno'), ['house', 'techno']); });
  const { isFocused } = require('../lib/vet');
  await t('genre focus: real classic rock stations pass', () => {
    const cr = resolveGenre(null, 'classic rock');
    assert(isFocused(['classic rock', '70s', '80s'], 'Rock Radio', cr));
    assert(isFocused(['70s', '80s', 'hard rock', 'classic rock', 'blues rock'], 'KZ', cr));
    assert(isFocused(['pop', 'classic rock'], 'X', cr));
    assert(isFocused(['hits', 'pop', 'oldies', 'classic rock'], 'Classic Rock 101', cr));
  });
  await t('genre focus: hits and variety stations tagged classic rock are skipped', () => {
    const cr = resolveGenre(null, 'classic rock');
    assert(!isFocused(['pop', '80s', '90s', 'hits', 'top 40', 'dance', 'classic rock', 'oldies'], 'Hit FM', cr));
    assert(!isFocused(['classic rock', 'pop', 'hip-hop', 'jazz', 'country'], 'Mix', cr));
    assert(!isFocused(['hits', 'pop', 'classic rock'], 'Antenne', cr));
    assert(isFocused(['pop', 'hits', 'dance'], 'Anything', null)); // Any genre stays broad
  });
  {
    const { songFits } = require('../lib/songcheck');
    const realFetch = global.fetch;
    const catalog = {
      'Led Zeppelin Kashmir': [{ artistName: 'Led Zeppelin', trackName: 'Kashmir (Remaster)', primaryGenreName: 'Rock', releaseDate: '2014-02-01' }, { artistName: 'Led Zeppelin', trackName: 'Kashmir', primaryGenreName: 'Rock', releaseDate: '1975-02-24' }],
      'Dua Lipa Levitating': [{ artistName: 'Dua Lipa', trackName: 'Levitating', primaryGenreName: 'Pop', releaseDate: '2020-03-27' }],
      'Arctic Monkeys Do I Wanna Know?': [{ artistName: 'Arctic Monkeys', trackName: 'Do I Wanna Know?', primaryGenreName: 'Alternative', releaseDate: '2013-06-19' }],
      'Burna Boy Last Last': [{ artistName: 'Burna Boy', trackName: 'Last Last', primaryGenreName: 'Afrobeats', releaseDate: '2022-05-13' }],
    };
    global.fetch = async (u) => {
      const term = new URL(u).searchParams.get('term');
      if (term.startsWith('Down')) throw new Error('offline');
      return { ok: true, json: async () => ({ results: catalog[term] || [] }) };
    };
    const cr = resolveGenre(null, 'classic rock'), rock = resolveGenre('rock'), pop = resolveGenre('pop');
    await t('song check: classic rock song fits classic rock (original year, not the remaster)', async () => assert.strictEqual(await songFits('Led Zeppelin - Kashmir', cr), true));
    await t('song check: pop song on a classic rock pick is rejected', async () => assert.strictEqual(await songFits('Dua Lipa - Levitating', cr), false));
    await t('song check: 2013 rock fits Rock but not Classic Rock', async () => {
      assert.strictEqual(await songFits('Arctic Monkeys - Do I Wanna Know?', rock), true);
      assert.strictEqual(await songFits('Arctic Monkeys - Do I Wanna Know?', cr), false);
    });
    await t('song check: several genres picked, fitting one is enough', async () => assert.strictEqual(await songFits('Dua Lipa - Levitating', resolveGenres('rock,pop')), true));
    await t('song check: unknown songs, failed lookups and broad genres never reject', async () => {
      assert.strictEqual(await songFits('Nobody Known - Nothing', cr), null);
      assert.strictEqual(await songFits('Down Service - Song', cr), null);
      assert.strictEqual(await songFits('Burna Boy - Last Last', resolveGenre('world')), null);
      assert.strictEqual(await songFits('Station jingle', pop), null);
    });
    global.fetch = realFetch;
  }
  {
    const { noteSong, localWeight, pickLocal } = require('../lib/artistcheck');
    const realFetch = global.fetch;
    const mb = { 'the pillows': 'JP', 'led zeppelin': 'GB', 'blankey jet city': 'JP' };
    global.fetch = async (u) => {
      const name = /artist:"([^"]+)"/.exec(decodeURIComponent(new URL(u).searchParams.get('query')))[1];
      return { ok: true, json: async () => ({ artists: mb[name] ? [{ name, score: 100, country: mb[name] }] : [] }) };
    };
    await t('local artists: a Japanese band on a Tokyo station counts as local, a British one doesn\'t', async () => {
      assert.strictEqual(await noteSong('st-local', 'JP', 'the pillows - Funny Bunny'), true);
      assert.strictEqual(await noteSong('st-mixed', 'JP', 'Led Zeppelin - Kashmir'), false);
      assert.strictEqual(await noteSong('st-mixed', 'JP', 'Blankey Jet City - Akai Tambourine'), true);
      assert.strictEqual(await noteSong('st-x', 'JP', 'Unknown Band - Song'), null);
    });
    await t('local artists: picks lean local but mixed and unknown stations still come up', () => {
      assert(localWeight('st-local') > localWeight('st-mixed'));
      assert(localWeight('st-mixed') > 1);
      const n = { 'st-local': 0, 'st-mixed': 0, 'st-new': 0 };
      for (let i = 0; i < 3000; i++) n[pickLocal([{ uuid: 'st-local' }, { uuid: 'st-mixed' }, { uuid: 'st-new' }]).uuid]++;
      assert(n['st-local'] > n['st-mixed'] && n['st-mixed'] > 300 && n['st-new'] > 300, JSON.stringify(n));
    });
    global.fetch = realFetch;
  }
  await t('genre words: styles in many languages match, and the longest word wins', () => {
    const { translateTags } = require('../lib/translate');
    const m = (tag, main, style) => matchesGenre(translateTags(splitTags(tag)), resolveGenre(main || null, style));
    assert(m('クラシックロック', null, 'classic rock')); assert(!m('クラシックロック', 'classical'));
    assert(m('классический рок', null, 'classic rock')); assert(!m('классический рок', 'classical'));
    assert(m('ヘヴィメタル', null, 'heavy metal')); assert(m('rock progresivo', null, 'progressive rock'));
    assert(m('anos 80', null, '80s')); assert(m('liedermacher', null, 'singer-songwriter'));
    assert(!m('サイケデリックトランス', null, 'psychedelic rock')); assert(m('サイケデリックトランス', null, 'psytrance'));
    assert(m('música mexicana', 'latin')); assert(m('ボサノヴァ', 'jazz')); assert(m('sertanejo', 'country'));
    assert(!m('スカイ', null, 'ska')); assert(!m('dansk', 'electronic'));
  });
  await t('genre words: country searches use the local language', () => {
    const { nativeWords } = require('../lib/genre-words');
    assert.strictEqual(nativeWords('psychedelic rock', 'JP')[0], 'サイケ');
    assert.strictEqual(nativeWords('heavy metal', 'RU')[0], 'хэви-метал');
    assert.strictEqual(nativeWords('rock', 'JP')[0], 'ロック');
    assert.deepStrictEqual(nativeWords('jazz', 'GB'), []);
  });
  await t('music station passes', () => assert(isMusicStation(splitTags('house,techno,dance'))));
  await t('talk station rejected', () => assert(!isMusicStation(splitTags('news,talk,pop'))));
  await t('sports rejected', () => assert(!isMusicStation(splitTags('sports,rock'))));
  await t('untagged rejected', () => assert(!isMusicStation(splitTags(''))));
  await t('no music tag rejected', () => assert(!isMusicStation(splitTags('community,local'))));
  await t('styles match their other names', () => {
    const sw = resolveGenre(null, 'synthwave');
    assert(matchesGenre(splitTags('retrowave,80s'), sw) && matchesGenre(splitTags('outrun'), sw));
    assert(matchesGenre(splitTags('dnb'), resolveGenre(null, 'drum and bass')));
    assert(!matchesGenre(splitTags('classic rock'), sw));
  });
  await t('station-count styles match the app genre list', () => {
    const fs = require('fs');
    const app = fs.readFileSync(require('path').join(__dirname, '../public/app.js'), 'utf8');
    const api = fs.readFileSync(require('path').join(__dirname, '../lib/config.js'), 'utf8');
    const appList = Object.fromEntries([...app.matchAll(/\{ id: '(\w+)', label: '[^']*', subs: \[([^\]]*)\] \}/g)].map((m) => [m[1], m[2]]));
    const apiList = Object.fromEntries([...api.split('const STYLES = {')[1].split('};')[0].matchAll(/ {2}(\w+): \[([^\]]*)\],/g)].map((m) => [m[1], m[2]]));
    assert.deepStrictEqual(Object.keys(apiList).sort(), Object.keys(appList).sort());
    for (const k of Object.keys(appList)) assert.strictEqual(apiList[k], appList[k], k);
  });
  await t('metal is its own genre', () => { const m = resolveGenre('metal'); assert(m && matchesGenre(splitTags('doom metal,stoner'), m)); assert(!matchesGenre(splitTags('classic rock'), m)); });
  await t('sub-genre tags pass the music check', () => assert(isMusicStation(splitTags('black metal'))));
  await t('genre match', () => assert(matchesGenre(splitTags('deep house,lounge'), resolveGenre('electronic'))));
  await t('genre mismatch', () => assert(!matchesGenre(splitTags('jazz'), resolveGenre('rock'))));
  await t('sub-genre tag resolves', () => assert.deepStrictEqual(resolveGenre(null, 'Deep  House').tags, ['deep house', 'deephouse']));
  await t('bad tag ignored', () => assert.strictEqual(resolveGenre(null, '<script>'), null));
  await t('sub-genre match', () => assert(matchesGenre(splitTags('shoegaze,dream pop'), resolveGenre(null, 'shoegaze'))));
  await t('niche tag counts as music when requested', () => {
    assert(!isMusicStation(splitTags('shoegaze')));
    assert(isMusicStation(splitTags('shoegaze'), ['shoegaze']));
  });
  await t('several genres combine', () => {
    const s = resolveGenres('jazz,tag:deep house,jazz,nonsense');
    assert.strictEqual(s.parts.length, 2);
    assert(matchesGenre(splitTags('deep house'), s) && matchesGenre(splitTags('bebop,jazz'), s));
    assert(!matchesGenre(splitTags('metal'), s));
  });
  await t('one genre in the list stays simple', () => assert.strictEqual(resolveGenres('rock').key, 'rock'));
  await t('empty list means any', () => assert.strictEqual(resolveGenres(''), null));
  await t('at most five genres', () => assert.strictEqual(resolveGenres('rock,pop,jazz,latin,world,classical').parts.length, 5));
  await t('same genres, same pool key', () => assert.strictEqual(resolveGenres('rock,jazz').key, resolveGenres('jazz,rock').key));
  await t('talk still blocked with a requested tag', () => assert(!isMusicStation(splitTags('shoegaze,talk'), ['shoegaze'])));

  console.log('Song titles');
  await t('artist - title ok', () => assert(looksLikeSong('Daft Punk - Around the World', 'Radio X')));
  await t('Japanese title formats ok', () => {
    for (const x of ['夜に駆ける / YOASOBI', '米津玄師「Lemon」', 'あいみょん／マリーゴールド', 'Perfume - ポリリズム']) assert(looksLikeSong(x, 'FM'), x);
  });
  await t('slogans still rejected', () => { assert(!looksLikeSong('Rock / Pop / Dance', 'FM')); assert(!looksLikeSong('東京ラジオ', 'FM')); });
  await t('Shift-JIS titles decode as Japanese', () => {
    const { decodeMeta } = require('../lib/icy');
    const sj = Buffer.from([0x83,0x8c,0x83,0x82,0x83,0x93,0x20,0x2f,0x20,0x95,0xc4,0x92,0xc3,0x8c,0xba,0x8e,0x74]); // レモン / 米津玄師
    assert.strictEqual(decodeMeta(sj), 'レモン / 米津玄師');
    assert.strictEqual(decodeMeta(Buffer.from('Björk - Jóga', 'latin1')), 'Björk - Jóga');
  });
  await t('en dash ok', () => assert(looksLikeSong('Björk – Hyperballad', 'FM')));
  await t('station name rejected', () => assert(!looksLikeSong('Radio X', 'Radio X')));
  await t('slogan without separator rejected', () => assert(!looksLikeSong('The best hits all day', 'Hits FM')));
  await t('ad marker rejected', () => assert(!looksLikeSong('Advert - Break', 'Hits FM')));
  await t('empty rejected', () => assert(!looksLikeSong('', 'Hits FM')));

  console.log('Safety');
  await t('private IPs blocked', () => ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1'].forEach((ip) => assert(isPrivateIp(ip), ip)));
  await t('public IP allowed', () => assert(!isPrivateIp('8.8.8.8')));

  console.log('Stream probes');
  const server = http.createServer((req, res) => {
    const want = req.headers['icy-metadata'] === '1';
    if (req.url === '/song') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': want ? '8192' : undefined, 'icy-br': '128', 'Access-Control-Allow-Origin': '*' });
      return res.end(want ? icyBody(8192, "Daft Punk - Around the World") : Buffer.alloc(9000));
    }
    if (req.url === '/latin1') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '1000' });
      const meta = Buffer.from("StreamTitle='Sigur Rós - Hoppípolla';", 'latin1');
      const len = Math.ceil(meta.length / 16); const block = Buffer.alloc(len * 16); meta.copy(block);
      return res.end(Buffer.concat([Buffer.alloc(1000), Buffer.from([len]), block]));
    }
    if (req.url === '/nometa') { res.writeHead(200, { 'Content-Type': 'audio/aac' }); return res.end(Buffer.alloc(5000)); }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/song' }); return res.end(); }
    if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>'); }
    if (req.url === '/slow') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(10)); }, 6000); return; }
    res.writeHead(404); res.end();
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  // Old SHOUTcast servers answer with "ICY 200 OK" instead of an HTTP status line.
  const icy = net.createServer((sock) => {
    sock.once('data', () => {
      sock.write('ICY 200 OK\r\ncontent-type: audio/mpeg\r\nicy-metaint: 4096\r\nicy-br: 96\r\n\r\n');
      sock.end(icyBody(4096, 'Massive Attack - Teardrop'));
    });
  }).listen(0);
  const icyBase = `http://127.0.0.1:${icy.address().port}`;

  await t('reads StreamTitle', async () => {
    const p = await probeStream(`${base}/song`);
    assert.strictEqual(p.ok, true); assert.strictEqual(p.title, 'Daft Punk - Around the World');
    assert.strictEqual(p.cors, true); assert.strictEqual(p.bitrate, 128);
  });
  await t('decodes Latin-1 titles', async () => assert.strictEqual((await probeStream(`${base}/latin1`)).title, 'Sigur Rós - Hoppípolla'));
  await t('no metadata gives null title', async () => { const p = await probeStream(`${base}/nometa`); assert(p.ok); assert.strictEqual(p.title, null); });
  await t('follows redirects', async () => assert.strictEqual((await probeStream(`${base}/redirect`)).title, 'Daft Punk - Around the World'));
  await t('rejects HTML pages', async () => assert(!(await probeStream(`${base}/html`)).ok));
  await t('rejects slow streams (4s)', async () => { const p = await probeStream(`${base}/slow`); assert(!p.ok); assert.strictEqual(p.reason, 'slow'); });
  await t('handles "ICY 200 OK" servers', async () => {
    const p = await probeStream(icyBase);
    assert(p.ok, p.reason); assert.strictEqual(p.title, 'Massive Attack - Teardrop');
  });
  await t('blocks private hosts in production mode', async () => {
    process.env.SW_ALLOW_PRIVATE = '0';
    const p = await probeStream(`${base}/song`);
    process.env.SW_ALLOW_PRIVATE = '1';
    assert(!p.ok);
  });

  server.close(); icy.close();
  console.log(failures ? `\n${failures} failed` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
})();
