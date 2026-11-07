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
| `api/config.js` | Tells the app whether sync is set up (reads Vercel env vars) |
| `api/keepalive.js` | Daily ping that stops the free Supabase project pausing |
| `supabase/migrations/` | The `user_settings` table and its per-user access rules |
| `public/vendor/supabase.js` | Supabase browser client 2.118.0 (loaded only when sync is on) |
| `scripts/test.js` | Offline tests: `npm test` |

## Sign-in and sync (optional, Supabase)

Without this setup the app works the same, with everything saved on each device only.
With it, a **Sync across devices** section appears at the bottom of the Saved panel.

1. **Create the table.** If the Supabase GitHub integration deploys migrations,
   `supabase/migrations/…_user_settings.sql` is applied when you push to the
   production branch. Otherwise open Supabase → SQL Editor, paste that file, and run it.
2. **Put the code in the sign-in email.** Supabase → Authentication → Emails →
   *Magic Link* template. Add the code, for example:
   `<p>Your Signal Wave code: <strong>{{ .Token }}</strong></p>`
   (A code works inside the iPhone home-screen app; a link would open Safari instead.)
3. **Set the site address.** Authentication → URL Configuration → Site URL =
   your Vercel address.
4. **Give Vercel the keys.** Vercel → Settings → Environment Variables:
   - `SUPABASE_URL` = Project URL (Supabase → Project Settings → API)
   - `SUPABASE_ANON_KEY` = the **anon / publishable** key
   Never use the `service_role` / secret key here. Redeploy afterwards.
5. **Keep-alive.** `vercel.json` runs `/api/keepalive` once a day so the free
   Supabase project never pauses for inactivity.

Supabase's built-in email sender only allows a few emails per hour. That's
fine for you and a few friends; for more people, add a custom SMTP sender
(Authentication → Emails → SMTP settings).

## Genres

Tap **+ EDIT** at the end of the genre row to remove genres or add sub-genres.
The list is saved in the browser. To add sub-genres to the menu, edit `CATALOG` in
`public/app.js`; main genres and their tags live in `lib/config.js`.

## Link previews and icons

`public/og-image.png` is the card shown when the link is pasted into Messages,
WhatsApp, Slack and so on. On deploy, `npm run build` (scripts/build-meta.js)
fills in the site's full address, which iMessage needs. If you add a custom
domain, set `SITE_URL` in Vercel to it so previews use that address.
iMessage caches previews, so a link pasted before an update may keep the old look.

## Keyboard

`N` or `→` next station · `P` or `←` previous station · `Space` play/pause · `F` save · `Esc` close saved list

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
