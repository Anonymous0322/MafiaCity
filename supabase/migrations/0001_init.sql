-- =============================================================================
-- Mafia City — schema bootstrap
--
-- All tables live in `public` (the only schema PostgREST exposes on Supabase)
-- and are prefixed with `mc_` because the project already contains tables from
-- an older, unrelated app (friends, friendships, lobbies, lobby_players, messages, room_messages, room_players, users). Those tables are never read,
-- written or altered by this project.
-- Run once against the Supabase project (SQL editor or psql).
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- players: one row per authenticated Telegram user
-- -----------------------------------------------------------------------------
create table if not exists public.mc_players (
  id             uuid primary key default gen_random_uuid(),
  telegram_id    bigint unique not null,
  username       text,
  first_name     text not null default '',
  last_name      text,
  display_name   text not null,
  photo_url      text,
  language       text not null default 'uz' check (language in ('uz', 'ru', 'en')),

  games_played   integer not null default 0,
  games_won      integer not null default 0,
  games_lost     integer not null default 0,
  mafia_games    integer not null default 0,
  mafia_wins     integer not null default 0,
  town_games     integer not null default 0,
  town_wins      integer not null default 0,
  rating         numeric(10, 2) not null default 1000,
  peak_rating    numeric(10, 2) not null default 1000,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create index if not exists mc_players_rating_idx  on public.mc_players (rating desc, games_won desc, id);
create index if not exists mc_players_played_idx on public.mc_players (games_played desc);

-- -----------------------------------------------------------------------------
-- lobbies: a room. Holds the authoritative live game document in `state`.
--   status  = lifecycle  (waiting -> starting -> playing -> completed/cancelled)
--   phase   = round phase (waiting / night / day / finished)
--   version = monotonic counter; clients poll `?since=<version>` for changes.
-- -----------------------------------------------------------------------------
create table if not exists public.mc_lobbies (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  mode         text not null default 'PUBLIC' check (mode in ('PUBLIC', 'PRIVATE')),
  status       text not null default 'waiting'
                 check (status in ('waiting', 'starting', 'playing', 'completed', 'cancelled')),
  phase        text not null default 'waiting'
                 check (phase in ('waiting', 'night', 'day', 'finished')),
  round_number  integer not null default 0,
  host_id      uuid not null references public.mc_players (id) on delete cascade,
  max_players  integer not null default 8 check (max_players between 3 and 20),
  winner       text check (winner in ('mafia', 'town')),
  version      bigint not null default 1,
  state        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

create index if not exists mc_lobbies_open_idx  on public.mc_lobbies (status, mode, created_at desc);
create index if not exists mc_lobbies_host_idx  on public.mc_lobbies (host_id);

-- -----------------------------------------------------------------------------
-- lobby_members: seat assignment. Presence rows survive an in-game game so a
-- refreshing player keeps their seat, role and alive flag.
-- -----------------------------------------------------------------------------
create table if not exists public.mc_lobby_members (
  id         uuid primary key default gen_random_uuid(),
  lobby_id   uuid not null references public.mc_lobbies (id) on delete cascade,
  player_id  uuid not null references public.mc_players (id) on delete cascade,
  seat       integer not null,
  is_host    boolean not null default false,
  is_alive   boolean not null default true,
  role       text check (role in ('mafia', 'doctor', 'detective', 'citizen')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  unique (lobby_id, player_id)
);

create index if not exists mc_lobby_members_lobby_idx  on public.mc_lobby_members (lobby_id);
create index if not exists mc_lobby_members_player_idx on public.mc_lobby_members (player_id) where left_at is null;

-- -----------------------------------------------------------------------------
-- games: one row per started match. The single source of truth for statistics.
-- -----------------------------------------------------------------------------
create table if not exists public.mc_games (
  id            uuid primary key default gen_random_uuid(),
  lobby_id      uuid not null unique references public.mc_lobbies (id) on delete cascade,
  status        text not null default 'active'
                  check (status in ('active', 'completed', 'cancelled')),
  winner        text check (winner in ('mafia', 'town')),
  rounds_played integer not null default 0,
  player_count  integer not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists mc_games_player_history_idx on public.mc_games (status, finished_at desc);

-- -----------------------------------------------------------------------------
-- game_players: role + outcome per player per game.
--   `unique (game_id, player_id)` makes statistics application idempotent.
-- -----------------------------------------------------------------------------
create table if not exists public.mc_game_players (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.mc_games (id) on delete cascade,
  player_id     uuid not null references public.mc_players (id) on delete cascade,
  role          text not null check (role in ('mafia', 'doctor', 'detective', 'citizen')),
  is_alive      boolean not null default true,
  survived      boolean not null default false,
  won           boolean not null default false,
  rating_delta  numeric(8, 2) not null default 0,
  rating_after  numeric(10, 2),
  created_at    timestamptz not null default now(),
  unique (game_id, player_id)
);

create index if not exists mc_game_players_player_idx on public.mc_game_players (player_id, created_at desc);
create index if not exists mc_game_players_game_idx   on public.mc_game_players (game_id);

-- -----------------------------------------------------------------------------
-- game_events: structured event log. `message_key` + `params` are translated on
-- the client so the same match reads correctly in uz / ru / en.
-- -----------------------------------------------------------------------------
create table if not exists public.mc_game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.mc_games (id) on delete cascade,
  lobby_id    uuid references public.mc_lobbies (id) on delete cascade,
  round_number integer not null default 0,
  phase       text not null default 'waiting',
  kind        text not null,
  message_key text not null,
  params      jsonb not null default '{}'::jsonb,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists mc_game_events_game_idx on public.mc_game_events (game_id, id desc);

-- -----------------------------------------------------------------------------
-- investigations: detective results, revealed only to the owning player.
-- -----------------------------------------------------------------------------
create table if not exists public.mc_investigations (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.mc_games (id) on delete cascade,
  detective_id uuid not null references public.mc_players (id) on delete cascade,
  target_id   uuid not null references public.mc_players (id) on delete cascade,
  is_mafia    boolean not null,
  round_number integer not null default 1,
  created_at  timestamptz not null default now(),
  unique (game_id, detective_id, round_number)
);

-- =============================================================================
-- Atomic operations. All state transitions go through these functions so that
-- concurrent taps cannot double-start a game or double-count a result.
-- =============================================================================

-- keep updated_at honest
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mc_players_touch on public.mc_players;
create trigger mc_players_touch before update on public.mc_players
  for each row execute function public.touch_updated_at();

drop trigger if exists mc_lobbies_touch on public.mc_lobbies;
create trigger mc_lobbies_touch before update on public.mc_lobbies
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- join_lobby: idempotent seat claim. Returns the lobby row, or raises.
--   Security: the caller supplies its own player id only; `p_player_id` must
--   equal the authenticated user (enforced by the API layer) and the function
--   re-validates every precondition inside a single transaction.
-- -----------------------------------------------------------------------------
create or replace function public.join_lobby(p_lobby_id uuid, p_player_id uuid)
returns public.mc_lobbies
language plpgsql security definer set search_path = public as $$
declare
  v_lobby public.mc_lobbies;
  v_seat integer;
  v_existing public.mc_lobby_members;
  v_other integer;
begin
  select * into v_lobby from public.mc_lobbies where id = p_lobby_id for update;
  if not found then
    raise exception 'lobby_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.mc_lobby_members
   where lobby_id = p_lobby_id and player_id = p_player_id and left_at is null;

  if found then
    return v_lobby;                       -- already seated: idempotent
  end if;

  if v_lobby.status not in ('waiting', 'starting') or v_lobby.phase <> 'waiting' then
    raise exception 'lobby_in_progress' using errcode = 'P0001';
  end if;

  select count(*) into v_other from public.mc_lobby_members
   where lobby_id = p_lobby_id and left_at is null;
  if v_other >= v_lobby.max_players then
    raise exception 'lobby_full' using errcode = 'P0001';
  end if;

  -- one active lobby per player
  if exists (
    select 1 from public.mc_lobby_members m
      join public.mc_lobbies l on l.id = m.lobby_id
     where m.player_id = p_player_id
       and m.left_at is null
       and l.status in ('waiting', 'starting', 'playing')
  ) then
    raise exception 'player_in_other_lobby' using errcode = 'P0001';
  end if;

  select coalesce(max(seat), 0) + 1 into v_seat from public.mc_lobby_members
   where lobby_id = p_lobby_id;

  insert into public.mc_lobby_members (lobby_id, player_id, seat)
  values (p_lobby_id, p_player_id, v_seat);

  update public.mc_lobbies
     set version = version + 1
   where id = p_lobby_id
  returning * into v_lobby;

  return v_lobby;
end;
$$;

-- -----------------------------------------------------------------------------
-- leave_lobby: removes a seat, or cancels the lobby when it becomes empty.
-- -----------------------------------------------------------------------------
create or replace function public.leave_lobby(p_lobby_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_lobby public.mc_lobbies;
  v_remaining integer;
  v_new_host uuid;
begin
  select * into v_lobby from public.mc_lobbies where id = p_lobby_id for update;
  if not found then return false; end if;

  update public.mc_lobby_members
     set left_at = now(), is_alive = false
   where lobby_id = p_lobby_id and player_id = p_player_id and left_at is null;

  if v_lobby.status in ('completed', 'cancelled') then
    update public.mc_lobbies set version = version + 1 where id = p_lobby_id;
    return true;
  end if;

  select count(*) into v_remaining from public.mc_lobby_members
   where lobby_id = p_lobby_id and left_at is null;

  if v_remaining = 0 then
    update public.mc_lobbies
       set status = 'cancelled', phase = 'finished', version = version + 1, finished_at = now()
     where id = p_lobby_id;
  else
    if v_lobby.host_id = p_player_id then
      select player_id into v_new_host from public.mc_lobby_members
       where lobby_id = p_lobby_id and left_at is null
       order by joined_at asc limit 1;
      update public.mc_lobbies set host_id = v_new_host where id = p_lobby_id;
      update public.mc_lobby_members set is_host = false where lobby_id = p_lobby_id;
      update public.mc_lobby_members set is_host = true
       where lobby_id = p_lobby_id and player_id = v_new_host;
    end if;
    update public.mc_lobbies set version = version + 1 where id = p_lobby_id;
  end if;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- start_game: host-only, single-shot, atomic.
--   * rejects non-hosts, short lobbies and already-running lobbies
--   * locks the lobby FOR UPDATE so two parallel taps cannot both win
--   * assigns roles server-side and writes game + game_players rows
-- Returns jsonb: { game_id, lobby }
-- =============================================================================
create or replace function public.start_game(
  p_lobby_id uuid,
  p_player_id uuid,
  p_min_players integer default 4
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lobby public.mc_lobbies;
  v_game_id uuid;
  v_members public.mc_lobby_members[];
  v_role text;
  v_roles text[];
  v_mafia integer;
  v_doctor integer;
  v_detective integer;
  v_citizen integer;
  v_i integer;
  v_j integer;
  v_tmp text;
  v_state jsonb;
begin
  select * into v_lobby from public.mc_lobbies where id = p_lobby_id for update;
  if not found then raise exception 'lobby_not_found' using errcode = 'P0002'; end if;

  if v_lobby.host_id <> p_player_id then
    raise exception 'not_host' using errcode = 'P0001';
  end if;

  if v_lobby.status <> 'waiting' or v_lobby.phase <> 'waiting' then
    raise exception 'lobby_in_progress' using errcode = 'P0001';
  end if;

  select array_agg(m order by m.seat) into v_members
    from public.mc_lobby_members m
   where m.lobby_id = p_lobby_id and m.left_at is null;

  if coalesce(array_length(v_members, 1), 0) < p_min_players then
    raise exception 'not_enough_players' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.mc_games where lobby_id = p_lobby_id) then
    raise exception 'game_already_started' using errcode = 'P0001';
  end if;

  -- ---- role distribution (mirrors lib/game/rules.ts) ------------------------
  v_mafia := case
    when coalesce(array_length(v_members, 1), 0) >= 10 then 3
    when coalesce(array_length(v_members, 1), 0) >= 7  then 2
    else 1
  end;
  v_doctor    := 1;
  v_detective := 1;
  v_citizen   := coalesce(array_length(v_members, 1), 0) - v_mafia - v_doctor - v_detective;
  if v_citizen < 1 then
    v_citizen := 1;
    v_mafia := coalesce(array_length(v_members, 1), 0) - v_doctor - v_detective - 1;
  end if;

  v_roles := array[]::text[];
  for i in 1..v_mafia loop v_roles := array_append(v_roles, 'mafia'); end loop;
  for i in 1..v_doctor loop v_roles := array_append(v_roles, 'doctor'); end loop;
  for i in 1..v_detective loop v_roles := array_append(v_roles, 'detective'); end loop;
  for i in 1..v_citizen loop v_roles := array_append(v_roles, 'citizen'); end loop;

  -- Fisher-Yates using random() so shuffling happens inside the transaction
  for i in 1..coalesce(array_length(v_roles, 1) - 1, 0) loop
    v_j := floor(random() * (coalesce(array_length(v_roles, 1), 1) - i))::integer + i;
    v_tmp := v_roles[i];
    v_roles[i] := v_roles[v_j];
    v_roles[v_j] := v_tmp;
  end loop;

  -- ---- persist seats + roles ----------------------------------------------
  for i in 1..coalesce(array_length(v_members, 1), 0) loop
    v_role := v_roles[i];
    update public.mc_lobby_members
       set role = v_role, is_alive = true, left_at = null
     where lobby_id = p_lobby_id and player_id = v_members[i].player_id;
  end loop;

  insert into public.mc_games (lobby_id, status, rounds_played, player_count)
  values (p_lobby_id, 'active', 0, array_length(v_members, 1))
  returning id into v_game_id;

  for i in 1..coalesce(array_length(v_members, 1), 0) loop
    insert into public.mc_game_players (game_id, player_id, role)
    values (v_game_id, v_members[i].player_id, v_roles[i])
    on conflict (game_id, player_id) do nothing;
  end loop;

  insert into public.mc_game_events (game_id, lobby_id, round_number, phase, kind, message_key, params)
  values (v_game_id, p_lobby_id, 1, 'night', 'system', 'event.gameStarted',
          jsonb_build_object('players', array_length(v_members, 1)));

  v_state := jsonb_build_object(
    'nightActions', jsonb_build_object('mafiaVotes', '{}'::jsonb),
    'votes', '{}'::jsonb,
    'phaseStartedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.mc_lobbies
     set status = 'playing', phase = 'night', round_number = 1,
         started_at = now(), state = v_state, version = version + 1
   where id = p_lobby_id
  returning * into v_lobby;

  return jsonb_build_object('game_id', v_game_id, 'lobby', to_jsonb(v_lobby));
end;
$$;

-- -----------------------------------------------------------------------------
-- finish_game: idempotent completion. Re-running is a no-op thanks to the
--   `status = 'active'` guard, so statistics can never be double-counted.
-- Rating: Elo-flavoured, scaled by games played so grinding one game cannot
-- outrank a long, consistent record.
-- Returns jsonb: { already_finished, rating_changes: [...] }
-- =============================================================================
create or replace function public.finish_game(
  p_game_id uuid,
  p_winner text,
  p_rounds integer default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_game public.mc_games;
  v_row record;
  v_expected numeric(10, 2);
  v_actual   numeric(10, 2);
  v_delta   numeric(8, 2);
  v_k        numeric(6, 4);
  v_new_rating numeric(10, 2);
  v_was_mafia boolean;
  v_changes jsonb := '[]'::jsonb;
begin
  select * into v_game from public.mc_games where id = p_game_id for update;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;

  if v_game.status <> 'active' then
    return jsonb_build_object('already_finished', true, 'rating_changes', '[]'::jsonb);
  end if;

  update public.mc_games
     set status = 'completed', winner = p_winner,
         rounds_played = p_rounds, finished_at = now()
   where id = p_game_id;

  update public.mc_lobbies
     set status = 'completed', phase = 'finished', winner = p_winner,
         finished_at = now(), version = version + 1, state = '{}'::jsonb
   where id = v_game.lobby_id;

  for v_row in
    select gp.id, gp.player_id, gp.role, gp.is_alive, p.rating, p.games_played
      from public.mc_game_players gp
      join public.mc_players p on p.id = gp.player_id
     where gp.game_id = p_game_id
  loop
    v_was_mafia := v_row.role = 'mafia';

    -- head-to-head model: every game is a fair 50/50 coin flip, and the
    -- result is scored from the player's own side.
    v_expected := 0.5;
    if v_was_mafia then
      v_actual := case when p_winner = 'mafia' then 1 else 0 end;
    else
      v_actual := case when p_winner = 'town' then 1 else 0 end;
    end if;

    -- damped K-factor: strong for newcomers, conservative for veterans
    v_k := case when v_row.games_played < 10 then 48
                when v_row.games_played < 30 then 32
                else 24 end;

    v_delta := round((v_actual - v_expected) * v_k, 2);
    v_new_rating := greatest(100, v_row.rating + v_delta);

    update public.mc_game_players
       set won = (v_actual = 1), survived = v_row.is_alive,
           rating_delta = v_delta, rating_after = v_new_rating
     where id = v_row.id;

    update public.mc_players
       set games_played = games_played + 1,
           games_won    = games_won + case when v_actual = 1 then 1 else 0 end,
           games_lost   = games_lost + case when v_actual = 1 then 0 else 1 end,
           mafia_games  = mafia_games + case when v_was_mafia then 1 else 0 end,
           mafia_wins   = mafia_wins  + case when v_was_mafia and v_actual = 1 then 1 else 0 end,
           town_games   = town_games  + case when not v_was_mafia then 1 else 0 end,
           town_wins    = town_wins   + case when not v_was_mafia and v_actual = 1 then 1 else 0 end,
           rating       = v_new_rating,
           peak_rating  = greatest(peak_rating, v_new_rating)
     where id = v_row.player_id;

    v_changes := v_changes || jsonb_build_object(
      'player_id', v_row.player_id, 'delta', v_delta, 'rating', v_new_rating);
  end loop;

  return jsonb_build_object('already_finished', false, 'rating_changes', v_changes);
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_game: aborted / abandoned matches award nothing.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_game(p_game_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_game public.mc_games;
begin
  select * into v_game from public.mc_games where id = p_game_id for update;
  if not found then return false; end if;
  if v_game.status <> 'active' then return false; end if;

  update public.mc_games set status = 'cancelled', finished_at = now() where id = p_game_id;
  update public.mc_lobbies
     set status = 'cancelled', phase = 'finished', version = version + 1,
         finished_at = now(), state = '{}'::jsonb
   where id = v_game.lobby_id;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- leaderboard: deterministic ordering.
--   ORDER BY rating DESC, games_won DESC, games_played ASC, id ASC
--   The trailing keys make ties fully deterministic across calls.
-- -----------------------------------------------------------------------------
create or replace function public.leaderboard(p_limit integer default 50, p_offset integer default 0)
returns table (
  rank bigint,
  id uuid,
  username text,
  display_name text,
  photo_url text,
  rating numeric,
  games_played integer,
  games_won integer,
  mafia_wins integer,
  town_wins integer
)
language sql stable security definer set search_path = public as $$
  select
    row_number() over (
      order by p.rating desc, p.games_won desc, p.games_played asc, p.id asc
    ) as "rank",
    p.id, p.username, p.display_name, p.photo_url, p.rating,
    p.games_played, p.games_won, p.mafia_wins, p.town_wins
  from public.mc_players p
  where p.games_played > 0
  order by p.rating desc, p.games_won desc, p.games_played asc, p.id asc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
$$;

-- -----------------------------------------------------------------------------
-- leaderboard_rank: exact standing of one player (works outside the top page).
-- -----------------------------------------------------------------------------
create or replace function public.leaderboard_rank(p_player_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) + 1 from public.mc_players p
  where p.games_played > 0
    and (p.rating, p.games_won, -p.games_played, p.id) > (
      select q.rating, q.games_won, -q.games_played, q.id
        from public.mc_players q where q.id = p_player_id
    );
$$;

grant usage on schema public to authenticated, anon, service_role;

-- =============================================================================
-- Row Level Security
-- -----------------------------------------------------------------------------
-- Every table is locked down and every browser-facing role (`anon`,
-- `authenticated`) is revoked. The publishable key can therefore never read a
-- lobby, a role, or a statistic directly from a browser, even if it leaks.
--
-- All access goes through the Next.js server, which must use a server-only
-- secret key (SUPABASE_SERVICE_ROLE_KEY) — that key bypasses RLS.
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'mc_players', 'mc_lobbies', 'mc_lobby_members', 'mc_games',
    'mc_game_players', 'mc_game_events', 'mc_investigations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- Only our own functions are touched; Supabase's built-ins keep their grants.
revoke execute on function
  public.touch_updated_at(),
  public.join_lobby(uuid, uuid),
  public.leave_lobby(uuid, uuid),
  public.start_game(uuid, uuid, integer),
  public.finish_game(uuid, text, integer),
  public.cancel_game(uuid),
  public.leaderboard(integer, integer),
  public.leaderboard_rank(uuid)
from public;

grant execute on function
  public.touch_updated_at(),
  public.join_lobby(uuid, uuid),
  public.leave_lobby(uuid, uuid),
  public.start_game(uuid, uuid, integer),
  public.finish_game(uuid, text, integer),
  public.cancel_game(uuid),
  public.leaderboard(integer, integer),
  public.leaderboard_rank(uuid)
to service_role;

-- A deny-by-default policy so that even an accidental grant cannot expose rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'mc_players', 'mc_lobbies', 'mc_lobby_members', 'mc_games',
    'mc_game_players', 'mc_game_events', 'mc_investigations'
  ] loop
    execute format(
      'drop policy if exists mc_server_only on public.%I', t);
    execute format(
      'create policy mc_server_only on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;
