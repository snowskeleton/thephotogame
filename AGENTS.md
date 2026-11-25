# Working in this repo (for agents)

The Photo Game: a mobile website for family photo scavenger hunts. Product rules are in `DESIGN.md`, the JSON API in
`docs/API.md`, setup and deploy in `README.md`. This file covers how it is hosted, how to change it, and how to test it.

## Hosting

- SvelteKit 3 with `@sveltejs/adapter-cloudflare`. One Cloudflare Worker serves the pages, form actions and `/api/v1`.
- **D1** (SQLite) is the database, binding `DB`. **R2** holds photos, binding `PHOTOS`. Both are named in `wrangler.jsonc`
  without IDs; the first deploy creates them.
- **Production deploys from `main`** through Workers Builds (Cloudflare pulls from GitHub). Every push to `main` deploys.
  Other branches and PRs get a preview build (`wrangler preview`) with their own database and bucket
  (`thephotogame-preview`, `thephotogame-photos-preview`, set in the `previews` block of `wrangler.jsonc`).
  The `cloudflare` branch is merged and unused.
- Variables and secrets live in the Cloudflare dashboard and survive deploys (`keep_vars`): `OWNER_EMAIL` (required),
  `RESEND_API_KEY`, `TIME_ZONE`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `PHOTOS_URL`. Never commit them.
  Locally they go in `.dev.vars` (git-ignored; copy `.dev.vars.example`).
- Site settings an admin edits in the app (sender address, sign-ups, limits) live in the `setting` table.
- Email goes through Resend's HTTP API. With no `RESEND_API_KEY`, the Worker prints the message, including the sign-in
  code, to its log instead of sending it. Tests rely on this.
- Free-plan limits (10 ms CPU per request, 5M D1 rows read per day) are cost signals now, not outage risks, but keep
  requests cheap. `src/hooks.server.ts` runs on every request: keep it to one session query and answer probe paths
  (`apple-touch-icon*`, `meta.json`) before touching D1.

## Layout

- `src/routes/` pages and form actions (`+page.server.ts`), `api/v1/[...path]/+server.ts` is the whole JSON API.
- `src/lib/server/` all server logic: `db.ts` (async `all/get/run/insert/batch/q`), `scoring.ts`, `claims.ts`,
  `grants.ts`, `game.ts` (viewer, host checks, visibility), `perms.ts` (API keys), `auth.ts`, `uploads.ts`, `images.ts`,
  `log.ts`, `migrate.ts`, `webhooks.ts` (outgoing webhooks: Ember threads, signed JSON), `superlatives.ts` (host-given titles),
  `items.ts` (category checklists: `category_item` rows, `photo.item_id`).
- `src/lib/` browser code and shared helpers (`resize.ts` makes thumbnails in the browser, `browse.ts` gallery filters).
- `migrations/NNNN_name.sql` the schema. The app applies new files itself on the first request each Worker instance
  serves and records them in `d1_migrations`. There is no migrate step.
- `tests/` see Testing below.

## Rules that are easy to break

- **D1 is async and has no BEGIN/COMMIT.** Writes that must happen together go through `batch()`.
- **Migrations:** add a new numbered file. Use `IF NOT EXISTS`. `migrate.ts` strips `--` comments and splits on `;`, so
  no semicolons inside strings or comments. A `CREATE TRIGGER ... BEGIN ... END` is kept whole.
- **Players are untrusted.** Only hosts (`viewer.isHost`: game host or site admin) set points. A player's claim is stored
  only as a guess (`photo_guess`), which never scores; it feeds the "pending" totals and the host's Confirm button.
  Enforce on the server first, then hide the UI.
- **Category limits** (`scoring_cap`, `max_points`) are per team per category and first come first served by
  `photo.created_at`. A later photo only fills the room left; the rest is its overage (`PhotoScore.over`). Photos
  from other categories that also earn points from a category's options draw from that category's room. `scoreGame`
  settles twice: confirmed photos only (official), and confirmed plus guesses (`projected`, `pendingPts`, `pools`).
- **Scoring cache:** `scoreGame` reads `score_cache`, valid while its epoch equals `game.score_epoch`. Triggers in
  migration 0009 bump the epoch on writes to scoring tables. A new scoring table needs triggers too.
- **A new score option kind** must be added to `claims.ts`, `ClaimFields.svelte`, the admin category form and server,
  the API option parser, and `docs/API.md`.
- **A new gallery filter** goes into `browseFilter` (`photos.ts`), `browseQuery` (`browse.ts`), the gallery select and the
  slideshow loader together, or it silently resets. Keep navigation state in the URL, not component state.
- **Webhooks:** call `announce(event, photoId)` from `webhooks.ts` after any write that should be reported (it runs after the
  response and never throws). Add a new event to `EVENTS` and `describe()` together. A webhook's address holds a secret key:
  show it only through `publicHook`/`maskUrl`. Hidden-game photos are withheld unless the webhook's `hidden_ok` is set.
- **API keys** act as their minter and are re-checked against the minter's current power on every request. Do not add
  routes that change sessions, passkeys, roles or keys.
- **Photos:** a photo hidden by the reveal rules must be refused on both its page and `/media/...`.

## Merging

When a PR is open, all three suites pass locally and its CI checks pass, merge it (squash, delete the branch) without waiting to be asked. Stop only if a check fails or the work is unfinished.

## Setup

```bash
npm ci                 # Node 26 (.node-version)
npx playwright install chromium   # only needed for the UI tests
npm run check          # svelte-check: 0 errors expected, about 14 old warnings
npm run build
```

`npm run dev` runs locally with local D1/R2 in `.wrangler/`. `npm run preview` builds and runs in workerd, the closer check.

## Testing

Three suites, all local, none touch Cloudflare or real data. Run the one that matches your change, and all of them
before opening a PR.

| Command | What it runs | Time |
|---|---|---|
| `npm test` | Vitest unit tests in `tests/unit/`: server modules called directly in workerd with a real local D1 and R2 | seconds |
| `npm run test:e2e` | Builds, then Vitest in `tests/e2e/` sends HTTP requests to the built Worker through `SELF.fetch` | ~30 s |
| `npm run test:ui` | Builds, then Playwright in `tests/ui/` drives real Chromium against the built Worker under `wrangler dev --local` | ~2 min |
| `npm run test:all` | all three | |

Run ALL three suites (`npm run test:all`) before merging or pushing to `main`, for every change, including ones that look unrelated to the UI. Read the result; do not skip a suite because it is slow.

**Unit** (`@cloudflare/vitest-plugin`, config `vitest.config.ts`, bindings in `tests/wrangler.test.jsonc`). Helpers in
`tests/unit/helpers.ts` seed users, games, teams, photos and claims. The plugin does not roll D1 back between tests, so
`useDatabase()` deletes the data tables before each test. Import app modules directly; `cloudflare:workers` works.

**E2E** (`vitest.e2e.config.ts`, bindings in `tests/wrangler.e2e.jsonc`, which points at `.svelte-kit/cloudflare`). Run
`npm run build` first or use the script. Helpers in `tests/e2e/helpers.ts`:
- Seed with `world()`; sign people in with `session(userId)`, which inserts a hashed session row and returns a cookie.
- Form posts need an `Origin` header equal to the base URL (SvelteKit CSRF) and `Accept: text/html`, else redirects come
  back as 200 JSON. `post()` does both.
- API calls send `Content-Type: application/json`. Without it, bodiless POST/PATCH/DELETE get 403 from the CSRF check.
  One `it.fails` test pins that gap; remove the `.fails` if it is fixed.
- The emailed code is stored only as a hash. `tests/e2e/login.test.ts` finds it by hashing all 10^6 candidates.

**UI** (`playwright.config.ts`, projects `desktop` and `phone` = Pixel 7 emulation, port 8799, one worker).
`tests/ui/serve.mjs` starts the Worker with a fresh persist dir and writes `tests/ui/.run/state.json`.
`tests/ui/fixtures.ts` opens the miniflare SQLite file with `node:sqlite` to seed data and reads sign-in codes from the
Worker's log.
- Tests share one database. Make your own game with `world` and scope every query to `world.g.id`.
- Seed photos with `site.upload(userId, code, { category })`, which posts to the real upload action. Use the real
  uploader (`setInputFiles` on the file input) only in tests about uploading.
- An automatic `guard` fixture fails any test that sees a page error, `console.error`, a 5xx, or a `server_error`,
  `client_error` or `api_error` row in the `event` table. Do not disable it to make a test pass; find the error.
- Passkeys are tested with Chromium's virtual authenticator over CDP.
- Known limits: the `scrollGuard` plugin in `vite.config.ts` has no test that fails without it, and WebKit/Safari is not
  covered.

### Writing and changing tests

- A bug fix gets a test that fails without the fix. A new rule gets a test for the allowed and the forbidden case.
- Test behavior, not implementation. Use real bindings, not mocks.
- Cover every role boundary you touch: signed out, other team, player, host of another game, host, site admin.
- Prove a new test can fail: break the code under test, watch it fail, restore it.
- If you change behavior that a test pins on purpose (a comment says so), change the test in the same commit and say why.
- Do not edit a failing test to match a bug. Decide which one is wrong.

## Workflow

- Branch, change, then run `npm run check` and the relevant suites. Open a PR against `main`. Wait for the preview build.
- Schema or permission changes always go through a PR, even when told to "just push it".
- Commits are GPG-signed by the machine's global config. Do not change git config.
- When you finish, say which suites you ran and whether UI changes were actually clicked through (the UI suite counts).

## Production diagnostics (site admins and agents with the right keys)

- The app's own log is the `event` table (`server_error`, `client_error`, `api_error`, `mail_failed`, `turnstile_failed`),
  readable through `GET /api/v1/logs` with a site-wide `logs:read` key or with
  `npx wrangler d1 execute thephotogame --remote --command "SELECT ... FROM event ORDER BY at DESC"`.
- Worker request stats are in Cloudflare observability (`$workers.outcome`, `$workers.event.response.status`).
- D1 reads: `npx wrangler d1 insights thephotogame --time-period 1d --sort-by reads`. Rows read is rows scanned, so a
  missing index is the usual cause. Check new queries with `EXPLAIN QUERY PLAN` against the migrations.
- A user report of a "500" with no 5xx in the stats is usually a client-side navigation failure; look for `client_error`
  rows with the user-agent.
