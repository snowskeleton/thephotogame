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

- `ADMIN_EMAIL`: your address. It becomes the site admin when you first sign in.
  If empty, the first person to confirm an email becomes the site admin, which
  with public sign-ups on could be anyone, so set it.
- `TIME_ZONE`: used for grouping photos by day.
- `MAIL_FROM`: the sender for sign-in codes and invites, on your Resend domain.
- `TURNSTILE_SITE_KEY`: optional, see below.

Email goes out through [Resend](https://resend.com) (its free tier is plenty).
Verify your sending domain there, then:

```bash
npx wrangler secret put RESEND_API_KEY
```

It asks you to paste the key, stores it encrypted with the Worker, and takes
effect immediately. Without it, sign-in codes and invites are only printed to
the Worker's log (`npx wrangler tail`), and the app shows you a banner until
it's set. **Site admin → Settings** has the same steps and a test button.

To stop bots signing up and spending your email allowance, add a Turnstile
widget in the Cloudflare dashboard (Turnstile → Add widget, with your site's
domain), put its site key in `TURNSTILE_SITE_KEY`, and:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

Deploy, and again after every change:

```bash
npm run deploy
```

The site comes up on `thephotogame.<you>.workers.dev`. To use your own domain,
add it under the Worker's **Settings → Domains & Routes** in the Cloudflare
dashboard.

## First use

1. Open the site, tap **Sign in**, enter the `ADMIN_EMAIL` address and your
   name, and enter the emailed code. That's the site admin account.
2. Check **Site admin → Settings**: email, public sign-ups and limits.
3. Create a game from the home page, then add categories, teams and awards
   under its **Host** tab.
4. Share the join link or QR from **Host → Game**, or invite people by email
   from **Host → Teams**. Make co-hosts there too.

Anyone else can sign up the same way and host their own games once their email
is confirmed (turn this off under Settings).

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
plan, 30 on paid (`npx wrangler d1 time-travel`). Photos stay in the R2 bucket; a host's
**Download all** button saves every original as a zip.

With strangers uploading, you're hosting their photos. Cloudflare has a free
CSAM Scanning Tool for sites on your own domain, but it scans images passing
through Cloudflare's cache and this app serves photos as private, so check
whether it covers you. A site admin can delete any game from its Host → Game
screen.
