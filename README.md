# The Photo Game

A mobile website for a family photo scavenger hunt: categories, teams, a bingo
board, nightly reveal, approval voting, awards and a leaderboard. See
[DESIGN.md](DESIGN.md) for how the game works.

## Run it

```bash
cp .env.example .env    # then edit it
docker compose up -d --build
```

The app listens on `127.0.0.1:3000`. Everything it stores (the SQLite database
and all photos) lives in `./data`; back up that folder.

Caddy:

```
photos.example.com {
	request_body {
		max_size 250MB
	}
	reverse_proxy 127.0.0.1:3000
}
```

`ORIGIN` must match the public URL exactly. The container runs as the `node`
user (uid 1000), so `./data` must be writable by it: `mkdir data && sudo chown 1000:1000 data`.

## First use

1. Open the site, tap **Sign in**, and ask for an email code with the
   `ADMIN_EMAIL` address. That creates the admin account. Set your name under
   your account.
2. Create a game under **Admin**, then add categories, teams and awards.
3. Share the join link or QR from the game's **Admin → Game** screen.

## Develop

```bash
npm install
npm run dev
```

Needs Node 24+. Without `SMTP_HOST`, sign-in codes are printed to the console.
