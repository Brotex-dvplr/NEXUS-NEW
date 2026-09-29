-- NEXUS: allow each signed-in user to delete only their own chat messages.
-- Run once in Supabase SQL Editor after supabase/gamer-chat.sql.

create or replace function public.nexus_delete_own_chat_message(p_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  affected integer;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  delete from public.nexus_chat_messages m
  where m.id = p_message_id
    and m.user_id = uid;

  get diagnostics affected = row_count;

  if affected = 0 then
    raise exception 'Message not found or you are not the author'
      using errcode = '42501';
  end if;

  return true;
end;
$$;

revoke all on function public.nexus_delete_own_chat_message(bigint) from public, anon;
grant execute on function public.nexus_delete_own_chat_message(bigint) to authenticated;
