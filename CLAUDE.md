# Signal Wave ER — project guide for Claude

Random live music radio from a random city on Earth, played over a neon cyberpunk globe. Built for Matt, who mostly uses it as a home-screen app on his iPhone. Live site deploys from `main` on Vercel. README.md is the human setup guide; this file is the working map for making changes.

## Ground rules

- **Pushing to `main` deploys the live site.** Matt has asked for changes to go straight to `main` once tested; for anything risky or large, push a branch first (Vercel builds a preview) and ask.
- **Test before pushing:** `npm test` (offline tests) and a Playwright check at iPhone width (390×844). `node server.js` serves the site and `/api/*` locally (`PORT=3123 node server.js`). The sandbox usually can't reach Radio Browser, so real stations won't load locally; the Easter egg (below) is a handy way to get audio playing for UI tests.
- **After any change in `public/`, bump the cache name in `public/sw.js`** (`signal-wave-vNN` → next number) so installed copies update. If you add a new front-end file, add it to `SHELL` there too.
- Phone first: everything must work at 390px wide, with safe-area insets, and on iPhone Safari (no Web Audio analyser on streams, no element full screen). Respect `prefers-reduced-motion`.
- No build step and no npm dependencies: plain HTML/CSS/JS. Vendor libraries are bundled in `public/vendor/` (no CDNs).
- Visual style: black background, neon yellow `#fcee0a`, cyan `#00f0ff`, magenta `#ff2a6d` / pink `#ff3ec8`, green `#39ff14`; Chakra Petch display font, Share Tech Mono for HUD text; terminal-style status messages like `> LINK ESTABLISHED`. CSS tokens live at the top of `styles.css`.
- Write commit messages in plain language describing what changed for the user.

## The name (read before any launch, store or money work)

"Signal Wave" overlaps with **Signal Wave Radio**, an active UK 24/7 online station run by ScoobyMedia Group. Kept for now because this is a hobby project, shown as **Signal Wave ER** ("Earth Radio", ER small and raised after the logo).

**Before any app store submission, monetization (ads, subscriptions, paid app, tips, sponsorships, merch), custom domain or serious promotion, or on any name complaint: rename first.** Follow [docs/RENAMING.md](docs/RENAMING.md) (or the `/signalwave-rename` skill). If a task heads toward any of those, say so before doing it.

When renaming, change only user-facing text and images. Never rename the GitHub repo, Vercel or Supabase projects, the `sw.*` storage keys, or the export format's `"app": "signal-wave"`.

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
- Saved stations (♥), shown on the globe; share by link; export/import; "Not music? Hide station".
- Optional sign-in and sync across devices; private admin dashboard with plays, listeners, top stations/countries/genres, station-check stats.
- Installable PWA with icons and link-preview image.
- **Vibe mode** (button under the reticle, or `V`): hides the HUD; globe zooms out to fill the screen with a tiny ◂ ▸ bar. `vibes.js` draws warp stars, ship squadrons that fire on the beat and aim at asteroids, asteroids that explode (big ones split), soft beat rings once a bar, and a friendly UFO that lowers a disco ball throwing light spots (lines like "> TAKE ME TO YOUR DJ"; nothing abduction-themed). Matt asked for it calm, not busy: keep spawn rates low. Real beat sync only on streams with CORS on desktop; iPhone uses a genre-tempo fake beat. Full screen via the Fullscreen API (webkit fallback); iPhone Safari can't, the home-screen app fills the screen.
- **Easter egg:** typing `wreckingcrew.mp3` in Saved → "Add a shared station" plays `public/media/wreckingcrew.mp3` (55 s Space Jam theme clip, measured 132.1 BPM, first beat at 261 ms) as station WRECKING CREW from Jacksonville. Globe zooms out and dribbles like a basketball; status line is locked to blinking red `> LINK HACKED // STREAM CORRUPTED // JAM IMMINENT` for the whole song; a red TERMINATE REMOTE USER button replaces "Hide station" and returns to normal radio; when the song ends it goes back to radio. Can't be saved; not counted in stats; cuts in even mid-search (`state.eggAt`).

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

Add a line here when shipping something notable.

## Known limits and ideas not done

- Most stations don't send CORS headers, so the browser can't analyse their audio; iPhone never analyses streams (Safari breaks background playback through Web Audio). True sync everywhere would need a streaming relay (e.g. a Cloudflare Worker); Vercel functions time out and add bandwidth cost.
- Station pool is in serverless memory; a shared pool would need Vercel KV / Upstash.
- HLS streams are skipped (no ICY titles).
- Before going public, put the site URL in `USER_AGENT` in `lib/config.js`.
