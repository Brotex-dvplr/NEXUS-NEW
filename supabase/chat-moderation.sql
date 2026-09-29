-- NEXUS chat reports and moderator controls
-- Run after supabase/gamer-chat.sql in Supabase SQL Editor.
-- Admins must be added manually by UUID; never use a client-side display name as admin proof.

create table if not exists public.nexus_chat_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.nexus_chat_admins enable row level security;
revoke all on public.nexus_chat_admins from public, anon, authenticated;

create table if not exists public.nexus_chat_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reporter_name text not null,
  message_sender_name text not null,
  message_text text not null,
  reason text check (reason is null or char_length(reason) <= 300),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  admin_note text,
  unique(message_id, reporter_id)
);
create index if not exists nexus_chat_reports_status_created_idx
  on public.nexus_chat_reports(status, created_at desc);
alter table public.nexus_chat_reports enable row level security;
revoke all on public.nexus_chat_reports from public, anon, authenticated;

create or replace function public.nexus_chat_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.nexus_chat_admins a
    where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.nexus_chat_is_admin() from public, anon;
grant execute on function public.nexus_chat_is_admin() to authenticated;

create or replace function public.nexus_report_chat_message(p_message_id bigint, p_reason text default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  reporter_display_name text;
  sender_id uuid;
  sender_display_name text;
  message_body text;
  reason_clean text := nullif(pg_catalog.btrim(p_reason), '');
  new_report_id bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if reason_clean is not null and pg_catalog.char_length(reason_clean) > 300 then
    raise exception 'Report reason is too long (maximum 300 characters)' using errcode = '22023';
  end if;
  select m.user_id, m.sender_name, m.message
    into sender_id, sender_display_name, message_body
    from public.nexus_chat_messages m where m.id = p_message_id;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if sender_id = uid then raise exception 'You cannot report your own message' using errcode = '22023'; end if;
  select p.display_name into reporter_display_name
    from public.nexus_profiles p where p.user_id = uid;
  if reporter_display_name is null then raise exception 'NEXUS profile not found' using errcode = 'P0002'; end if;

  insert into public.nexus_chat_reports(
    message_id, reporter_id, reporter_name, message_sender_name, message_text, reason
  ) values (
    p_message_id, uid, reporter_display_name, sender_display_name, message_body, reason_clean
  ) on conflict (message_id, reporter_id) do nothing
  returning id into new_report_id;

  if new_report_id is null then
    raise exception 'You have already reported this message' using errcode = '23505';
  end if;
  return new_report_id;
end;
$$;
revoke all on function public.nexus_report_chat_message(bigint, text) from public, anon;
grant execute on function public.nexus_report_chat_message(bigint, text) to authenticated;

create or replace function public.nexus_admin_list_chat_reports()
returns table(
  report_id bigint,
  message_id bigint,
  reporter_name text,
  message_sender_name text,
  message_text text,
  reason text,
  status text,
  created_at timestamptz,
  admin_note text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.nexus_chat_admins a where a.user_id = (select auth.uid())) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return query
    select r.id, r.message_id, r.reporter_name, r.message_sender_name,
      r.message_text, r.reason, r.status, r.created_at, r.admin_note
    from public.nexus_chat_reports r
    order by (r.status = 'open') desc, r.created_at desc
    limit 200;
end;
$$;
revoke all on function public.nexus_admin_list_chat_reports() from public, anon;
grant execute on function public.nexus_admin_list_chat_reports() to authenticated;

create or replace function public.nexus_admin_review_chat_report(
  p_report_id bigint, p_status text, p_note text default null
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.nexus_chat_admins a where a.user_id = uid) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('resolved','dismissed') then
    raise exception 'Invalid report status' using errcode = '22023';
  end if;
  if p_note is not null and pg_catalog.char_length(p_note) > 500 then
    raise exception 'Admin note is too long (maximum 500 characters)' using errcode = '22023';
  end if;
  update public.nexus_chat_reports r
    set status = p_status, reviewed_by = uid, reviewed_at = pg_catalog.now(),
        admin_note = nullif(pg_catalog.btrim(p_note), '')
    where r.id = p_report_id;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;
revoke all on function public.nexus_admin_review_chat_report(bigint, text, text) from public, anon;
grant execute on function public.nexus_admin_review_chat_report(bigint, text, text) to authenticated;

create or replace function public.nexus_admin_delete_chat_message(p_message_id bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); affected integer;
begin
  if not exists (select 1 from public.nexus_chat_admins a where a.user_id = uid) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  delete from public.nexus_chat_messages where id = p_message_id;
  get diagnostics affected = row_count;
  update public.nexus_chat_reports
    set status = 'resolved', reviewed_by = uid, reviewed_at = pg_catalog.now(),
        admin_note = 'پیام توسط مدیر حذف شد'
    where message_id = p_message_id and status = 'open';
  return affected > 0;
end;
$$;
revoke all on function public.nexus_admin_delete_chat_message(bigint) from public, anon;
grant execute on function public.nexus_admin_delete_chat_message(bigint) to authenticated;

-- Admin setup:
-- 1) Run: SELECT id, email, raw_user_meta_data ->> 'display_name' AS display_name FROM auth.users;
-- 2) Copy the UUID for YOUR account and run the statement below after replacing the placeholder:
-- INSERT INTO public.nexus_chat_admins(user_id) VALUES ('PASTE-YOUR-USER-UUID-HERE') ON CONFLICT DO NOTHING;
-- Do not use an email/name alone, and never expose a service_role key in the website.
