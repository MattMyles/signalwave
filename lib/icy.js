// Opens a radio stream, checks it is alive, and reads the ICY "StreamTitle"
// (the now-playing song) from the metadata the server interleaves with audio.
const tls = require('tls');
const dns = require('dns');
const net = require('net');
const { USER_AGENT, LIMITS } = require('./config');

// Refuse private, loopback and link-local addresses so the function can't be
// pointed at internal services.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// Japanese text (hiragana or katakana), to recognise a real Shift-JIS decode.
const KANA = /[\u3040-\u30ff]/g;
let sjis = null;
try { sjis = new TextDecoder('shift_jis', { fatal: true }); } catch (_) { /* no ICU data */ }

function decodeMeta(buf) {
  const utf = buf.toString('utf8');
  if (!utf.includes('\ufffd')) return utf;
  // Many Japanese servers send Shift-JIS. Accept it only when it decodes
  // cleanly into real Japanese (some kana), so Latin-1 titles aren't misread.
  if (sjis) {
    try {
      const jp = sjis.decode(buf);
      if ((jp.match(KANA) || []).length >= 2) return jp;
    } catch (_) { /* not Shift-JIS */ }
  }
  // Many old servers send Latin-1; fall back when UTF-8 decoding produced junk.
  return buf.toString('latin1');
}

function parseStreamTitle(meta) {
  const m = /StreamTitle='(.*?)';(?:\s*Stream|\s*$|\0)/s.exec(meta) || /StreamTitle='(.*?)';/s.exec(meta);
  if (!m) return null;
  return m[1].replace(/\0/g, '').replace(/\s+/g, ' ').trim();
}

const allowPrivate = () => process.env.SW_ALLOW_PRIVATE === '1';

// Resolves the host and refuses private addresses. Connecting to the address
// we checked (not the name) also stops DNS-rebinding tricks.
async function resolveSafe(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const address = net.isIP(host) ? host : (await dns.promises.lookup(host)).address;
  if (isPrivateIp(address) && !allowPrivate()) throw new Error('blocked-private-address');
  return address;
}

/**
 * probeStream(url) → { ok, status, contentType, bitrate, cors, metaint, title, reason }
 * ok means audio bytes arrived in time. title is null when the stream sends
 * no ICY metadata. Uses a raw socket because many SHOUTcast servers answer
 * "ICY 200 OK", which Node's HTTP parser rejects.
 */
async function probeStream(url, { redirects = 3 } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { return { ok: false, reason: 'bad-url' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: 'bad-protocol' };
  const secure = parsed.protocol === 'https:';
  const port = Number(parsed.port) || (secure ? 443 : 80);

  let address;
  try { address = await resolveSafe(parsed.hostname); } catch (e) { return { ok: false, reason: e.message }; }

  const result = await new Promise((resolve) => {
    let settled = false;
    let partial = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(firstByteTimer); clearTimeout(totalTimer);
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(r);
    };
    const firstByteTimer = setTimeout(() => done({ ok: false, reason: 'slow' }), LIMITS.firstByteMs);
    const totalTimer = setTimeout(() => done(partial || { ok: false, reason: 'timeout' }), LIMITS.probeTotalMs);

    const sock = secure
      ? tls.connect({ host: address, port, servername: net.isIP(parsed.hostname) ? undefined : parsed.hostname })
      : net.connect({ host: address, port });

    sock.on('error', (e) => done(partial || { ok: false, reason: `error:${e.code || e.message}` }));
    sock.on(secure ? 'secureConnect' : 'connect', () => {
      sock.write(
        `GET ${parsed.pathname || '/'}${parsed.search} HTTP/1.0\r\n` +
        `Host: ${parsed.host}\r\nUser-Agent: ${USER_AGENT}\r\nIcy-MetaData: 1\r\nAccept: */*\r\nConnection: close\r\n\r\n`
      );
    });

    let head = Buffer.alloc(0);
    let base = null;
    let body = 0;
    let audioLeft = 0;
    let metaLen = -1;
    const metaChunks = [];
    let metaGot = 0;

    function onBody(chunk) {
      body += chunk.length;
      partial = base;
      if (!base.metaint) return done(base);
      let i = 0;
      while (i < chunk.length) {
        if (audioLeft > 0) {
          const take = Math.min(audioLeft, chunk.length - i);
          audioLeft -= take; i += take;
        } else if (metaLen < 0) {
          metaLen = chunk[i] * 16; i += 1;
          if (metaLen === 0) { audioLeft = base.metaint; metaLen = -1; }
        } else {
          const take = Math.min(metaLen - metaGot, chunk.length - i);
          metaChunks.push(chunk.subarray(i, i + take));
          metaGot += take; i += take;
          if (metaGot >= metaLen) return done({ ...base, title: parseStreamTitle(decodeMeta(Buffer.concat(metaChunks))) });
        }
      }
      if (body > LIMITS.maxProbeBytes) done(base);
    }

    sock.on('data', (chunk) => {
      if (base) return onBody(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > 16384) done({ ok: false, reason: 'bad-headers' }); return; }
      const lines = head.subarray(0, end).toString('latin1').split('\r\n');
      const m = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i.exec(lines[0]);
      if (!m) return done({ ok: false, reason: 'bad-status-line' });
      const status = Number(m[1]);
      const h = {};
      for (const line of lines.slice(1)) {
        const k = line.indexOf(':');
        if (k > 0) h[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim();
      }
      if ([301, 302, 303, 307, 308].includes(status) && h.location) {
        return done({ redirect: new URL(h.location, parsed).toString() });
      }
      if (status !== 200) return done({ ok: false, reason: `http-${status}` });
      const contentType = (h['content-type'] || '').toLowerCase();
      if (/text\/html|application\/json|mpegurl|x-scpls|text\/plain/.test(contentType)) {
        return done({ ok: false, reason: `not-audio:${contentType}` });
      }
      clearTimeout(firstByteTimer);
      base = {
        ok: true, status, contentType,
        bitrate: parseInt(h['icy-br'], 10) || null,
        cors: Boolean(h['access-control-allow-origin']),
        metaint: parseInt(h['icy-metaint'], 10) || 0,
        title: null,
      };
      audioLeft = base.metaint;
      const rest = head.subarray(end + 4);
      if (rest.length) onBody(rest);
      else if (!base.metaint) done(base);
    });
    sock.on('end', () => done(partial || { ok: false, reason: 'ended' }));
  });

  if (result.redirect) {
    if (redirects <= 0) return { ok: false, reason: 'too-many-redirects' };
    return probeStream(result.redirect, { redirects: redirects - 1 });
  }
  return result;
}

module.exports = { probeStream, parseStreamTitle, decodeMeta, isPrivateIp };
