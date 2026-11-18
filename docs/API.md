# API keys and the JSON API

A **site admin** or a **game host** can make an API key at **Account → API keys** so a script or assistant can run
parts of the site. (Site admin is the "owner": `OWNER_EMAIL` and anyone they promote. A host runs the games they host.)

## How keys are limited

A key acts as the person who made it and can never do more than they can:

- A **site admin** can make a site-wide key (every game, plus the site scopes) or a key limited to one game.
- A **host** can only make a key limited to **one game they host**, with game scopes.
- Anyone can tick fewer permissions than they're allowed, and set an expiry.
- On **every request** the key's scopes are re-checked against the maker's *current* power. Remove someone as host of
  that game, or take away their site-admin rights, and their keys stop working immediately.
- Keys can't make keys. The API has no sign-in links, passkey or session control, no role changes (hosts or admins),
  no changing or deleting people, and no game deletion.
- Only a SHA-256 hash is stored; the token is shown once. Site admins see and can revoke every key, others their own.

## Scopes

| Scope | Who can grant | Allows |
|---|---|---|
| `games:read` | site admin, host | settings, categories, teams, awards, photo metadata, scores |
| `games:write` | site admin, host | edit settings, categories (+scoring), teams, awards, reveal/unreveal, put players in teams |
| `photos:moderate` | site admin, host | disqualify/restore, adjust points, delete photos |
| `players:read` | site admin, host | people in the game (names, emails, role, status) |
| `players:write` | site admin, host | invite players by email (counts toward the daily invite limit), remove players (never hosts) |
| `site:read` | site admin, site-wide keys only | list all games and people; read settings |
| `site:write` | site admin, site-wide keys only | create games, add people (with invite), change settings |

Deleting a category also deletes its photos, so it needs `games:write` **and** `photos:moderate`.

## Using it

```
curl -H "Authorization: Bearer pgk_..." https://thephotogame.lyonslabs.net/api/v1/me
```

Bodies are JSON objects; responses are JSON; errors are `{"error": "..."}` with 401 (bad/expired/revoked key, or the
maker lost the power), 403 (scope or game limit), 404, 400, 409 or 429. Session cookies are ignored on `/api`.

```
GET    /api/v1/me
GET    /api/v1/games                       POST   /api/v1/games {name}            (site:write)
GET    /api/v1/games/:code                 PATCH  {name, visibility, team_mode, max_team_size, submissions_open,
                                                   doubt_limit, bingo, bingo_cols, bingo_line_points, bingo_board_points}
POST   /api/v1/games/:code/reveal | unreveal
GET    /api/v1/games/:code/scores
GET|POST         /api/v1/games/:code/categories {name, points}
PATCH|DELETE     /api/v1/games/:code/categories/:id   (PATCH: name, rules, notes, day_label, scoring_cap, active,
                                                       options:[{id?, label, points, kind: tier|extra}])
GET|POST         /api/v1/games/:code/teams {name, color}
PATCH|DELETE     /api/v1/games/:code/teams/:id
GET|POST         /api/v1/games/:code/awards {name, description, points, scope}
PATCH|DELETE     /api/v1/games/:code/awards/:id       (PATCH may set status: draft|open|closed)
GET              /api/v1/games/:code/photos?category=&team=&status=&user=&limit=
PATCH|DELETE     /api/v1/games/:code/photos/:id       (PATCH: status ok|disqualified, points_override)
GET|POST         /api/v1/games/:code/players {email, name?}
PATCH|DELETE     /api/v1/games/:code/players/:userId  (PATCH: team_id)
GET|PUT          /api/v1/settings                     (site:read / site:write: signups, maxGames, maxPhotos, mailFrom)
GET|POST         /api/v1/people {name, email, game?}  (site:read / site:write)
```
