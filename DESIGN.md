# The Photo Game — design notes

A mobile-first website for a family photo scavenger hunt. A showrunner sets up
categories; teams hunt for them during the day, upload photos, and everyone
looks through the day's photos together at night, votes, and wins prizes.

## Decisions

| Topic | Decision |
|---|---|
| Platform | Mobile website (iPhone and Android), Jackbox-style join link |
| Hosting | Cloudflare Workers (free plan), with D1 for data and R2 for photos |
| Email | Sent through Resend's HTTP API (Workers can't speak SMTP) |
| Competitors | Colored teams; a team can be one person. Every photo is credited to the person who took it |
| Roles | A **site admin** (you) runs the whole site. Each game has one or more **hosts**, who run that game only. Everyone else is a player. Hosts and players can be in any number of games |
| Sign-up | Public: anyone can make an account and, once their email is confirmed, host games (a site admin can turn this off). Playing doesn't need a confirmed email |
| Teams | Per game: the host assigns teams, or players team up themselves. A max team size is shown; admins can exceed it and the team is flagged as oversized |
| Scoring | Each photo earns points from its category's scoring options, plus voted awards, pencilled-in awards and optional bingo bonuses |
| Voting | Approval voting: vote for as many photos as you like, most votes wins |
| Submissions | Any number per category, on the honor system. Optional per-category cap on how many photos score; admins can disqualify |
| Visibility | Per game: photos hidden until the showrunner reveals them, or always visible |
| Structure | Categories can carry a day label, so a game can be trip-long, daily, or mixed |
| Media | Photos only |
| Content | Generic. The showrunner enters categories in the admin screens; nothing is hard-coded |

## Stack

- **SvelteKit** (Cloudflare adapter): one Worker serves pages and API.
- **D1** (Cloudflare's SQLite) holds the data; the schema is in `migrations/`.
  D1 is async and has no BEGIN/COMMIT, so writes that belong together go
  through `batch()`.
- **R2** holds the photos: the original plus a thumbnail and a screen-sized JPEG.
  The phone makes those two copies before uploading (`src/lib/resize.ts`),
  since Workers can't run sharp. The admin's "download all" zip is built in the
  browser too, to stay inside a Worker's CPU limit.
  With `PHOTOS_URL` set, the photo route fetches through the bucket's custom
  domain instead of the binding, so photos pass Cloudflare's cache and its CSAM
  scanner; a WAF rule lets only this Worker reach that domain.
- **SimpleWebAuthn** for passkeys, **Resend** for email.
- Deployed by Workers Builds from GitHub. `wrangler.jsonc` names the D1
  database and R2 bucket without IDs, so the first deploy creates them and
  later deploys reuse them. The app applies `migrations/` itself on the first
  request each Worker instance serves (`src/lib/server/migrate.ts`), keeping
  wrangler's `d1_migrations` table, so there's no migrate step.
- Configuration lives in the dashboard, which deploys leave alone
  (`keep_vars`): `OWNER_EMAIL` (required), `TIME_ZONE`, `TURNSTILE_SITE_KEY`,
  `PHOTOS_URL`, and the `RESEND_API_KEY` and `TURNSTILE_SECRET` secrets.
  Settings a site admin changes in the app (sender address, public sign-ups,
  limits) live in the `setting` table. Without a sender address, email goes
  from Resend's test sender, which only reaches the Resend account's owner.

## Sign-in

Goal: it just works, and everyone has a unique email on file.

1. Open the join link, enter name and email. A new email is signed in
   immediately; the phone stays signed in for months.
2. An email that already has an account gets a six-digit code first, so
   nobody can join as someone else.
3. The account page offers to save a passkey (Face ID / fingerprint).
4. Signing in again, on any device: enter your email and tap Sign in. If a
   passkey is saved for that email the device asks for it; if there is none
   (or it fails and you choose so) a six-digit code is emailed instead. A QR
   code shown by a device that is already signed in also works.

5. After signing in with a code, an invite, a link or a fresh join, anyone
   without a passkey is offered one. "Not now" carries on, and they're asked
   again at their next sign-in until they save one.
6. A new email on the sign-in page (with public sign-ups on) asks for a name,
   passes the Turnstile bot check, and gets a code. The account is only made
   when the code is entered, so it starts with a confirmed email.

An email counts as **confirmed** after entering an emailed code or accepting
an emailed invite. Hosting a game needs it. Site admin rights also only come
with a confirmed email, and only for `OWNER_EMAIL`. Without it set, nobody
becomes site admin and the site shows a setup notice.

## Hosts and invites

Whoever creates a game is its host. On the game's Teams page a host invites
people by email, resends invites, makes other players hosts (a game always
keeps at least one), and removes players (hosts have to be made players
first). An invited person shows as *invited* until they accept: the email's
link opens a page with an Accept button (a button, so link scanners can't use
it up), which signs them in, confirms their email, adds them to the game and
offers a passkey. Opening the game's join link also accepts. Nobody but a
site admin can make a sign-in link for someone else, so a host can't sign in
as a player who has an account elsewhere on the site.

A host can send 20 invite emails per 24 hours (resends count; site admins have
no cap), so a stranger's account can't spend the site's email allowance. The
join link and QR code have no limit.

Limits a site admin sets: games one person can create (default 3) and photos
per game (default 1000). Site admins and their games aren't limited.

Typed-in fields use `defaultValue={...}`, not `value={...}`. After hydration
Svelte writes a `value={...}` back into the field whenever anything in the
same component redraws (a button label changing to "Joining…" was enough),
which wiped what the person had typed or autofilled. `defaultValue` renders
the same on the server and is never written over the current value. Fields
are read from the form at submit time.

## Team colors

A team's color is a hex value or a named finish from `src/lib/colors.ts`:
metallics (gold, silver, bronze, ...) and shimmer gradients (holographic,
sunset, galaxy, ...). The picker groups them into palettes and is the same
when creating and editing a team. `tv(color)` produces the CSS variables.

## People and settings (site admin)

Site admin → People lists everyone with search and filters. Site admins can
add one person or paste a list, make someone a site admin, and invite them to
a game; everyone added gets an invite email. Each person's page edits name,
email and site admin rights, games and teams, shows a sign-in link / QR (the
fallback when email fails), emails an invite, signs them out everywhere,
removes passkeys, or deletes them. Site admins can't remove their own rights
or delete themselves, so there is always one.

Site admin → Settings shows whether email is set up (with the steps if not, and
a test button), the public sign-up switch, the limits, and the Turnstile
status. Until email is set up, site admins see a banner on every page.

## Categories and scoring

The sample sheet scores each photo individually, with tiers and extras, e.g.
"own name 1 pt, rarest names 3 pts" or "1 pt flat, +0.5 per extra matching
item". So a category has a list of **scoring options**:

- **Tier**: pick one per photo ("Assigned color — 1", "Color match — 2",
  "Color and texture match — 3").
- **Extra**: a per-unit add-on with a quantity ("+0.5 per additional item",
  "1 per person posing").

Points can be fractional (0.5).

The person uploading claims the tier and extras for their photo (honor
system). Checks on that:

- **Doubt**: players on other teams can doubt a photo. When more than the
  game's doubt limit (default 2) doubt it, the photo goes **under review**:
  it earns nothing while everyone votes agree / disagree, and an admin settles
  it (approve or disqualify) with the tally in front of them.
- **Admin override**: an admin can set any photo's points directly, move it
  to another category, disqualify or delete it.
- **Cap**: a category can limit how many photos per team score (the best ones
  count). All photos stay eligible for votes.

## Awards

- **Voted awards**: name, bonus points, and scope — *best in each category*
  or *across all photos*. The admin opens and closes each award's voting.
  You can't vote for your own team's photos. Ties share the win: each tied
  photo's team gets the full bonus. Results show once voting closes.
- **Pencilled-in awards**: at any time the showrunner can give points to a
  team (optionally crediting one person) with a title and note, attached to
  one photo, several photos, or none.
- **Bingo** (per game, optional): the board is a grid; the admin sets points
  for each completed row / column / diagonal and for a full board. Either can
  be 0.

## Screens

Player: **Board** (bulk upload, unsorted photos, bingo grid or checklist in
team color), **Category** (rules, scoring, upload, edit your team's photos), **Gallery** (by category, team, day), **Photo**
(points, doubt, review vote), **Slideshow** (for the nightly look-through),
**Vote**, **Scores** (teams, people, awards), **Account**.

Admin: **Game** settings (visibility, reveal, team mode, max team size, doubt
limit, bingo, submissions open/closed, download all), **Categories**,
**Awards**, **Teams & players**, and site-wide **Users** and **Games**.

## Uploading

The board's **Upload photos** button takes any number of photos. They land in
the photographer's **unsorted** pile (`photo.category_id` is NULL) and get
filed with a category dropdown each. Unsorted photos earn nothing, appear in
no gallery, and only the photographer's team (and admins) can load them.
Filing one sets its time to "now", so in hidden mode a photo filed after a
reveal waits for the next reveal.

A category page also uploads (straight into that category, with the claim and
caption) and stays on the page. Its list of the team's photos has an editor for
the photographer and admins: claim, caption, move to another category (the
claim restarts at the first option) and delete. The page sends one photo per
request with a progress bar, so a big batch doesn't fail as a whole.

## Visibility

In hidden mode a player sees their own team's photos, plus anything uploaded
before the last reveal. "Reveal now" makes everything uploaded so far visible;
doubting and voting only apply to photos a player can see.
