-- =============================================================================
-- Display name = nickname, not @username.
--
-- The application originally stored the Telegram @username in `display_name`.
-- The nickname (first + last name) is what players expect to see, with the
-- @username kept as a separate handle. This recomputes existing rows from the
-- first/last name we already store, and only touches `display_name`.
-- =============================================================================

update public.mc_players
   set display_name = nullif(
         trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, '')),
         ''
       )
 where nullif(trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') is not null;

-- anyone without a usable name falls back to their handle
update public.mc_players
   set display_name = username
 where display_name is null
   and username is not null;

update public.mc_players
   set display_name = 'Telegram player'
 where display_name is null or display_name = '';
