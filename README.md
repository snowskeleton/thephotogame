# The Photo Game

A mobile website for a family photo scavenger hunt: categories, teams, a bingo
board, nightly reveal, approval voting, awards and a leaderboard. See
[DESIGN.md](DESIGN.md) for how the game works.

It runs on Cloudflare Workers, with D1 for the database and R2 for the photos.
All of it fits the free plan for a family-sized game.

## Deploy

Cloudflare builds and deploys straight from GitHub, and creates the database
and photo bucket on the first deploy. The app sets up its own tables.

1. In the Cloudflare dashboard: **Workers & Pages → Create → Import a
   repository**, and pick this repo. Keep the name `thephotogame` (it has to
   match `wrangler.jsonc`), leave the deploy command as `npx wrangler deploy`,
   and set the production branch to `main`. The build command can stay empty:
   `wrangler deploy` builds the app itself.
2. Once it's deployed, open the Worker's **Settings → Variables and Secrets**
   and add:
   - `OWNER_EMAIL` (type *Text*): your email. That account becomes the site
     admin when you first sign in. Until it's set, the site shows a setup notice
     and nobody can be site admin.
   - `RESEND_API_KEY` (type *Secret*): an API key from
     [Resend](https://resend.com/api-keys) with sending access.

   Saving these redeploys the Worker; nothing needs rebuilding. Later deploys
   keep them (`keep_vars` is on in `wrangler.jsonc`).
3. Open the site (`thephotogame.<your-subdomain>.workers.dev`), tap **Sign in**
   and enter your email and name.

   Until you set a sender address, email goes out from Resend's test address,
   which only delivers to the email your Resend account uses. If `OWNER_EMAIL` is
   a different address, or you skipped the key, your first code is in the
   Worker's **Logs** tab in the dashboard instead.
4. In the app, **Site admin → Settings**: once you've verified a domain in
   [Resend → Domains](https://resend.com/domains), enter a sender address on it
   so email reaches everyone. Check the sign-up switch and limits while you're
   there.

Every push to `main` deploys again. Other branches get a preview build.

**Optional, all under Settings → Variables and Secrets:**

- `TIME_ZONE`: for grouping photos by day (default `America/New_York`).
- `TURNSTILE_SITE_KEY` (text) and `TURNSTILE_SECRET` (secret): a bot check on
  sign-up, so bots can't spend your email allowance. Make a widget under
  **Turnstile → Add widget** for your site's domain to get them.
- `PHOTOS_URL`: see [Photo scanning](#photo-scanning).
- Your own domain: the Worker's **Settings → Domains & Routes**.

## First use

1. Create a game from the home page, then add categories, teams and awards
   under its **Host** tab.
2. Share the join link or QR from **Host → Game**, or invite people by email
   from **Host → Teams**. Make co-hosts there too.

Anyone else can sign up the same way and host their own games once their email
is confirmed (turn this off under Settings).

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # local stand-ins for the dashboard variables
npm run dev
```

`npm run dev` uses local copies of D1 and R2 kept in `.wrangler/`. Sign-in codes
are printed to the console. `npm run preview` builds the app and runs it in
`workerd`, Cloudflare's actual runtime, which is the closer check before pushing.

Schema changes go in a new numbered file in `migrations/`. The app applies any
it hasn't run yet when it starts, locally and in production, and records them
in wrangler's `d1_migrations` table.

## Backups

```bash
npx wrangler d1 export thephotogame --remote --output backup.sql
```

D1 can also restore the database to any minute in the last 7 days on the free
plan, 30 on paid (`npx wrangler d1 time-travel`). Photos stay in the R2 bucket; a host's
**Download all** button saves every original as a zip.

A site admin can delete any game from its Host → Game screen.

## Photo scanning

With strangers uploading, you're hosting their photos, so it's worth turning on
Cloudflare's free CSAM Scanning Tool. It checks images as they pass through
Cloudflare's cache, so the app has to fetch photos through a cached address
instead of straight from the bucket. This needs the site on your own domain.
In the Cloudflare dashboard (with `yourdomain.com` as your domain):

1. Put the app on your domain: the Worker's **Settings → Domains & Routes**,
   for example `game.yourdomain.com`.
2. Give the bucket an address: **R2 → thephotogame-photos → Settings →
   Custom Domains**, connect `photos.yourdomain.com`. That makes the bucket
   reachable at that address, so close it in the next step.
3. **Security → WAF → Custom rules → Create rule**, choose *Edit expression*,
   and paste this, with action **Block**:
   ```
   (http.host eq "photos.yourdomain.com" and cf.worker.upstream_zone ne "yourdomain.com")
   ```
   Now only this app's Worker can fetch from it, and the app still decides who
   sees which photo. (The free plan includes 5 custom rules.)
4. Add a variable `PHOTOS_URL` set to `https://photos.yourdomain.com` under the
   Worker's **Settings → Variables and Secrets**.
5. **Caching → Configuration → CSAM Scanning Tool**: turn it on and give it an
   email address for alerts. Matches are blocked where possible and reported to
   you once a day.

Then check: opening `https://photos.yourdomain.com/photos/1/thumb.jpg` in a
browser should be blocked, while photos in the app still load. Leave
`PHOTOS_URL` empty to go back to reading the bucket directly.

## API keys

Site admins and game hosts can make scoped API keys under **Account → API keys**; see [docs/API.md](docs/API.md).
The migration `0004_api_keys.sql` applies itself on the first request after deploy.

## Tests

```
npm test            # unit tests: server modules against a real local D1 and R2 (a few seconds)
npm run test:e2e    # builds the app, then drives the built Worker over HTTP (about 30 seconds)
npm run test:ui     # builds, then real Chromium (desktop and phone sizes) against the built Worker
npm run test:all
```

Both run in workerd through `@cloudflare/vitest-plugin`, the same runtime as production, with throwaway local
storage. They need no Cloudflare account and never touch real data. Test bindings live in `tests/wrangler*.jsonc`.

- `tests/unit/` calls the modules in `src/lib/server` directly: scoring, claims, grants, auth, API-key permissions,
  uploads, logging, migrations.
- `tests/e2e/` signs people in with seeded sessions (one test does the real emailed-code flow) and checks what each
  role can open, upload, score, vote on and delete, plus the JSON API.

`test:ui` starts `wrangler dev --local` with throwaway storage on port 8799 and drives it with Playwright. First run:
`npx playwright install chromium`. Tests sign people in with seeded sessions (one signs in with the real emailed code,
read from the Worker's log, and one saves and uses a passkey on a virtual authenticator). Every test fails on a page
error, a 5xx, or a `server_error`/`client_error` row the app logged while it ran.
