// Runs on Vercel at deploy time (npm run build). Link-preview crawlers such as
// iMessage need full addresses for og:image and og:url, so this swaps the
// relative ones in public/index.html for this deployment's real address.
// Set SITE_URL in Vercel to force a specific address (e.g. a custom domain).
// It never fails the deploy: if no address is known, it leaves the file alone.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'index.html');
const raw = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
const site = raw ? (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/$/, '') : '';

try {
  if (!site) {
    console.log('build-meta: no site address in the environment; leaving link-preview tags relative.');
    process.exit(0);
  }
  const html = fs.readFileSync(file, 'utf8')
    .replace(/(<meta (?:property|name)="(?:og:image|twitter:image)" content=")\/([^"]*)"/g, `$1${site}/$2"`)
    .replace(/(<meta property="og:url" content=")\/"/, `$1${site}/"`);
  fs.writeFileSync(file, html);
  console.log(`build-meta: link previews point at ${site}`);
} catch (e) {
  console.log('build-meta: skipped,', e.message);
}
