# Mafia City — Telegram Mafia Mini App

Multiplayer Mafia for Telegram, built with the Next.js App Router and Supabase.

- Telegram `initData` is verified server-side against the bot token; the signed,
  HttpOnly session cookie is the only credential the client ever holds.
- Player profiles, lobbies, matches, events, statistics and rankings live in
  Postgres. Nothing is kept in process memory, so state survives restarts and
  works across multiple instances.
- Roles, night actions and votes are resolved on the server. A client can never
  see another player's role (until the game ends) and can never change an
  outcome.
- The interface is multilingual (uz / ru / en), mobile-first, and tested with a
  real browser at six viewports.

## Requirements

- Node.js `>=20.9 <23` and npm.
- A Telegram bot token from BotFather.
- A Supabase project with the schema applied.
- A strong `SESSION_SECRET`.

## Local development

```sh
npm ci
cp .env.example .env.local      # then fill in the values below
npm run db:migrate              # create tables, functions, indexes and RLS
npm run db:check                # prove read/write works against the live project
npm run dev
```

To authenticate from Telegram, expose the local server over HTTPS with a secure
tunnel, point the bot's Mini App URL at it, and open the Mini App from Telegram.
A normal browser or `localhost` has no trusted Telegram `initData`, so the app
shows the "open in Telegram" screen.

### Environment variables

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | server | yes | Verifies `initData` (HMAC). |
| `TELEGRAM_BOT_USERNAME` | server | no | Informational. |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | client | yes | Link to the bot from the gate screen. |
| `SESSION_SECRET` | server | yes | Signs the session cookie (32+ random chars). |
| `SUPABASE_URL` | server | yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | **Server-only.** Reads/writes the database. Every table is behind RLS, so the publishable key cannot access rows. |
| `NEXT_PUBLIC_SUPABASE_URL` | client | no | Realtime endpoint. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | no | Publishable key, used only to subscribe to lobby push channels. It has no table access. |
| `DATABASE_URL` / `SUPABASE_DB_PASSWORD` | scripts | for `db:migrate` | Direct Postgres connection used to apply `supabase/migrations`. |

Never prefix a secret with `NEXT_PUBLIC_`, and never commit `.env.local`.

## Database

Schema and transactional operations live in
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

| Table | Purpose |
| --- | --- |
| `players` | One row per verified Telegram user, with the aggregate statistics and rating. |
| `lobbies` | A room. `state` holds the authoritative live game document; `version` drives change detection. |
| `lobby_members` | Seat assignment, alive flag, host flag and role. Survives an in-progress match. |
| `games` | One row per started match — the source of truth for statistics. |
| `game_players` | Role and outcome per player per game. `unique (game_id, player_id)` makes updates idempotent. |
| `game_events` | Structured match log (`message_key` + `params`, translated on the client). |
| `investigations` | Detective results, readable only by the owning player. |

Atomic transitions are implemented as Postgres functions so a double tap, a
retried request or two racing devices cannot corrupt state:

- `join_lobby(id, player)` — one active lobby per player, capacity check, seat
  allocation, host re-assignment on leave.
- `leave_lobby(id, player)` — removes the seat or cancels an emptied lobby.
- `start_game(id, player, min)` — host-only, locks the row `FOR UPDATE`, refuses
  a short lobby or an already-started game, shuffles and assigns roles.
- `finish_game(id, winner, rounds)` — idempotent (`status = 'active'` guard), so
  statistics and rating can never be counted twice.
- `cancel_game(id)` — abandoned matches award nothing.
- `leaderboard(limit, offset)` / `leaderboard_rank(player)` — deterministic
  ordering: `rating DESC, games_won DESC, games_played ASC, id ASC`.

Every table has RLS **enabled and forced**, with all grants to `anon` and
`authenticated` revoked, so a leaked publishable key cannot read a lobby, a role
or a statistic from a browser.

### Rating

A damped Elo-style score starting at 1000, with a K-factor that shrinks as
experience grows (48 → 32 → 24). Newcomers can climb quickly; veterans need
consistency, so grinding a single game does not outrank a long record. A win is
`+K`, a loss `−K`, and the rating never drops below 100.

## Real-time updates

Lobby state is synchronised in two layers:

1. **Supabase Realtime** — the server broadcasts a small "lobby changed" ping on
   `lobby:<id>`; subscribed clients immediately refetch.
2. **Version polling** — clients poll `/api/lobbies?id=…&since=<version>` every
   2.5 s and the server answers `304 Not Modified` when nothing changed.

The database is the only source of truth, so a missed broadcast costs latency
but never correctness. This works on serverless hosts where an in-process
WebSocket server is not possible.

## Project layout

```
app/
  page.tsx                 home: profile hero, create/join, public rooms
  lobby/[code]/page.tsx    dedicated lobby room
  game/[code]/page.tsx     the match
  profile/page.tsx         statistics and match history
  leaderboard/page.tsx     global ranking
  providers.tsx            Telegram SDK + auth + language context
  api/                     auth, lobbies, profile, leaderboard, health
components/
  ui.tsx                   avatars, top bar, cards, toasts
  use-lobby.ts             polling + realtime sync hook
lib/
  db/client.ts             server-only Supabase client
  db/repository.ts         all data access + projections
  game/rules.ts            pure, unit-tested game engine
  game/constants.ts        client-safe ruleset constants
  game/events.ts           event key catalogue
  i18n.ts                  uz / ru / en copy
  telegram.ts              initData verification + display-name resolution
supabase/migrations/       idempotent SQL schema
tests/                     unit, e2e and browser layout suites
```

## Verification

```sh
npm run verify         # lint + typecheck + unit tests + production build
npm run test:e2e       # boots `next start` and exercises the HTTP API
npm run test:layout    # measures quick-card / join-form in uz, ru, en
npm run db:check       # live read/write verification against the project
```

`test:layout` drives the locally installed Chrome/Edge (override with
`CHROME_PATH`) and asserts that `.quick-card` and `.join-form` measure **the
same width in every language** at 320 / 360 / 390 / 430 / 768 / 1280 px, with no
page overflow and no clipped text.

## Deploying

### Render

`render.yaml` configures the Node service, health check and all required
environment variables. Set `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` when prompted; `SESSION_SECRET` is generated.

### Vercel

Import the repository. Use Node 22, then add `TELEGRAM_BOT_TOKEN`,
`SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all
server-only) plus `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` and
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Apply the schema once with `npm run db:migrate`, then set the bot's Mini App URL
to the deployed HTTPS address.

## Ruleset

5–20 players. Roles are mafia, doctor, detective and citizen. Mafia count is 1
below 7 players, 2 at 7–9 and 3 from 10. One doctor and one detective always.

Night: mafia picks one target, the doctor protects one player (possibly
themselves), the detective investigates one. A split mafia vote kills nobody;
a protected target survives. Day: everyone votes; a strict plurality is
eliminated, a tie eliminates nobody. Mafia win when they equal the rest of the
table; the town wins when the last mafia dies.

Abandoned or cancelled matches award no win and no rating change — only matches
resolved through `finish_game` are counted, and only once.
