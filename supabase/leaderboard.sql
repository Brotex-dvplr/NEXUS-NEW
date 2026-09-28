-- NEXUS online leaderboard schema. Run in Supabase SQL Editor.
create table if not exists public.nexus_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'Nexus Explorer' check (char_length(display_name) between 2 and 24),
 total_xp bigint not null default 0 check (total_xp >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.nexus_activity_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 activity_key text not null,
 points integer not null check (points between 1 and 100),
 event_date date not null default (timezone('utc', now()))::date,
 created_at timestamptz not null default now(),
 unique(user_id, activity_key, event_date)
);
create index if not exists nexus_profiles_rank_idx on public.nexus_profiles(total_xp desc, updated_at asc);
alter table public.nexus_profiles enable row level security;
alter table public.nexus_activity_events enable row level security;
revoke all on public.nexus_profiles from anon, authenticated;
grant select on public.nexus_profiles to anon, authenticated;
grant update(display_name) on public.nexus_profiles to authenticated;
create policy "Public leaderboard profiles" on public.nexus_profiles for select to anon, authenticated using (true);
create policy "Users update own display name" on public.nexus_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.nexus_activity_events from anon, authenticated;
create or replace function public.nexus_handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare n text;
begin
 n := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Nexus Explorer'), 24);
 if char_length(n) < 2 then n := 'Nexus Explorer'; end if;
 insert into public.nexus_profiles(user_id, display_name) values(new.id, n) on conflict(user_id) do nothing;
 return new;
end;
$$;
revoke all on function public.nexus_handle_new_user() from public, anon, authenticated;
drop trigger if exists nexus_auth_user_created on auth.users;
create trigger nexus_auth_user_created after insert on auth.users for each row execute procedure public.nexus_handle_new_user();

create or replace function public.nexus_award_activity(p_activity_key text)
returns table(awarded integer, total_xp bigint, already_awarded boolean)
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); pts integer; today_utc date := (timezone('utc', now()))::date; new_total bigint;
begin
 if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
 pts := case p_activity_key
  when 'daily_mission' then 20 when 'tool_calculator' then 3 when 'tool_json' then 3
  when 'tool_password' then 3 when 'tool_unit' then 2 when 'game_snake' then 5
  when 'game_memory_win' then 20 when 'game_ttt_win' then 10 when 'game_reaction' then 5
  else null end;
 if pts is null then raise exception 'Unknown activity' using errcode = '22023'; end if;
 insert into public.nexus_profiles(user_id,display_name) values(uid,'Nexus Explorer') on conflict(user_id) do nothing;
 insert into public.nexus_activity_events(user_id,activity_key,points,event_date) values(uid,p_activity_key,pts,today_utc)
 on conflict(user_id,activity_key,event_date) do nothing;
 if not found then
  return query select 0,p.total_xp,true from public.nexus_profiles p where p.user_id=uid;
  return;
 end if;
 update public.nexus_profiles p set total_xp=p.total_xp+pts, updated_at=now()
 where p.user_id=uid returning p.total_xp into new_total;
 return query select pts,new_total,false;
end;
$$;
revoke all on function public.nexus_award_activity(text) from public, anon;
grant execute on function public.nexus_award_activity(text) to authenticated;

create or replace view public.nexus_leaderboard with (security_invoker = true) as
select row_number() over(order by total_xp desc, updated_at asc, user_id asc) as rank,
 user_id, display_name, total_xp, updated_at
from public.nexus_profiles;
grant select on public.nexus_leaderboard to anon, authenticated;
