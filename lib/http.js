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
module.exports = { query, sendJson };
