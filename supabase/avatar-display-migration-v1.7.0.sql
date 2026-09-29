-- NEXUS v1.7.0 avatar display migration
-- Run once in Supabase SQL Editor for an existing NEXUS database.
alter table public.nexus_profiles add column if not exists avatar_url text;
grant select on public.nexus_profiles to anon, authenticated;
grant update(display_name, avatar_url) on public.nexus_profiles to authenticated;
create or replace view public.nexus_leaderboard with (security_invoker = true) as
select row_number() over(order by total_xp desc, updated_at asc, user_id asc) as rank,
       user_id, display_name, total_xp, avatar_url, updated_at
from public.nexus_profiles;
grant select on public.nexus_leaderboard to anon, authenticated;
