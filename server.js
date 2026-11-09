// Local dev server: serves /public and the /api functions on one port.
//   node server.js   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const routes = {
  '/api/next': require('./api/next'),
  '/api/nowplaying': require('./api/nowplaying'),
  '/api/config': require('./api/config'),
  '/api/keepalive': require('./api/keepalive'),
  '/api/track': require('./api/track'),
  '/api/station': require('./api/station'),
  '/api/admin-stats': require('./api/admin-stats'),
  '/api/nese': require('./api/nese'),
  '/api/genre-counts': require('./api/genre-counts'),
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.geojson': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (routes[pathname]) return routes[pathname](req, res);
  const page = pathname === '/' ? 'index.html' : pathname === '/admin' ? 'admin.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, page));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log(`Signal Wave on http://localhost:${PORT}`));
