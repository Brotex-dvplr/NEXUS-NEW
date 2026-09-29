-- NEXUS public gamer group chat
-- Run once in Supabase SQL Editor after supabase/leaderboard.sql.
-- This creates a public-to-authenticated room; visitors must sign in to read or post.

create table if not exists public.nexus_chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null check (char_length(sender_name) between 2 and 24),
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists nexus_chat_messages_created_idx
  on public.nexus_chat_messages(id desc);

alter table public.nexus_chat_messages enable row level security;
revoke all on public.nexus_chat_messages from anon, authenticated;
grant select on public.nexus_chat_messages to authenticated;

drop policy if exists "Signed-in gamers can read group chat" on public.nexus_chat_messages;
create policy "Signed-in gamers can read group chat"
  on public.nexus_chat_messages for select to authenticated
  using (true);

create or replace function public.nexus_send_chat_message(p_message text)
returns table(id bigint, user_id uuid, sender_name text, message text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_message text := pg_catalog.btrim(p_message);
  display_name_value text;
  latest_time timestamptz;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if clean_message is null or clean_message = '' then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if pg_catalog.char_length(clean_message) > 1000 then
    raise exception 'Message is too long (maximum 1000 characters)' using errcode = '22023';
  end if;

  select p.display_name into display_name_value
  from public.nexus_profiles p where p.user_id = uid;
  if display_name_value is null then
    raise exception 'NEXUS profile not found; sign in again' using errcode = 'P0002';
  end if;

  -- Basic server-side rate limit: one message per account every 2 seconds.
  select m.created_at into latest_time
  from public.nexus_chat_messages m
  where m.user_id = uid
  order by m.id desc limit 1;
  if latest_time is not null and latest_time > pg_catalog.now() - interval '2 seconds' then
    raise exception 'Please wait a moment before sending another message' using errcode = '22023';
  end if;

  return query
    insert into public.nexus_chat_messages(user_id, sender_name, message)
    values(uid, display_name_value, clean_message)
    returning nexus_chat_messages.id, nexus_chat_messages.user_id,
      nexus_chat_messages.sender_name, nexus_chat_messages.message,
      nexus_chat_messages.created_at;
end;
$$;

revoke all on function public.nexus_send_chat_message(text) from public, anon;
grant execute on function public.nexus_send_chat_message(text) to authenticated;

-- Enable Supabase Realtime for this table, safely on repeated runs.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nexus_chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.nexus_chat_messages';
  end if;
end;
$$;
