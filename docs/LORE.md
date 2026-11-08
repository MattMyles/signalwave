# Neo-Earth lore

Matt's world-building for NEO // EARTH. **Matt writes this; Claude reads it.** Nothing here is final until Matt fills it in, and the sections below are only prompts.

**For Claude:** before writing or changing any in-world text (the splash page, status messages, vibe-mode alien lines, Easter eggs, toasts, empty states), read this file and follow it. If the lore contradicts text already in the app, point it out and offer to update the app to match. Don't invent canon here yourself; suggest ideas in chat and let Matt add what he likes.

---

## The world

*What is Neo-Earth? How is it different from our Earth? When is it?*

-

## Radio on Neo-Earth

*Why does radio matter here? Who broadcasts, who listens? What's a "signal", a "frequency", the "world grid"?*

-

## The listener

*Who is the person using the app, in-world? (A "remote user"? A drifter? A station hacker?) What does "jacking in" mean?*

-

## The visitors (aliens)

*Who are they, where are they from, why do they care about Neo-Earth music? How do they talk: tone, slang, catchphrases? Anything they would never say?*

-

## Ships and asteroids

*Whose ships fly past in vibe mode? Why are they shooting asteroids?*

-

## Places and factions

*Cities, regions, companies, crews, rival broadcasters...*

-

## Words and phrases

*In-world vocabulary and what it means. Useful for status messages.*

| Term | Meaning |
|---|---|
| | |

## Easter eggs and secrets

*Hidden things and the story behind them (e.g. the Wrecking Crew transmission).*

-

---

## Where lore shows up in the app (current text)

What the app says today, so it's clear what the lore would change. File names are for Claude.

**Splash page** (`public/index.html`): logo NEO // EARTH ^RADIO; tagline "Live music radio from a random city on Neo-Earth. Neo-Earth music only."; boot log "> LOADING WORLD GRID…" then "> WORLD GRID ONLINE // READY"; button "JACK IN".

**Link previews** (`public/index.html` meta tags, `public/og-image.png`): still "Live music radio from a random city. Earth music only." / "> EARTH MUSIC ONLY_".

**Vibe-mode visitors** (`UFO_LINES` in `public/vibes.js`), shown when the UFO arrives and drops its disco ball:
- > GALACTIC REQUEST LINE OPEN
- > DISCO DEPLOYED
- > NOW SPINNING FOR EARTH
- > THIS ONE GOES OUT TO EARTH
- > GREETINGS FROM THE ANDROMEDA TOP 40
- > TAKE ME TO YOUR DJ

**Status line** (`public/app.js`): > SCANNING FREQUENCIES… · > LINK ESTABLISHED // 128 kbps MP3 · > SIGNAL LOST — RETUNING… · > SIGNAL STALLED · > STILL SCANNING — WIDENING SEARCH… · > RETUNING TO SAVED SIGNAL… · > LINK PAUSED · > TAP PLAY TO START AUDIO · > STATION HIDDEN — RETUNING… · > SHARED SIGNAL RECEIVED · > GLOBE OFFLINE — AUDIO ONLY

**Saved panel and toasts**: SAVED SIGNALS · ADD RECEIVED SIGNAL · > SIGNAL SAVED · > SIGNAL REMOVED · > SIGNALS SYNCED · > THIS SIGNAL CANNOT BE CAPTURED

**Easter egg** (Wrecking Crew, `wreckingcrew.mp3`): > UNKNOWN SIGNAL DETECTED… · > LINK HACKED // STREAM CORRUPTED // JAM IMMINENT · TERMINATE REMOTE USER · > REMOTE USER TERMINATED — RESTORING SIGNAL… · > TRANSMISSION COMPLETE — RETUNING…
