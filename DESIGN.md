# The Photo Game — design notes

A mobile-first website for a family photo scavenger hunt. A showrunner sets up
categories; teams hunt for them during the day, upload photos, and everyone
looks through the day's photos together at night, votes, and wins prizes.

## Decisions

| Topic | Decision |
|---|---|
| Platform | Mobile website (iPhone and Android), Jackbox-style join link |
| Hosting | Single Docker container behind Caddy, on its own subdomain |
| Email | Sent through the existing SMTP server |
| Competitors | Colored teams; a team can be one person. Every photo is credited to the person who took it |
| Teams | Per game: the admin assigns teams, or players team up themselves. A max team size is shown; admins can exceed it and the team is flagged as oversized |
| Scoring | Each photo earns points from its category's scoring options, plus voted awards, pencilled-in awards and optional bingo bonuses |
| Voting | Approval voting: vote for as many photos as you like, most votes wins |
| Submissions | Any number per category, on the honor system. Optional per-category cap on how many photos score; admins can disqualify |
| Visibility | Per game: photos hidden until the showrunner reveals them, or always visible |
| Structure | Categories can carry a day label, so a game can be trip-long, daily, or mixed |
| Media | Photos only |
| Content | Generic. The showrunner enters categories in the admin screens; nothing is hard-coded |

## Stack

- **SvelteKit** (Node adapter): one process serves pages and API.
- **SQLite** (Node's built-in driver) in a Docker volume, next to the photo
  files. Backup = copy one folder.
- **sharp** makes thumbnails and screen-sized copies; originals are kept.
- **SimpleWebAuthn** for passkeys, **nodemailer** for email.
- Configuration by environment variables: `ORIGIN`, `ADMIN_EMAIL`, `SMTP_*`,
  `DATA_DIR`, `TZ`.

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

5. After signing in with a code, a link or a fresh join, the next page offers
   to save a passkey on that device ("Not now" stops it asking for 30 days).

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

## People (admin)

Admin → People lists everyone with search and filters (admins, not signed in
yet). Admins can add one person or paste a list, make someone an admin, put
them in a game, and optionally email a one-time sign-in link (good for 7
days). Each person's page edits name, email and admin rights, games and
teams, shows a sign-in link / QR, emails a link, signs them out everywhere,
removes passkeys, or deletes them. Admins can't remove their own admin rights
or delete themselves, so there is always one admin.

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
