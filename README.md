# Neo Earth Radio

neoearthradio.com · formerly "Signal Wave" (the repo, Vercel and Supabase projects keep that name).
To rename again, see [docs/RENAMING.md](docs/RENAMING.md).

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
| `api/next.js` | Returns one vetted station: `/api/next?genres=jazz,tag:deep%20house` (up to 5) |
| `api/nowplaying.js` | Current song title: `/api/nowplaying?uuid=…` |
| `lib/config.js` | **Tune here:** genre → tag map, talk blocklist, timeouts |
| `lib/vet.js` | The five station checks and the per-genre cache |
| `lib/icy.js` | Reads ICY song titles from streams (handles old SHOUTcast servers) |
| `lib/radio.js` | Radio Browser API client with mirror failover |
| `lib/geo.js` | Offline city lookup from `lib/cities.json` (no outside service) |
| `api/config.js` | Tells the app whether sync is set up (reads Vercel env vars) |
| `api/keepalive.js` | Daily ping that stops the free Supabase project pausing |
| `api/station.js` | Looks up one station for a shared link |
| `api/track.js` | Records a play after 30 s of listening (server-only key) |
| `api/admin-stats.js` | Dashboard numbers, for ADMIN_EMAILS only |
| `api/nese.js` | NESE member IDs and station transmissions between members |
| `public/admin.html`, `admin.js` | The private dashboard page at `/admin` |
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
   `<p>Your Neo Earth Radio code: <strong>{{ .Token }}</strong></p>`
   (or paste the full styled template, `supabase/templates/magic_link.html`, with the subject
   "Welcome to the Neo//Earth Signal Engineers Corps // code {{ .Token }}")
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

## Discovery rules

- Random play never repeats a station this device has heard (up to the last
  6,000). Saving a station is how you go back to it. If a genre has nothing new
  left, the app plays a repeat and says so.
- Styles also match the other names stations use (e.g. synthwave also finds
  retrowave, outrun and darksynth): `TAG_ALIASES` in `lib/config.js`.
- Streams must be at least 64 kbps (40 kbps for AAC) when they report a bitrate.
  Run `supabase/migrations/20261109070000_low_quality_check.sql` so the dashboard
  can count these rejections.

## NESE member IDs

Signed-in users become NESE members with an ID (NESE-0000 for the first email in
`ADMIN_EMAILS`, then NESE-0001, NESE-0002, …). Members see a NESE Dashboard with
their ID badge, can transmit a saved station to another member's ID, and get
received stations in Incoming Transmissions. Only IDs are shown, never emails.

Setup: run `supabase/migrations/20261108070000_nese_members.sql` (automatic with
the Supabase GitHub integration, or paste it into the SQL Editor). It uses the
same `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAILS` as the dashboard below. Until
it's set up, signed-in users just see the normal Saved panel.

## Private dashboard (/admin)

`your-site/admin` shows listeners, plays, accounts, top stations, countries and
genres, a 30-day chart and recent plays. Only emails listed in `ADMIN_EMAILS`
can see it.

1. **Create the play log.** Run `supabase/migrations/20261107180000_plays_and_admin_stats.sql`
   (automatic with the GitHub integration, or paste it into the SQL Editor).
2. **Add two more variables in Vercel** (Settings → Environment Variables):
   - `SUPABASE_SERVICE_ROLE_KEY` = the **secret** key (Supabase → Project Settings →
     API Keys: `sb_secret_…`, or the legacy `service_role` key). Mark it **Sensitive**.
     It stays on the server; the app refuses to send a secret key to browsers.
   - `ADMIN_EMAILS` = the email you sign in with (comma-separate several).
3. **Redeploy**, sign in once in the app with that email, then open `/admin`.

The **Station checks** panel needs one more migration,
`supabase/migrations/20261107190000_station_checks.sql`. It shows Radio Browser's
total, how many stations Neo Earth Radio has checked, how many passed, and why the
rest were turned away (each station's latest result).

How it counts: a play is recorded after 30 seconds of listening. Listeners are
counted per browser with a random ID (no IP addresses or locations), so one
person on two devices counts twice. The play log can't be read with the public
key; only the server can read it.

## Sharing stations

Each saved station has a link button that copies `your-site/?station=<id>`
(with a Share… option on phones). Opening that link adds the station to the
other person's saved list and plays it first; pasting it into **Add received
signal** in the Saved panel adds it too. `/api/station` looks the station up
(it doesn't require song titles, since the person picked it on purpose).

## Genres

New listeners are first asked what they want to hear (a genre, then optionally a style) and start with that plus related genres. Tap genre chips to mix up to 5 at once; each search picks one of them at random, so they share airtime evenly. **Any** clears the selection.
Tap the small **EDIT** button at the end of the genre row to remove genres or add sub-genres.
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
- A station that never starts within 8 s is skipped. One that was playing and
  then drops gets one automatic reconnect (at most once a minute) before the
  app moves on. Missing song titles never skip a station that's playing.
- "FORGET SIGNAL" skips a station and never plays it on that device again.
- "WRONG GENRE?" skips a station and reports it; review reports in `/admin` (needs migration `20261113070000_genre_reports.sql`).
- Review alert email: when more than 3 reports are waiting, the admin gets one email. Sign up at resend.com, create an API key, and add `RESEND_API_KEY` in Vercel (optional `NOTIFY_EMAIL` to send somewhere other than `ADMIN_EMAILS`; `NOTIFY_FROM` once neoearthradio.com is verified in Resend).
- `USER_AGENT` in `lib/config.js` names the site (neoearthradio.com), as Radio
  Browser asks for an identifying agent. Update it if the domain changes.

## Credits

City names: [GeoNames](https://www.geonames.org/) (CC BY 4.0), via the `all-the-cities` package (MIT).
Station directory: [Radio Browser](https://www.radio-browser.info/).
