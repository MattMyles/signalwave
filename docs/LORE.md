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

Radio is the main thrust of the entire concept.

Thankfully the underwater cables for Earth's internet network were mostly intact, and over the period of 20 years, a new network was established from scrap parts found in the devastation.

Music was thought to be an important factor to aid in the healing process of Neo-Earth citizens, so an organization was created called the NESE (Neo//Earth Signal Engineers Corps). They set up the infrastructure to stream music around the planet for everyone to listen to, and heal with.

## The listener

*Who is the person using the app, in-world? (A "remote user"? A drifter? A station hacker?) What does "jacking in" mean?*

- Registered users are NESE members, each with a NESE ID number (NESE-0000 is Matt's). Members can send signals/stations to a fellow NESE member by entering their ID.

## The visitors (aliens)

*Who are they, where are they from, why do they care about Neo-Earth music? How do they talk: tone, slang, catchphrases? Anything they would never say?*

- Three advanced alien species fought the near apocalyptic war against Earth:
  - **Cynarii:** silicon-based pack hunters with razor-sharp quartz ridges along their spines.
  - **Yinzosa:** void-adapted organisms that hibernate during travel and awaken to hive-based commands from a central commander.
  - **Mazaelin:** six-limbed apex predators from a high-gravity jungle moon, sporting dense bone-plated skulls.
- Nearly all Neo//Earth citizens still hate the alien species that caused the destruction.
- **The Kryx (the disco-ball visitors in vibe mode):** energy-beings that must remain in constant motion to prevent their plasma matrices from dissipating. A 4th alien species. They are trying to protect Earth as Neo//Earth rebuilds, while listening to the righteous tracks the Neo//Earthlings are broadcasting to keep the morale and vibes high.
- Neo//Earth doesn't know what's going on in space, because they haven't rebuilt that technology yet; they don't know the Kryx are protecting them.
- **How the Kryx talk:** they've heard classic radio lines, like request lines being open, but know they can't access them because the current Earth atmosphere is too volatile to land in. They say these lines to each other as if emulating radio chatter. Example: "GALACTIC REQUEST LINE OPEN, NEXT TRACK: PROTECT NEO//EARTH".

## Ships and asteroids

*Whose ships fly past in vibe mode? Why are they shooting asteroids?*

-

## Places and factions

*Cities, regions, companies, crews, rival broadcasters...*

- **The elected governing body:** declared that "Earth" existed no longer and renamed the planet Neo-Earth.
- **NESE (Neo//Earth Signal Engineers Corps):** created to use music to help Neo-Earth citizens heal; set up the infrastructure to stream music around the planet for everyone.

## Words and phrases

*In-world vocabulary and what it means. Useful for status messages.*

| Term | Meaning |
|---|---|
| Neo-Earth (also Neo//Earth, Neo // Earth) | The planet's name since the war; "Earth" officially existed no longer |
| Earth Two / Bad Earth | What Neo-Earth is called by individuals so impacted by their injuries that they have trouble processing, depending on their level of brain function |
| NESE | Neo//Earth Signal Engineers Corps, the organization that streams music around the planet |
| Neo//Earthlings | The people of Neo-Earth |
| NESE ID | A NESE member's number, like NESE-0000 |
| Cynarii, Yinzosa, Mazaelin | The three alien species that fought the war against Earth |
| Kryx | The 4th species, who secretly protect Neo-Earth (the disco-ball visitors) |

## Easter eggs and secrets

*Hidden things and the story behind them (e.g. the Wrecking Crew transmission).*

-

## Open questions

*Things not decided yet. Claude may list questions here when Matt asks, but never answers them itself.*

- Whose ships fly past in vibe mode, and why they shoot asteroids.

## Lore log

*One line per change: date, what was added or changed.*

- 2026-11-08: Document started (empty sections).
- 2026-11-08: The world after the war with three alien species; the rename to Neo-Earth; the rebuilt network and the NESE; vocabulary (Neo-Earth, Earth Two / Bad Earth, NESE).
- 2026-11-08: NESE is the Signal Engineers Corps (was "Core"); the K species, the disco-ball visitors who secretly protect Neo-Earth; Neo//Earthlings added to vocabulary.
- 2026-11-08: How the K aliens talk (emulating radio chatter they've overheard); Earth's atmosphere too volatile to land in; radio is the heart of the concept.
- 2026-11-08: Named and described the four species: Cynarii, Yinzosa, Mazaelin (the invaders) and Krynn (the protectors).
- 2026-11-08: The protectors renamed from Krynn to Kryx (Krynn is the world of the Dragonlance series).
- 2026-11-08: App updated to match: new Kryx lines in vibe mode, and the disco ball's orbs now help shoot asteroids.
- 2026-11-08: Registered users are NESE members with NESE IDs; NESE ID added to vocabulary.

---

## Where lore shows up in the app (current text)

What the app says today, so it's clear what the lore would change. File names are for Claude.

**Splash page** (`public/index.html`): logo NEO // EARTH ^RADIO with an ALPHA tag (development marker, not lore); tagline "Live music radio from a random city on Neo-Earth. Neo-Earth music only."; boot log "> LOADING WORLD GRID…" then "> WORLD GRID ONLINE // READY"; button "JACK IN"; first visit asks "WHAT DO YOU WANT TO HEAR FIRST?" (SURPRISE ME // ANY MUSIC, ALL <GENRE>).

**Link previews** (`public/index.html` meta tags, `public/og-image.png`): "Live music radio from a random city on Neo-Earth. Neo//Earth music only." / image tagline "> NEO//EARTH MUSIC ONLY_".

**Vibe-mode visitors: the Kryx** (`UFO_LINES` in `public/vibes.js`), one line shown when the UFO arrives and drops its disco ball; the ball's light orbs also fire at asteroids:
- > GALACTIC REQUEST LINE OPEN, NEXT TRACK: PROTECT NEO//EARTH
- > DISCO DEPLOYED
- > NOW SPINNING FOR NEO//EARTH
- > THIS ONE GOES OUT TO NEO//EARTH
- > GREETINGS FROM KRYX
- > DON'T HANG THE DJ!

**Now-playing panel** (`public/index.html`): labels NOW PLAYING · SIGNAL (the station name) · GENRE · CITY · COUNTRY; small buttons WRONG GENRE? (when genres are picked) and FORGET SIGNAL.

**Status line** (`public/app.js`): > SCANNING FREQUENCIES… · > LINK ESTABLISHED // 128 kbps MP3 · > SIGNAL LOST — RETUNING… · > SIGNAL STALLED · > STILL SCANNING — WIDENING SEARCH… · > RETUNING TO SAVED SIGNAL… · > LINK PAUSED · > TAP PLAY TO START AUDIO · > WRONG GENRE REPORTED — RETUNING… · > SIGNAL FORGOTTEN — RETUNING… · > SHARED SIGNAL RECEIVED · > GLOBE OFFLINE — AUDIO ONLY

**Saved panel and toasts**: SAVED SIGNALS · ADD RECEIVED SIGNAL · > SIGNAL SAVED · > SIGNAL REMOVED · > SIGNALS SYNCED · > THIS SIGNAL CANNOT BE CAPTURED

**NESE members (signed in)**: top button "NESE"; panel title NESE DASHBOARD; ID badge "NEO//EARTH SIGNAL ENGINEERS CORPS / NESE-0000"; dashboard tabs SIGNALS / TRANSMIT; TRANSMIT tab: "SEND A SIGNAL TO A NESE MEMBER", SIGNAL / TO fields, TRANSMIT, COPY LINK INSTEAD, "> Tokyo Beat FM transmitted to NESE-0001.", INCOMING TRANSMISSION SIGNALS ("FROM NESE-0001", ADD; empty: "Nothing incoming yet. Share your ID so members can send you signals."); save toast "> SIGNAL SAVED // FIND IT UNDER NESE" · > 1 INCOMING TRANSMISSION · "No NESE member has that ID.".

**Sign-in email** (`supabase/templates/magic_link.html`): subject "Welcome to the Neo//Earth Signal Engineers Corps // code ######"; "> TRANSMISSION RECEIVED" · "Welcome to the Neo//Earth Signal Engineers Corps." · YOUR SIGN-IN CODE · footer "> LINK STANDING BY".

**Easter egg** (Wrecking Crew, `wreckingcrew.mp3`): > UNKNOWN SIGNAL DETECTED… · > LINK HACKED // STREAM CORRUPTED // JAM IMMINENT · TERMINATE REMOTE USER · > REMOTE USER TERMINATED — RESTORING SIGNAL… · > TRANSMISSION COMPLETE — RETUNING…
