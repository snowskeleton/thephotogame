# API keys and the JSON API

Owners and admins can mint API keys at **Admin → API keys** so a script or assistant can run parts of the site.

## Roles

- **Player** – plays in games.
- **Admin** – runs games and manages players.
- **Owner** – everything an admin can, plus managing admins. The `ADMIN_EMAIL` account is the owner (on an existing
  site it is migrated to owner; if `ADMIN_EMAIL` is unset, the earliest admin). Only an owner can make or remove
  admins, change an admin's details, or delete an admin; admins can still manage players.

## How keys are limited

A key acts as the person who minted it:

1. You can only tick permissions your role holds (admins don't see the owner-only one as available).
2. Owners can still tick fewer permissions, limit a key to one game, and set an expiry.
3. On **every request** the key's scopes are re-intersected with the minter's current role. Demote or delete the minter
   and the key loses power immediately (admin keys die entirely if the person is no longer an admin).
4. Keys can't mint keys, and the API has no sign-in links, session control or passkey management.
5. Only a SHA-256 hash is stored. The token is shown once. Owners see and can revoke every key; admins see their own.

## Scopes

| Scope | Needs | Allows |
|---|---|---|
| `games:read` | admin | read games, categories, teams, awards, photo metadata, scores |
| `games:write` | admin | create games; edit settings, categories (+scoring lines), teams, awards; reveal/unreveal |
| `photos:moderate` | admin | disqualify/restore photos, adjust points, delete photos |
| `people:read` | admin | list people and game players |
| `people:write` | admin | add players, rename, game/team membership (players only) |
| `people:privileged` | owner | change email or role, delete people (also needs `people:write` for delete) |

Deleting a category also deletes its photos, so it needs `games:write` **and** `photos:moderate`.
Game deletion is not in the API.

## Using it

```
curl -H "Authorization: Bearer pgk_..." https://your.site/api/v1/me
```

Bodies are JSON objects; responses are JSON; errors are `{"error": "..."}` with 401 (bad key), 403 (scope/role/game
limit), 404, 400 or 409. Session cookies are ignored on `/api`.

```
GET    /api/v1/me
GET    /api/v1/games                       POST   /api/v1/games {name}
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
GET|POST         /api/v1/people {name, email, game?}
PATCH|DELETE     /api/v1/people/:id                   (PATCH: name; email, role need people:privileged)
```
