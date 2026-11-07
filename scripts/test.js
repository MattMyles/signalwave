// Offline tests: filters, title checks, and ICY parsing against local mock streams.
//   npm test
process.env.SW_ALLOW_PRIVATE = '1';
const assert = require('assert');
const http = require('http');
const net = require('net');
const { probeStream, isPrivateIp } = require('../lib/icy');
const { isMusicStation, looksLikeSong, splitTags, matchesGenre, resolveGenre } = require('../lib/vet');

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
  console.log('Filters');
  await t('music station passes', () => assert(isMusicStation(splitTags('house,techno,dance'))));
  await t('talk station rejected', () => assert(!isMusicStation(splitTags('news,talk,pop'))));
  await t('sports rejected', () => assert(!isMusicStation(splitTags('sports,rock'))));
  await t('untagged rejected', () => assert(!isMusicStation(splitTags(''))));
  await t('no music tag rejected', () => assert(!isMusicStation(splitTags('community,local'))));
  await t('genre match', () => assert(matchesGenre(splitTags('deep house,lounge'), resolveGenre('electronic'))));
  await t('genre mismatch', () => assert(!matchesGenre(splitTags('jazz'), resolveGenre('rock'))));
  await t('sub-genre tag resolves', () => assert.deepStrictEqual(resolveGenre(null, 'Deep  House').tags, ['deep house']));
  await t('bad tag ignored', () => assert.strictEqual(resolveGenre(null, '<script>'), null));
  await t('sub-genre match', () => assert(matchesGenre(splitTags('shoegaze,dream pop'), resolveGenre(null, 'shoegaze'))));
  await t('niche tag counts as music when requested', () => {
    assert(!isMusicStation(splitTags('shoegaze')));
    assert(isMusicStation(splitTags('shoegaze'), ['shoegaze']));
  });
  await t('talk still blocked with a requested tag', () => assert(!isMusicStation(splitTags('shoegaze,talk'), ['shoegaze'])));

  console.log('Song titles');
  await t('artist - title ok', () => assert(looksLikeSong('Daft Punk - Around the World', 'Radio X')));
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
