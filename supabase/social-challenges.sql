-- NEXUS social challenges + invite links
-- Run this file separately in Supabase SQL Editor AFTER leaderboard.sql.

create table if not exists public.nexus_challenges (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  creator_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'completed', 'cancelled')),
  duration_hours integer not null default 24 check (duration_hours in (1, 6, 12, 24)),
  creator_start_xp bigint not null default 0,
  opponent_start_xp bigint,
  creator_delta bigint,
  opponent_delta bigint,
  winner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  check (opponent_id is null or opponent_id <> creator_id)
);

create index if not exists nexus_challenges_creator_idx
  on public.nexus_challenges(creator_id, created_at desc);
create index if not exists nexus_challenges_opponent_idx
  on public.nexus_challenges(opponent_id, created_at desc);

alter table public.nexus_challenges enable row level security;
revoke all on public.nexus_challenges from anon, authenticated;
grant select on public.nexus_challenges to authenticated;
drop policy if exists "Participants read own NEXUS challenges" on public.nexus_challenges;
create policy "Participants read own NEXUS challenges"
  on public.nexus_challenges for select to authenticated
  using ((select auth.uid()) = creator_id or (select auth.uid()) = opponent_id);

create or replace function public.nexus_create_challenge(p_duration_hours integer default 24)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  xp_now bigint := 0;
  challenge_uuid uuid := pg_catalog.gen_random_uuid();
  code text := pg_catalog.substring(pg_catalog.replace(challenge_uuid::text, '-', ''), 1, 12);
  created_time timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_duration_hours not in (1, 6, 12, 24) then
    raise exception 'Duration must be 1, 6, 12, or 24 hours' using errcode = '22023';
  end if;
  select p.total_xp into xp_now from public.nexus_profiles p where p.user_id = uid;
  insert into public.nexus_challenges(id, invite_code, creator_id, duration_hours, creator_start_xp)
  values (challenge_uuid, code, uid, p_duration_hours, coalesce(xp_now, 0))
  returning created_at into created_time;
  return pg_catalog.jsonb_build_object(
    'id', challenge_uuid, 'invite_code', code, 'duration_hours', p_duration_hours,
    'status', 'waiting', 'created_at', created_time
  );
end;
$$;

create or replace function public.nexus_accept_challenge(p_invite_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  challenge_row public.nexus_challenges%rowtype;
  creator_xp bigint := 0;
  opponent_xp bigint := 0;
  accepted_time timestamptz := pg_catalog.now();
  expiry_time timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select c.* into challenge_row
  from public.nexus_challenges c
  where c.invite_code = pg_catalog.lower(pg_catalog.btrim(p_invite_code))
  for update;
  if not found then raise exception 'Invite link not found' using errcode = 'P0002'; end if;
  if challenge_row.creator_id = uid then raise exception 'You cannot accept your own challenge' using errcode = '22023'; end if;
  if challenge_row.status <> 'waiting' then raise exception 'This challenge is no longer waiting for an opponent' using errcode = '22023'; end if;
  select p.total_xp into creator_xp from public.nexus_profiles p where p.user_id = challenge_row.creator_id;
  select p.total_xp into opponent_xp from public.nexus_profiles p where p.user_id = uid;
  expiry_time := accepted_time + pg_catalog.make_interval(hours => challenge_row.duration_hours);
  update public.nexus_challenges c
  set opponent_id = uid, creator_start_xp = coalesce(creator_xp, 0),
      opponent_start_xp = coalesce(opponent_xp, 0), accepted_at = accepted_time,
      expires_at = expiry_time, status = 'active'
  where c.id = challenge_row.id;
  return pg_catalog.jsonb_build_object(
    'id', challenge_row.id, 'status', 'active', 'expires_at', expiry_time,
    'duration_hours', challenge_row.duration_hours
  );
end;
$$;

create or replace function public.nexus_finish_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  c public.nexus_challenges%rowtype;
  creator_xp bigint := 0;
  opponent_xp bigint := 0;
  creator_gain bigint := 0;
  opponent_gain bigint := 0;
  winner uuid := null;
  finished_time timestamptz := pg_catalog.now();
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select ch.* into c from public.nexus_challenges ch where ch.id = p_challenge_id for update;
  if not found then raise exception 'Challenge not found' using errcode = 'P0002'; end if;
  if uid <> c.creator_id and uid <> c.opponent_id then
    raise exception 'You are not a participant in this challenge' using errcode = '42501';
  end if;
  if c.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'status', c.status, 'creator_delta', c.creator_delta,
      'opponent_delta', c.opponent_delta, 'winner_id', c.winner_id,
      'completed_at', c.completed_at
    );
  end if;
  if c.status <> 'active' then raise exception 'Challenge is not active' using errcode = '22023'; end if;
  if c.expires_at is null or finished_time < c.expires_at then
    raise exception 'Challenge is still active' using errcode = '22023';
  end if;
  select p.total_xp into creator_xp from public.nexus_profiles p where p.user_id = c.creator_id;
  select p.total_xp into opponent_xp from public.nexus_profiles p where p.user_id = c.opponent_id;
  creator_gain := greatest(coalesce(creator_xp, 0) - c.creator_start_xp, 0);
  opponent_gain := greatest(coalesce(opponent_xp, 0) - coalesce(c.opponent_start_xp, 0), 0);
  if creator_gain > opponent_gain then winner := c.creator_id;
  elsif opponent_gain > creator_gain then winner := c.opponent_id;
  end if;
  update public.nexus_challenges ch
  set status = 'completed', creator_delta = creator_gain, opponent_delta = opponent_gain,
      winner_id = winner, completed_at = finished_time
  where ch.id = c.id;
  return pg_catalog.jsonb_build_object(
    'status', 'completed', 'creator_delta', creator_gain,
    'opponent_delta', opponent_gain, 'winner_id', winner, 'completed_at', finished_time
  );
end;
$$;

revoke all on function public.nexus_create_challenge(integer) from public, anon;
revoke all on function public.nexus_accept_challenge(text) from public, anon;
revoke all on function public.nexus_finish_challenge(uuid) from public, anon;
grant execute on function public.nexus_create_challenge(integer) to authenticated;
grant execute on function public.nexus_accept_challenge(text) to authenticated;
grant execute on function public.nexus_finish_challenge(uuid) to authenticated;
