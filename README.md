# Signal Wave

Random live music radio from a random city on Earth, on a neon globe.

Every station is checked before it plays: it must be music (no talk, news or
sports tags), have a city, start streaming within 4 seconds, and send real
song titles. Stations that pass are cached per genre so later picks are fast.

## Run it on your Mac

Needs Node 18 or newer (`node -v`). No packages to install.

```bash
cd signal-wave
node server.js
```

Open http://localhost:3000. To try it on your phone, open
`http://<your-mac's-ip>:3000` on the same Wi-Fi (the service worker and
install-to-home-screen only work over HTTPS, so use a deploy for that).

The first station can take 5–15 seconds while the server checks candidates;
after that, two vetted stations are kept queued so NEXT is quick.

## Deploy (free) on Vercel

```bash
npm i -g vercel
cd signal-wave
vercel          # preview deploy
vercel --prod   # production
```

`public/` is served as static files and `api/next.js` and `api/nowplaying.js`
become serverless functions. Netlify or Cloudflare would need small wrappers
around the two handlers.

## Project layout

| Path | What it does |
| --- | --- |
| `public/index.html`, `styles.css`, `app.js` | The app: globe, HUD, player, genres, saved stations |
| `public/vendor/` | globe.gl 2.46.1 and a world map (bundled, no CDN) |
| `public/sw.js`, `manifest.webmanifest`, `icon.svg` | Installable PWA |
| `api/next.js` | Returns one vetted station: `/api/next?genre=jazz` or `?tag=deep%20house` (a sub-genre) |
| `api/nowplaying.js` | Current song title: `/api/nowplaying?uuid=…` |
| `lib/config.js` | **Tune here:** genre → tag map, talk blocklist, timeouts |
| `lib/vet.js` | The five station checks and the per-genre cache |
| `lib/icy.js` | Reads ICY song titles from streams (handles old SHOUTcast servers) |
| `lib/radio.js` | Radio Browser API client with mirror failover |
| `lib/geo.js` | City lookup via OpenStreetMap Nominatim (rate-limited, cached) |
| `scripts/test.js` | Offline tests: `npm test` |

## Genres

Tap **+ EDIT** at the end of the genre row to remove genres or add sub-genres.
The list is saved in the browser. To add sub-genres to the menu, edit `CATALOG` in
`public/app.js`; main genres and their tags live in `lib/config.js`.

## Keyboard

`N` or `→` next station · `Space` play/pause · `F` save · `Esc` close saved list

## Notes

- The station cache lives in server memory, so it resets when a serverless
  instance goes cold. For a shared, longer-lived pool, swap the `pools` Map in
  `lib/vet.js` for Vercel KV or Upstash Redis.
- HLS (`.m3u8`) streams are skipped, because they don't carry ICY song titles.
- The song-title endpoint only accepts station IDs, not URLs, and refuses
  private network addresses.
- If a playing station stops sending titles for 3 checks (~75 s), stalls for
  8 s, or repeats one title for 15 minutes, the app moves to the next station.
- "Not music? Hide station" remembers hidden stations in the browser.
- Before going public, change `USER_AGENT` in `lib/config.js` to include your
  site URL; Nominatim and Radio Browser both ask for an identifying agent.
