# The Photo Game

A mobile website for a family photo scavenger hunt: categories, teams, a bingo
board, nightly reveal, approval voting, awards and a leaderboard. See
[DESIGN.md](DESIGN.md) for how the game works.

It runs on Cloudflare Workers, with D1 for the database and R2 for the photos.
All of it fits the free plan for a family-sized game.

## Deploy

One-time setup (needs a Cloudflare account; `npx wrangler login` first):

```bash
npm install
npx wrangler d1 create thephotogame        # copy the database_id it prints into wrangler.jsonc
npx wrangler r2 bucket create thephotogame-photos
npm run db:migrate:remote
```

Then edit `vars` in `wrangler.jsonc`:

- `ADMIN_EMAIL`: this account becomes the admin when it first signs in. If empty,
  the very first account created is the admin.
- `TIME_ZONE`: used for grouping photos by day.
- `MAIL_FROM`: the sender for sign-in codes and invites.

Email goes out through [Resend](https://resend.com) (its free tier is plenty).
Verify your sending domain there, then:

```bash
npx wrangler secret put RESEND_API_KEY
```

Without that key, sign-in codes are only printed to the Worker's log
(`npx wrangler tail`).

Deploy, and again after every change:

```bash
npm run deploy
```

The site comes up on `thephotogame.<you>.workers.dev`. To use your own domain,
add it under the Worker's **Settings → Domains & Routes** in the Cloudflare
dashboard.

## First use

1. Open the site, tap **Sign in**, and ask for an email code with the
   `ADMIN_EMAIL` address. That creates the admin account. Set your name under
   your account.
2. Create a game under **Admin**, then add categories, teams and awards.
3. Share the join link or QR from the game's **Admin → Game** screen.

## Develop

```bash
npm install
npm run db:migrate     # creates the local database in .wrangler/
npm run dev
```

`npm run dev` uses local copies of D1 and R2 kept in `.wrangler/`. Sign-in codes
are printed to the console. `npm run preview` builds the app and runs it in
`workerd`, Cloudflare's actual runtime, which is the closer check before deploying.

Schema changes go in a new file in `migrations/` (`npx wrangler d1 migrations
create thephotogame <name>`). Apply it with `npm run db:migrate` locally and
`npm run db:migrate:remote` in production.

## Backups

```bash
npx wrangler d1 export thephotogame --remote --output backup.sql
```

D1 can also restore the database to any minute in the last 7 days on the free
plan, 30 on paid (`npx wrangler d1 time-travel`). Photos stay in the R2 bucket; the admin's
**Download all** button saves every original as a zip.
