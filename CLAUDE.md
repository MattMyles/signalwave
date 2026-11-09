# Neo Earth Radio — project guide for Claude

**NEO // EARTH** (Neo Earth Radio, neoearthradio.com, formerly Signal Wave): random live music radio from a random city on Neo-Earth, played over a neon cyberpunk globe. Built for Matt, who mostly uses it as a home-screen app on his iPhone. Live site deploys from `main` on Vercel. README.md is the human setup guide; this file is the working map for making changes.

## Purpose (judge every change against this)

**New music discovery.** The point is for listeners to hear what people around the world actually listen to in their favourite genres, and to find music they haven't heard before. So: real local stations in real cities, spread across the world; not curated internet-only channels or playlists of familiar songs (Matt ruled out adding Nightride FM / SomaFM / laut.fm-style networks for this reason). **Random play never repeats a station** a listener has heard before; saving a station is how you come back to it. Quality guardrails stay strict: streams must start fast, send real artist/song titles, and meet a minimum bitrate.

## Ground rules

- **Pushing to `main` deploys the live site.** Matt has asked for changes to go straight to `main` once tested; for anything risky or large, push a branch first (Vercel builds a preview) and ask.
- **Test before pushing:** `npm test` (offline tests) and a Playwright check at iPhone width (390×844). `node server.js` serves the site and `/api/*` locally (`PORT=3123 node server.js`). The sandbox usually can't reach Radio Browser, so real stations won't load locally; the Easter egg (below) is a handy way to get audio playing for UI tests.
- **After any change in `public/`, bump the cache name in `public/sw.js`** (`signal-wave-vNN` → next number) so installed copies update, **and bump `BUILD` near the top of `public/app.js`** (shown as "BUILD NN" at the bottom of the Saved panel; Matt uses it to check his phone has the update). If you add a new front-end file, add it to `SHELL` in `sw.js` too.
- Phone first: everything must work at 390px wide, with safe-area insets, and on iPhone Safari (no Web Audio analyser on streams, no element full screen). Respect `prefers-reduced-motion`.
- No build step and no npm dependencies: plain HTML/CSS/JS. Vendor libraries are bundled in `public/vendor/` (no CDNs).
- Visual style: black background, neon yellow `#fcee0a`, cyan `#00f0ff`, magenta `#ff2a6d` / pink `#ff3ec8`, green `#39ff14`; Chakra Petch display font, Share Tech Mono for HUD text; terminal-style status messages like `> LINK ESTABLISHED`. CSS tokens live at the top of `styles.css`.
- Write commit messages in plain language describing what changed for the user.
- **In-world text follows the lore.** Before writing or changing splash copy, status messages, vibe-mode alien lines (`UFO_LINES` in `vibes.js`), toasts or Easter eggs, read [docs/LORE.md](docs/LORE.md) (Matt's Neo-Earth lore; he writes it, Claude doesn't add canon). Keep its "Where lore shows up" list current when in-world text changes.

## The name

The app is **NEO // EARTH** (full name **Neo Earth Radio**; "radio" is just the descriptor). Logo: `NEO<b>//</b>EARTH<sup class="suffix">RADIO</sup>`, with RADIO small and raised, followed by a magenta **ALPHA** tag (`<span class="alpha">`) while the app is in development; titles read "Neo Earth Radio (Alpha)" and the splash shows a small ALPHA tag under the logo (Matt: the tag alone is enough, no "still in development" text). Remove these when Matt says it's out of alpha. Home-screen name: "Neo Earth". Domain: **neoearthradio.com** (Matt registered it 2026-11-08). Renamed from "Signal Wave" / "Signal Wave ER" on 2026-11-08 because Signal Wave Radio is an active UK station (ScoobyMedia Group). Internal names stay "signalwave" (only things users never see): GitHub repo, Vercel and Supabase projects, `sw.*` storage keys, the `signal-wave-vNN` cache name, `package.json`, and the export format's `"app": "signal-wave"`. Never rename those.

Name check at the rename: no "Neo Earth Radio" found. There is an iPhone app called **Earth Radio** (Vweeter Limited) that also plays world radio on a 3D globe, so lead with "Neo Earth" / NEO // EARTH in branding and recheck before any App Store launch or monetization. To rename again, follow [docs/RENAMING.md](docs/RENAMING.md) (or the `/neoearth-rename` skill).

## How it works

### Server (Vercel functions in `api/`, shared code in `lib/`)

| Endpoint | Purpose |
|---|---|
| `api/next.js` | One vetted station. The app POSTs `{ genres, exclude, recent }` (exclude = every station heard on this device, up to 6000); GET `?genres=…&exclude=…&recent=…` still works. Up to 5 genres; `recent` country codes steer picks to other parts of the world |
| `api/nowplaying.js` | Current song title by station UUID (reads ICY metadata) |
| `api/station.js` | Looks up one station for a shared link (doesn't require song titles) |
| `api/track.js` | Logs a play after 30 s of listening (server key; random per-browser visitor ID) |
| `api/admin-stats.js` | Dashboard numbers, only for `ADMIN_EMAILS` |
| `api/nese.js` | NESE member ID and transmissions: `GET` (ID + inbox, assigns an ID on first call; admins get 0), `POST {action:'send', to, station}`, `POST {action:'dismiss', id}`. Signed-in users only; server key; calls the `nese_*` SQL functions. `lib/nese.js` formats/parses IDs |
| `api/genre-counts.js` | `?genre=metal` → candidate station counts for the genre and each style (secure stream + a placeable city: coordinates or `cityFromText`, aliases included, capped at 300 per name, cached a day). Its `STYLES` list must match `CATALOG` in `app.js` (a test checks this) |
| `api/config.js` | Tells the browser whether sync is configured (public URL + anon key only) |
| `api/keepalive.js` | Daily cron (`vercel.json`) so free Supabase doesn't pause |

Station vetting (`lib/vet.js`), the five checks: directory filters → music-only tags (talk/news/sports blocklist) → has a city (offline reverse geocode, `lib/geo.js` + `cities.json`; stations without coordinates are placed by `cityFromText`: their directory region field naming a place exactly, or a 100k+ city's name inside the station name, always in the station's own country, with a `NOT_PLACES` list of ordinary words like Paradise or Phoenix; searches no longer ask the directory for coordinates only, and fetch 100 per country / 200 worldwide) → stream starts fast → sends real song titles (`lib/icy.js`; Shift-JIS titles are decoded when they come out as real Japanese; `looksLikeSong` also accepts ／ ｜ －, 「」『』 and " / " in CJK text) → meets the quality floor (`LIMITS.minKbps` 64, AAC `minKbpsAac` 40, when the bitrate is known; failures logged as `low_quality`). Styles also search and match their other names (`TAG_ALIASES` in `lib/config.js`, e.g. synthwave → retrowave/outrun/darksynth, drum and bass → dnb); keep aliases specific since matching is by substring. **Translation layer** (`lib/translate.js`): `translateTags` adds English words for foreign tags (ロック → rock, música electrónica → electronic, ニュース → news), so genre matching, the music check and the talk/news/sport/religion blocklist work in other languages; it's an offline word list, extend `DICT` to cover more languages. Region searches also pull 100 of each country's stations with no keyword, so locally tagged stations are found. Region searches always use the style's own name plus one alias; the worldwide fallback searches all names (up to 8) in parallel. Passing stations are pooled per genre in memory (resets on cold start); failures are remembered for a while; results are logged to Supabase `station_checks` (`lib/checklog.js`). `lib/radio.js` is the Radio Browser client with mirror failover. **Tune genres, tags, blocklist and timeouts in `lib/config.js`.** `probeStream` also records whether a stream sends CORS headers (`cors`), which decides if the browser can analyse its audio.

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
| NESE membership | `nese` state, `loadNese()`, `renderNese()` (button label NESE, NESE DASHBOARD title, ID badge, inbox list and green dot), dashboard tabs SIGNALS / TRANSMIT (`setDashTab`, `txChoices`, `fillTxSignals`, `txMsg`; the old `#sendSheet` markup is unused); falls back to the plain Saved panel if `/api/nese` isn't set up |
| Account & sync | Email one-time code sign-in (code, not link, so it works in the home-screen app); one Supabase row per user (favorites, genres, hidden), debounced push |
| Boot | Splash screen, "Jack in" |

Browser storage keys (keep stable): `sw.favorites`, `sw.genres`, `sw.selected`, `sw.genre`, `sw.hidden`, `sw.showFavDots`, `sw.visitor`, `sw.auth`, `sw.syncUser`, `sw.syncedAt`, `sw.changedAt`, `sw.genresVersion` (one-time genre-list upgrades, e.g. adding Metal in build 32), `sw.saveTipDismissed` (the saved-list tip's ✕), `sw.heard` (station IDs ever played here, newest 6000; random play excludes them; if a genre has nothing new, `fetchFresh` allows a repeat and says so).

Supabase tables (`supabase/migrations/`): `user_settings` (per-user, row-level security), `plays` + admin stats function, `station_checks`, `nese_members` + `nese_signals` with functions `nese_member`, `nese_send`, `nese_inbox`, `nese_dismiss` (server-only; sends are capped at 30/hour, inboxes at 50). Sign-in email template: `supabase/templates/magic_link.html` (pasted into Supabase by hand).

## Features (current)

- Random vetted music station worldwide, globe flies to its city with an arc from the last one; NEXT/PREV, two stations always queued.
- Now playing with song titles, station/genre/city/country, bitrate, visualizer, Spotify and Apple Music search links, lock-screen controls.
- **First visit:** after JACK IN, new listeners (no saved genre list) get "WHAT DO YOU WANT TO HEAR FIRST?": pick a genre, then a style or ALL <genre>, or SURPRISE ME (defaults, Any). Their list starts as the pick + related genres, 5 in all (`RELATED` in `app.js`), with the pick selected. Shared links skip it.
- A small fixed EDIT button sits at the end of the genre row (always visible; the chips scroll). The editor explains: add as many genres as you like, pick up to 5 at a time to rotate through. Opening a genre in the editor loads station counts next to each style (`loadGenreCounts`, an upper bound; empty styles are dimmed). Adding a genre while nothing is selected (Any) selects it.
- Genre chips, mix up to 5; editable list with sub-genres; dead genres flagged. 15 main genres: Electronic, Rock, Metal, Punk, Pop, Hip-hop, R&B & Soul, Jazz, Blues, Classical, Ambient & Chill, Latin, Reggae & Ska, World, Country & Folk, each with roughly 4–17 styles (`CATALOG` in `app.js`; main-genre ids and search tags must match `GENRES` in `lib/config.js`). Tags match by substring, so avoid short tags that hide inside other words (e.g. "oi", or "dub" as a main tag).
- Saved stations (♥), shown on the globe; a pink note at the top of the saved list (and the save toast, `> SIGNAL SAVED // FIND IT UNDER NESE` or `SAVED`) explains that only stations saved with ♥ on the player appear there (the note has a ✕ to dismiss it for good on that device); share by link; "Not music? Hide station". EXPORT / IMPORT sit right under the saved list (above "Add received signal"); EXPORT turns the list into a checklist (tap rows, SELECT ALL / NONE, EXPORT N, CANCEL) and downloads only the picked stations in the usual file format.
- **NESE membership** (signed-in users): each gets a NESE ID (Matt, as admin, is NESE-0000; others count up from NESE-0001). The Saved button reads NESE, the panel becomes the NESE DASHBOARD with an ID badge, with two tabs: SIGNALS (saved list) and TRANSMIT (pick the playing signal or a saved one, enter a member's NESE ID, TRANSMIT or COPY LINK INSTEAD; a saved row's link button opens this tab with that signal picked). Received stations wait under INCOMING TRANSMISSION SIGNALS on the TRANSMIT tab (green dot on the button and the tab, toast on arrival) until ADD (saves it via `/api/station`) or ✕. Only IDs are ever shown, never emails.
- Optional sign-in and sync across devices; private admin dashboard with plays, listeners, top stations/countries/genres, station-check stats.
- Installable PWA with icons and link-preview image.
- **Vibe mode** (button under the reticle, or `V`): hides the HUD; globe zooms out to fill the screen with a tiny ◂ ▸ bar. `vibes.js` draws warp stars, ship squadrons that fire on the beat and aim at asteroids, asteroids that explode (big ones split), soft beat rings once a bar, and the Kryx UFO (Neo-Earth's secret protectors, per the lore) that lowers a disco ball throwing light spots; the orbs occasionally fire at asteroids on the beat. Its lines (`UFO_LINES`) are radio chatter like "> GALACTIC REQUEST LINE OPEN, NEXT TRACK: PROTECT NEO//EARTH" and wrap to fit the screen; nothing abduction-themed. Matt asked for it calm, not busy: keep spawn rates low. Real beat sync only on streams with CORS on desktop (bass-flux detection; when no clear hit is heard for a beat's length the genre tempo fills in, so steady music still drives the effects); iPhone uses a genre-tempo fake beat. **Tap or click an asteroid** to fire a yellow shot from the playing signal's city (`globe.getScreenCoords`), 75% hit chance; misses are aimed just wide (`PLAYER_HIT_CHANCE`, `fireAt` in `vibes.js`). Bolt hits use swept checks so fast shots can't skip small rocks. Space still pauses (Matt decided against Space to fire). Full screen via the Fullscreen API (webkit fallback); iPhone Safari can't, the home-screen app fills the screen.
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
- **2026-11-08** This guide and the skills for changing and renaming the app (first called `/signalwave` and `/signalwave-rename`, now `/neoearth` and `/neoearth-rename`).
- Export moved under the saved list; pick which stations to export, or all (build 16).
- "Add a shared station" renamed "Add received signal" (build 17).
- Rebranded to **NEO // EARTH** (Neo Earth Radio), domain neoearthradio.com; new link-preview image; export file now `neo-earth-radio-favorites.json` (build 18).
- Skills renamed `/neoearth` (make changes) and `/neoearth-rename` (rename protocol).
- Lore skills: `/neoearth-lore` (summary), `/neoearth-lore-update` (new entries), `/neoearth-lore-verify` (continuity check); `docs/LORE.md` gained Open questions and Lore log sections.
- Splash tagline now "Live music radio from a random city on Neo-Earth. Neo-Earth music only."; started `docs/LORE.md` for Matt's Neo-Earth lore (build 19).
- First lore written (the war, the NESE, the four species); vibe-mode UFO is now the Kryx with new radio-chatter lines, and its disco-ball orbs shoot asteroids (build 20).
- Link previews and share image now say "Neo//Earth music only" (build 21).
- NESE member IDs, NESE Dashboard with ID badge, and transmitting stations to another member's ID with an incoming-transmissions inbox (build 22). Needs migration `20261108070000_nese_members.sql`.
- ALPHA tag on all branding: logos, page titles, splash, admin, share image, sign-in email (build 23).
- Sign-in email now welcomes people to the Neo//Earth Signal Engineers Corps (template only; Matt pastes it into Supabase).
- Now-playing panel label "STATION" is now "SIGNAL" (build 24).
- Now-playing panel background is black at 30% opacity (75% in build 25, 65% in 26, 50% in 28, 30% from build 30).
- Blur behind the now-playing panel turned down to 20% of the original: 6px → 4.8px (build 27) → 1.2px (build 29).
- Globe: USA fixed to cyan and Canada to magenta so they read as separate countries; other countries keep the seeded random palette. Fixed colours live in `FIXED` (found by a point inside each country, since the map file has no names) (build 31).
- Genres reorganized: Metal (heavy, thrash, death, black, doom…), Punk, R&B & Soul, Blues and Reggae & Ska became their own genres, and every genre got more specific styles; Metal added once to existing users' lists (build 32).
- First-visit genre question with 5 related genres, always-visible EDIT button, editor note about the 5-at-a-time limit, splash shows just ALPHA (build 33).
- Vibe mode: beat detection works for all music on desktop, not just kick-heavy synthwave; tap/click an asteroid to shoot it from your signal's city (75% hit chance) (build 34).
- Discovery: random play never repeats a station you've heard (saved stations are how you return); styles match their other tag names; streams below 64 kbps (AAC 40) are rejected as too weak (build 35). Needs migration `20261109070000_low_quality_check.sql` for the dashboard to count low-quality rejections.
- Station counts per genre and style in the genre editor; adding a genre while on Any now tunes to it (Matt removed all genres, added Death Metal and got electronic because nothing was selected) (build 36).
- Changing genres while a search is running no longer plays a station for the old selection: `next()` drops a find whose genre key no longer matches `selKey()` and searches again (`restartForNewGenres`) (build 37).

- NESE dashboard split into SIGNALS and TRANSMIT tabs: send a playing or saved signal to a member's ID; incoming transmissions live on TRANSMIT; clearer note that only ♥-saved stations appear in the list (build 38).

- Fixed small styles (synthwave) finding no signal since build 35: region searches always include the style's own name, and once every region is tried the search goes worldwide across all its names at once instead of looping until the deadline (server only).

- The saved-list tip can be dismissed with ✕ (build 39).

- TRANSMIT tab heading now INCOMING TRANSMISSION SIGNALS ("signal" is the in-app word for a station or station link) (build 40).

- More stations in every genre: stations without map coordinates are no longer thrown out; they're placed at the city named in their directory region or their own name (same country, real place), and still pass every playback check. Genre-editor counts include them (server only).

- Translation layer for station tags (Japanese, Korean, Chinese, Spanish, Portuguese, French, German, Russian and more) plus Japanese song-title formats and Shift-JIS titles, so stations tagged and titled in their own language can pass; region searches also sample each country without an English keyword (server only). Prompted by never landing in Japan.

Add a line here when shipping something notable.

## Known limits and ideas not done

- Most stations don't send CORS headers, so the browser can't analyse their audio; iPhone never analyses streams (Safari breaks background playback through Web Audio). True sync everywhere would need a streaming relay (e.g. a Cloudflare Worker); Vercel functions time out and add bandwidth cost.
- Station pool is in serverless memory; a shared pool would need Vercel KV / Upstash.
- HLS streams are skipped (no ICY titles).
- `USER_AGENT` in `lib/config.js` names neoearthradio.com; update it if the domain changes.
