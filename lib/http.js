// Tiny helpers so the handlers run the same on Vercel and in server.js.
function query(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}
function sendJson(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store');
  res.end(JSON.stringify(body));
}
// Reads a small JSON request body (Vercel pre-parses it; server.js doesn't).
async function readJson(req, limit = 4096) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return null; } }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) return null;
  }
  try { return JSON.parse(raw || 'null'); } catch (_) { return null; }
}
function bearer(req) {
  const h = req.headers.authorization || '';
  return /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : '';
}
module.exports = { query, sendJson, readJson, bearer };
