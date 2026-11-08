# Renaming protocol

Signal Wave (shown as **Signal Wave ER**, "Earth Radio") shares its core name
with **Signal Wave Radio**, a UK online radio station run by ScoobyMedia Group.
That's fine for a personal hobby project, but it is a real trademark risk for
anything public-facing and commercial. This document is the plan for switching
to a new name when the time comes.

## When to run it

Rename **before** any of these, not after:

- Submitting to the App Store or Google Play
- Making money in any way: ads, subscriptions, a paid app, tips or donations, sponsorships, selling merchandise
- Buying a custom domain or doing real promotion (press, paid ads, big social pushes)
- Receiving a complaint, cease-and-desist letter, or App Store name dispute (see "If a complaint arrives" below)

Renaming early is cheap. Renaming after launch costs reviews, links, search ranking and the home-screen installs people already have.

## Step 1: Pick and clear the new name

Check every candidate before committing to it. Not a substitute for a lawyer, but catches most problems.

1. **Web search** for `"<name>"`, `"<name>" radio`, `"<name>" app` and `"<name>" music`. Any active radio station, streaming service, music app or record label using it rules it out.
2. **USPTO**: search [tmsearch.uspto.gov](https://tmsearch.uspto.gov) for the name and close spellings. Conflicts that matter are in class 9 (apps/software), 38 (streaming/broadcasting) and 41 (entertainment). Unrelated classes (shipping, law, fleet tracking) are generally fine.
3. **UK and EU**: search the [UK IPO](https://trademarks.ipo.gov.uk/ipo-tmtext) and [EUIPO](https://euipo.europa.eu/eSearch/) the same way, since the app store is worldwide.
4. **App Store and Google Play**: search for apps with the same or a confusingly similar name.
5. **Domain and handles**: check the `.com` (or a close variant) and the main social handles are available.
6. If money is going into it: a trademark attorney or paid clearance search (roughly an hour of a lawyer's time) is cheap insurance.

Once chosen, **secure it the same day**: buy the domain, claim the social handles, and consider filing a US trademark in classes 9 and 41 (a few hundred dollars per class).

## Step 2: Change the code

Only what people see changes. **Leave these alone**, or existing users lose their saved stations and sign-ins:

- The GitHub repo, Vercel project and Supabase project names (users never see them)
- Browser storage keys starting with `sw.` (favourites, visitor ID, sign-in session, settings)
- The export file's `"app": "signal-wave"` field (old exports must still import)
- `package.json` name, code comments, the service-worker cache name prefix

To list every remaining mention of the old name in user-facing files:

```sh
grep -rniE "signal ?wave|SIGNAL<b>//</b>WAVE|SIGNAL//WAVE" public api supabase/templates README.md \
  --exclude-dir=vendor | grep -v "sw\.\|signal-wave-v\|'signal-wave'\|signal-wave-favorites"
```

Files to update (as of the "Signal Wave ER" rename):

| File | What to change |
|---|---|
| `public/index.html` | `<title>`, `og:site_name`, `og:title`, `og:image:alt`, `twitter:title`, `apple-mobile-web-app-title`, the top-bar logo and its `aria-label`, the boot-screen logo (`data-text` and `aria-label` too) |
| `public/manifest.webmanifest` | `name`, `short_name` (keep `short_name` to about 12 characters so it fits under the icon) |
| `public/app.js` | Share text ("Listen to … on …"), the "Paste a … station link" message, the import-failed toast |
| `public/admin.html` / `public/admin.js` | Page title, dashboard logo, "Checked by …" label and note |
| `api/station.js` | "That doesn't look like a … station link" error |
| `supabase/templates/magic_link.html` | Logo text, subject line in the comment, body text |
| `README.md` | Title and mentions |
| `public/styles.css` | Only if the logo's length changes: check `.brand.big` still fits on a 390px-wide phone (the boot screen) |

Optional: rename the export download file (`signal-wave-favorites.json` in `app.js`) — imports don't depend on the file name.

## Step 3: Change the images

- **`public/og-image.png`** (1200×630, the link-preview picture) has the name baked in. Regenerate it with the new logo.
- **Icons** (`icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.svg`, `favicon-32.png`) don't currently contain the name. Only redo them if the new brand gets a new look.

## Step 4: Ship and check

1. Bump the cache name in `public/sw.js` (`signal-wave-vNN` → next number) so phones pick up the new files.
2. Run `npm test`, push to `main`, wait for Vercel to deploy.
3. On the live site, check: browser tab title, top bar, boot screen on a phone, admin dashboard, a shared link's preview in iMessage (previews are cached; test with a fresh link such as `/?v=2`).

## Step 5: Outside the code

- **Supabase** → Authentication → Emails → Magic Link: paste the updated `magic_link.html` and change the subject line. This doesn't happen automatically.
- **Vercel**: if a custom domain was bought, add it under Project → Domains (and set `SITE_URL` to it so link previews use it). The old `*.vercel.app` address keeps working.
- **Supabase** → Authentication → URL Configuration: add the new domain to the Site URL / redirect URLs, or sign-in links will break on it.
- **Home-screen installs** keep the old name under the icon until people remove and re-add the app. A one-time toast or note on the boot screen can tell them.
- **App Store listing** (if one exists): the app name, subtitle, keywords, screenshots and description all need the new name. The bundle ID can stay as it is.

## If a complaint arrives

1. Don't ignore it, and don't argue on the spot. Note the deadline it gives.
2. Stop using the name in anything new (posts, promotion) straight away.
3. If it's an App Store dispute, Apple usually connects both sides by email; reply politely that you'll rename.
4. Run this protocol. Renaming promptly almost always ends it; a hobby project that rebrands quickly is very unlikely to face anything further.
5. If it asks for money or threatens a lawsuit, talk to a lawyer before replying.
