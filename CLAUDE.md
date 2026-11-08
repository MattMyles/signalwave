# Neo Earth Radio — project guide for Claude

Random live music radio from a random city on Earth, played over a neon cyberpunk globe. Built for Matt, who mostly uses it as a home-screen app on his iPhone. Live site deploys from `main` on Vercel. README.md is the human setup guide; this file is the working map for making changes.

## Ground rules

- **Pushing to `main` deploys the live site.** Matt has asked for changes to go straight to `main` once tested; for anything risky or large, push a branch first (Vercel builds a preview) and ask.
- **Test before pushing:** `npm test` (offline tests) and a Playwright check at iPhone width (390×844). `node server.js` serves the site and `/api/*` locally (`PORT=3123 node server.js`). The sandbox usually can't reach Radio Browser, so real stations won't load locally; the Easter egg (below) is a handy way to get audio playing for UI tests.
- **After any change in `public/`, bump the cache name in `public/sw.js`** (`signal-wave-vNN` → next number) so installed copies update, **and bump `BUILD` near the top of `public/app.js`** (shown as "BUILD NN" at the bottom of the Saved panel; Matt uses it to check his phone has the update). If you add a new front-end file, add it to `SHELL` in `sw.js` too.
- Phone first: everything must work at 390px wide, with safe-area insets, and on iPhone Safari (no Web Audio analyser on streams, no element full screen). Respect `prefers-reduced-motion`.
- No build step and no npm dependencies: plain HTML/CSS/JS. Vendor libraries are bundled in `public/vendor/` (no CDNs).
- Visual style: black background, neon yellow `#fcee0a`, cyan `#00f0ff`, magenta `#ff2a6d` / pink `#ff3ec8`, green `#39ff14`; Chakra Petch display font, Share Tech Mono for HUD text; terminal-style status messages like `> LINK ESTABLISHED`. CSS tokens live at the top of `styles.css`.
- Write commit messages in plain language describing what changed for the user.

## The name

The app is **NEO // EARTH** (full name **Neo Earth Radio**; "radio" is just the descriptor). Logo: `NEO<b>//</b>EARTH<sup class="suffix">RADIO</sup>`, with RADIO small and raised. Home-screen name: "Neo Earth". Domain: **neoearthradio.com** (Matt registered it 2026-11-08). Renamed from "Signal Wave" / "Signal Wave ER" on 2026-11-08 because Signal Wave Radio is an active UK station (ScoobyMedia Group). Internal names stay "signalwave": GitHub repo, Vercel and Supabase projects, `sw.*` storage keys, the `signal-wave-vNN` cache name, `package.json`, and the export format's `"app": "signal-wave"`. Never rename those.

Name check at the rename: no "Neo Earth Radio" found. There is an iPhone app called **Earth Radio** (Vweeter Limited) that also plays world radio on a 3D globe, so lead with "Neo Earth" / NEO // EARTH in branding and recheck before any App Store launch or monetization. To rename again, follow [docs/RENAMING.md](docs/RENAMING.md) (or `/signalwave-rename`).

## How it works

### Server (Vercel functions in `api/`, shared code in `lib/`)

| Endpoint | Purpose |
|---|---|
| `api/next.js` | One vetted station: `/api/next?genres=jazz,tag:deep%20house&exclude=…&recent=…` (up to 5 genres; `recent` country codes steer picks to other parts of the world) |
| `api/nowplaying.js` | Current song title by station UUID (reads ICY metadata) |
| `api/station.js` | Looks up one station for a shared link (doesn't require song titles) |
| `api/track.js` | Logs a play after 30 s of listening (server key; random per-browser visitor ID) |
| `api/admin-stats.js` | Dashboard numbers, only for `ADMIN_EMAILS` |
| `api/config.js` | Tells the browser whether sync is configured (public URL + anon key only) |
| `api/keepalive.js` | Daily cron (`vercel.json`) so free Supabase doesn't pause |

Station vetting (`lib/vet.js`), the five checks: directory filters → music-only tags (talk/news/sports blocklist) → has a city (offline reverse geocode, `lib/geo.js` + `cities.json`) → stream starts fast → sends real song titles (`lib/icy.js`). Passing stations are pooled per genre in memory (resets on cold start); failures are remembered for a while; results are logged to Supabase `station_checks` (`lib/checklog.js`). `lib/radio.js` is the Radio Browser client with mirror failover. **Tune genres, tags, blocklist and timeouts in `lib/config.js`.** `probeStream` also records whether a stream sends CORS headers (`cors`), which decides if the browser can analyse its audio.

Env vars (Vercel): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never sent to browsers), `ADMIN_EMAILS`, optional `SITE_URL`. `lib/supabase-env.js` tolerates name typos. `scripts/build-meta.js` (`npm run build`) makes link-preview URLs absolute at deploy.

### Front end (`public/`)

`index.html` (markup), `styles.css`, `app.js` (one IIFE, ~1700 lines), `vibes.js` (vibe-mode effects), `sw.js` (service worker: network-first app files, cache-first vendor, never touches `/api/`, `/media/` or streams), `admin.html` + `admin.js` (dashboard at `/admin`).

`app.js` sections, in order (search for `/* ---------- Name`):

| Section | What's there |
|---|---|
| (top) | `state`, `store` (localStorage wrapper), `CATALOG` of genres/sub-genres, timing constants |
| Audio | Two `<audio>` elements: plain, and CORS-enabled feeding a Web Audio analyser (not used on iOS). `playUrl`, stall timer (8 s), one reconnect per minute, `troubled()` |
| Station fetching | Queue of two vetted stations, `next()`, `tune()`, `prev()` |
| Listening stats | `recordPlay` after 30 s |
| HUD | Song/station display, decode animation, `status()` line, scrolling long text, Spotify/Apple Music links |
| Visualizer | Bar visualizer (real analyser data when available, animated fake otherwise) |
| Vibe mode | `vibeLevels()` (bass/energy/beat from analyser, or a fake groove: genre-matched BPM via `GROOVES`, beat-locked for the Easter egg), `setVibe()`, full-screen helpers |
| Globe | globe.gl setup, auto-rebuild if iOS drops the WebGL context, arcs, rings, points, `flyTo()`, idle drift |
| Favorites | Save/remove, drawer list, globe dots |
| Sharing stations | `/?station=<uuid>` links, paste-to-add, export/import JSON |
| Easter egg | `EGG` station, `playEgg()`, `hack()` status lock, Terminate Remote User |
| Genres | Chips (up to 5 at once), genre editor sheet |
| Media Session | Lock-screen metadata and controls |
| Controls | Play/pause, buttons, keyboard (`N`/`→`, `P`/`←`, `Space`, `F`, `V`, `Esc`) |
| Account & sync | Email one-time code sign-in (code, not link, so it works in the home-screen app); one Supabase row per user (favorites, genres, hidden), debounced push |
| Boot | Splash screen, "Jack in" |

Browser storage keys (keep stable): `sw.favorites`, `sw.genres`, `sw.selected`, `sw.genre`, `sw.hidden`, `sw.showFavDots`, `sw.visitor`, `sw.auth`, `sw.syncUser`, `sw.syncedAt`, `sw.changedAt`.

Supabase tables (`supabase/migrations/`): `user_settings` (per-user, row-level security), `plays` + admin stats function, `station_checks`. Sign-in email template: `supabase/templates/magic_link.html` (pasted into Supabase by hand).

## Features (current)

- Random vetted music station worldwide, globe flies to its city with an arc from the last one; NEXT/PREV, two stations always queued.
- Now playing with song titles, station/genre/city/country, bitrate, visualizer, Spotify and Apple Music search links, lock-screen controls.
- Genre chips, mix up to 5; editable list with sub-genres; dead genres flagged.
- Saved stations (♥), shown on the globe; share by link; "Not music? Hide station". EXPORT / IMPORT sit right under the saved list (above "Add received signal"); EXPORT turns the list into a checklist (tap rows, SELECT ALL / NONE, EXPORT N, CANCEL) and downloads only the picked stations in the usual file format.
- Optional sign-in and sync across devices; private admin dashboard with plays, listeners, top stations/countries/genres, station-check stats.
- Installable PWA with icons and link-preview image.
- **Vibe mode** (button under the reticle, or `V`): hides the HUD; globe zooms out to fill the screen with a tiny ◂ ▸ bar. `vibes.js` draws warp stars, ship squadrons that fire on the beat and aim at asteroids, asteroids that explode (big ones split), soft beat rings once a bar, and a friendly UFO that lowers a disco ball throwing light spots (lines like "> TAKE ME TO YOUR DJ"; nothing abduction-themed). Matt asked for it calm, not busy: keep spawn rates low. Real beat sync only on streams with CORS on desktop; iPhone uses a genre-tempo fake beat. Full screen via the Fullscreen API (webkit fallback); iPhone Safari can't, the home-screen app fills the screen.
- **Easter egg:** typing `wreckingcrew.mp3` in Saved → "Add received signal" plays `public/media/wreckingcrew.mp3` (55 s Space Jam theme clip, measured 132.1 BPM, first beat at 261 ms) as station WRECKING CREW from Jacksonville. Globe zooms out and dribbles like a basketball; status line is locked to blinking red `> LINK HACKED // STREAM CORRUPTED // JAM IMMINENT` for the whole song; a red TERMINATE REMOTE USER button replaces "Hide station" and returns to normal radio; when the song ends it goes back to radio. Can't be saved; not counted in stats; cuts in even mid-search (`state.eggAt`).

## Origins and key decisions

The app was planned and first built in a separate claude.ai chat, "Cyberpunk world radio website" (2026-11-07), with a build-plan doc ("Signal Wave — Random World Radio: Build Plan", https://claude.ai/artifact/UnEt9UqrMz2DsF9UdPPSG2). The decisions there still shape the code:

- **The brief:** a mobile-friendly site that plays a random radio station from around the world; dark cyberpunk look (black, neon, inspired by the Cyberpunk game but with original branding); a tech-style globe that rotates and zooms to the station's city; a display with song, genre, station, city and country; and favorites. Matt later sent a reference image and asked for the globe to look more like it, which led to the neon network look (hex-dot countries, glowing arcs and particles).
- **Music only, and strict:** Matt wanted no talk radio and real song titles, so every station must pass five checks (directory filters, music tags with a talk/news/sports blocklist, a city, a stream that starts within 4 s, real ICY song titles). This shrinks the pool a lot, which is why stations are vetted server-side, pooled per genre, and two are kept queued.
- **Region-balanced picks:** picks are spread across world regions, steering away from countries just heard, so it doesn't keep landing in the US and Europe.
- **City lookups are offline** (`lib/cities.json`, ~49,000 places with 5,000+ people). The first version used OpenStreetMap Nominatim, which rate-limits and often blocks Vercel's servers; every station then failed "has a city" and was benched for hours ("no stations passed the checks"). Fix: offline list, city check first, slow stations benched 20 minutes instead of 6 hours, one quiet retry.
- **Never skip a playing station for missing titles.** Early versions skipped on missing or repeated titles and on the browser's false "stalled" event, cutting songs off. Now only a real stop of 8 s counts, a station that was playing gets one reconnect a minute, and missing titles just leave the last song on screen.
- **Globe freezing on iPhone:** caused by hovering/touching the unnamed particles around the globe, which threw an error inside globe.gl and stopped its animation (switching tabs restarted it — Matt's clue). Fixed, plus a watchdog that restarts or rebuilds the globe if it stops drawing (iOS can drop the WebGL context), a lower render resolution on phones, and zoom limits so the camera can't pass into the globe.
- **Sign-in uses an emailed code, not a link,** because a link opens Safari instead of the home-screen app. Sync is optional; without Supabase everything is saved per device.
- **Dashboard privacy:** plays count after 30 s; listeners are a random per-browser ID (no IPs or locations); only `ADMIN_EMAILS` can see `/admin`; the service key never reaches the browser.
- **Updates:** network-first service worker plus a build number shown in the Saved panel, so Matt can confirm his phone has the latest version after closing and reopening the app.
- **Name:** started as the placeholder "Neon Atlas"; Matt was offered ten options (Ghost Frequency, Gridcast, Carrier Wave, Signal Drift, Neon Meridian and others) and chose **Signal Wave** as a working name. "ER" (Earth Radio) was added after finding Signal Wave Radio, then the app became **NEO // EARTH** (Neo Earth Radio) once Matt registered neoearthradio.com.
- Matt originally uploaded files to GitHub by hand; since connecting GitHub, Claude pushes directly.

## History

- **2026-11-07** First version uploaded: random vetted world radio on a globe.
- Sign-in and sync, genre editor, region-balanced picks, Spotify/Apple Music links; neon sign-in email.
- Previous-station button; fixed globe freezing; zoom limits; icons and link previews; updates load on next open with build number shown.
- Stopped skipping stations mid-song; reconnect logic.
- Private admin dashboard at `/admin`, plus station-checks panel; fixed "no stations passed" on Vercel.
- Share saved stations by link; mix up to 5 genres.
- Easter egg (`wreckingcrew.mp3`): bouncing globe, hacked status line, Terminate Remote User.
- Vibe mode: full-screen globe with music-reactive effects; UFO changed from tractor beam to disco ball (abduction felt threatening); genre-matched fake beat; exploding asteroids; then toned down (fewer rings and objects) because it was too busy.
- Renamed on screen to **Signal Wave ER** after finding Signal Wave Radio (UK). Rename plan added in `docs/RENAMING.md`.
- **2026-11-08** This guide and the `/signalwave` and `/signalwave-rename` skills.
- Export moved under the saved list; pick which stations to export, or all (build 16).
- "Add a shared station" renamed "Add received signal" (build 17).
- Rebranded to **NEO // EARTH** (Neo Earth Radio), domain neoearthradio.com; new link-preview image; export file now `neo-earth-radio-favorites.json` (build 18).

Add a line here when shipping something notable.

## Known limits and ideas not done

- Most stations don't send CORS headers, so the browser can't analyse their audio; iPhone never analyses streams (Safari breaks background playback through Web Audio). True sync everywhere would need a streaming relay (e.g. a Cloudflare Worker); Vercel functions time out and add bandwidth cost.
- Station pool is in serverless memory; a shared pool would need Vercel KV / Upstash.
- HLS streams are skipped (no ICY titles).
- `USER_AGENT` in `lib/config.js` names neoearthradio.com; update it if the domain changes.
