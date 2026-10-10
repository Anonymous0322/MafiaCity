-- =============================================================================
-- display_name = nickname, enforced in the database.
--
-- The application computes this correctly, but any write that puts the
-- @username back into display_name (an older deployed bundle, a manual edit,
-- a bad import) silently reverts the player's name. Observed in production:
-- the account showed "@uletaaay" again right after a stale deployment logged
-- in. The invariant belongs in the database, not only in the request path.
--
-- The trigger only overrides the value when a usable nickname exists; a player
-- with no first/last name keeps whatever label they were given.
-- =============================================================================

create or replace function public.mc_display_name_from_nickname()
returns trigger
language plpgsql
as $$
begin
  if nullif(trim(both ' ' from coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '') is not null then
    new.display_name := trim(both ' ' from new.first_name || ' ' || coalesce(new.last_name, ''));
  end if;
  return new;
end;
$$;

drop trigger if exists mc_players_display_name on public.mc_players;

create trigger mc_players_display_name
  before insert or update of first_name, last_name, display_name on public.mc_players
  for each row
  execute function public.mc_display_name_from_nickname();

-- bring existing rows in line with the rule
update public.mc_players
   set display_name = trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
 where nullif(trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') is not null
   and display_name is distinct from trim(both ' ' from first_name || ' ' || coalesce(last_name, ''));