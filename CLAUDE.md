# Signal Wave ER — notes for Claude

Random live music radio from a random city on Earth, on a neon globe. Plain HTML/CSS/JS front end in `public/`, Vercel serverless functions in `api/`, shared server code in `lib/`, Supabase for sign-in and cross-device sync.

## Working on it

- `npm test` runs the offline tests. `PORT=3000 node server.js` serves the site and API locally.
- Pushing to `main` deploys to Vercel (live site). Matt uses it on his iPhone as a home-screen app.
- After changing anything in `public/`, bump the cache name in `public/sw.js` (`signal-wave-vNN`) so installed copies pick up the update.
- Keep it working at iPhone width (390px) and respect `prefers-reduced-motion`.
- Hidden extras: typing `wreckingcrew.mp3` in the "Add a shared station" box plays the Easter egg (`public/media/wreckingcrew.mp3`); vibe mode effects live in `public/vibes.js`.

## The name

"Signal Wave" overlaps with **Signal Wave Radio**, an active UK online radio station run by ScoobyMedia Group. It's kept for now because this is a hobby project, shown as **Signal Wave ER** ("Earth Radio", with ER small and raised after the logo).

**Before any app store submission, monetization (ads, subscriptions, paid app, tips, sponsorships, merch), custom domain or serious promotion, or on any name complaint: rename first.** Follow [docs/RENAMING.md](docs/RENAMING.md) (or the `/signalwave-rename` skill). If a task heads toward any of those, point this out before doing it.

When renaming, change only user-facing text and images. Never rename the GitHub repo, Vercel or Supabase projects, the `sw.*` browser storage keys, or the export format's `"app": "signal-wave"` field, so existing users keep their saved stations and sign-ins.
