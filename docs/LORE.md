# Neo-Earth lore

Matt's world-building for NEO // EARTH. **Matt writes this; Claude reads it.** Nothing here is final until Matt fills it in, and the sections below are only prompts.

**Skills:** `/neoearth-lore` (summary of the current lore), `/neoearth-lore-update` (add or change entries), `/neoearth-lore-verify` (continuity check).

**For Claude:** before writing or changing any in-world text (the splash page, status messages, vibe-mode alien lines, Easter eggs, toasts, empty states), read this file and follow it. If the lore contradicts text already in the app, point it out and offer to update the app to match. Don't invent canon here yourself; suggest ideas in chat and let Matt add what he likes.

---

## The world

The world is Earth, now known as Neo-Earth after a near apocalyptic war with 3 advanced alien species.

After the remaining population of Earth collected itself, the elected governing body decided that "Earth" existed no longer, and from then on, the planet would be known as "Neo-Earth" (Neo//Earth, Neo // Earth, or in cases of individuals who were so impacted by their suffered injuries that they have trouble processing, "Earth Two" or "Bad Earth" depending on their level of brain function).

However, the hatred of the alien species that caused this destruction still boils in the hearts of nearly all Neo//Earth citizens.

## Radio on Neo-Earth

Thankfully the underwater cables for Earth's internet network were mostly intact, and over the period of 20 years, a new network was established from scrap parts found in the devastation.

Music was thought to be an important factor to aid in the healing process of Neo-Earth citizens, so an organization was created called the NESE (Neo//Earth Signal Engineers Core). They set up the infrastructure to stream music around the planet for everyone to listen to, and heal with.

## The listener

*Who is the person using the app, in-world? (A "remote user"? A drifter? A station hacker?) What does "jacking in" mean?*

-

## The visitors (aliens)

*Who are they, where are they from, why do they care about Neo-Earth music? How do they talk: tone, slang, catchphrases? Anything they would never say?*

- Three advanced alien species fought the near apocalyptic war against Earth. Their names are still to be decided: the first species' name will start with a "C", the next with a "Y" and the last with an "M".
- Nearly all Neo//Earth citizens still hate the alien species that caused the destruction.

## Ships and asteroids

*Whose ships fly past in vibe mode? Why are they shooting asteroids?*

-

## Places and factions

*Cities, regions, companies, crews, rival broadcasters...*

- **The elected governing body:** declared that "Earth" existed no longer and renamed the planet Neo-Earth.
- **NESE (Neo//Earth Signal Engineers Core):** created to use music to help Neo-Earth citizens heal; set up the infrastructure to stream music around the planet for everyone.

## Words and phrases

*In-world vocabulary and what it means. Useful for status messages.*

| Term | Meaning |
|---|---|
| Neo-Earth (also Neo//Earth, Neo // Earth) | The planet's name since the war; "Earth" officially existed no longer |
| Earth Two / Bad Earth | What Neo-Earth is called by individuals so impacted by their injuries that they have trouble processing, depending on their level of brain function |
| NESE | Neo//Earth Signal Engineers Core, the organization that streams music around the planet |

## Easter eggs and secrets

*Hidden things and the story behind them (e.g. the Wrecking Crew transmission).*

-

## Open questions

*Things not decided yet. Claude may list questions here when Matt asks, but never answers them itself.*

- Names of the three alien species (starting with C, Y and M).

## Lore log

*One line per change: date, what was added or changed.*

- 2026-11-08: Document started (empty sections).
- 2026-11-08: The world after the war with three alien species; the rename to Neo-Earth; the rebuilt network and the NESE; vocabulary (Neo-Earth, Earth Two / Bad Earth, NESE).

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
