-- Neo Earth Radio: NESE member IDs and station transmissions between members.
--
-- Every signed-in user becomes a NESE (Neo//Earth Signal Engineers Corps)
-- member with a number, shown as NESE-0000, NESE-0001, ... The admin gets 0;
-- everyone else gets the next number the first time they open the app signed in.
-- Members can send ("transmit") a station to another member by number; it waits
-- in the recipient's inbox until they add or dismiss it.
--
-- Both tables have row-level security on and NO policies, so the public app key
-- can't touch them. Only the server (secret service key) calls the functions
-- below, after checking who the user is. Emails are never shown to other members.

create sequence if not exists public.nese_number_seq start 1 minvalue 1;

create table if not exists public.nese_members (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nese_number integer not null unique check (nese_number >= 0),
  joined_at   timestamptz not null default now()
);

create table if not exists public.nese_signals (
  id            bigint generated always as identity primary key,
  from_user     uuid not null references auth.users (id) on delete cascade,
  to_user       uuid not null references auth.users (id) on delete cascade,
  station_uuid  text not null check (length(station_uuid) <= 64),
  station_name  text check (length(station_name) <= 200),
  station_place text check (length(station_place) <= 200),
  sent_at       timestamptz not null default now()
);
create index if not exists nese_signals_to_idx on public.nese_signals (to_user, sent_at desc);
create index if not exists nese_signals_from_idx on public.nese_signals (from_user, sent_at desc);

alter table public.nese_members enable row level security;
alter table public.nese_signals enable row level security;
revoke all on public.nese_members, public.nese_signals from anon, authenticated;
grant select, insert, update, delete on public.nese_members, public.nese_signals to service_role;
grant usage, select on sequence public.nese_number_seq to service_role;

-- Returns the member's number, assigning one on first call.
create or replace function public.nese_member(p_user uuid, p_admin boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  select nese_number into n from nese_members where user_id = p_user;
  if found then return n; end if;
  if p_admin and not exists (select 1 from nese_members where nese_number = 0) then
    n := 0;
  else
    n := nextval('nese_number_seq');
  end if;
  insert into nese_members (user_id, nese_number) values (p_user, n) on conflict (user_id) do nothing;
  select nese_number into n from nese_members where user_id = p_user;
  return n;
end;
$$;

-- Sends a station to another member. Returns 'ok' or a reason it didn't go.
create or replace function public.nese_send(p_from uuid, p_to integer, p_uuid text, p_name text, p_place text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target uuid;
begin
  if not exists (select 1 from nese_members where user_id = p_from) then return 'not_member'; end if;
  select user_id into target from nese_members where nese_number = p_to;
  if target is null then return 'no_such_member'; end if;
  if target = p_from then return 'self'; end if;
  if (select count(*) from nese_signals where from_user = p_from and sent_at > now() - interval '1 hour') >= 30 then
    return 'rate_limited';
  end if;
  if (select count(*) from nese_signals where to_user = target) >= 50 then return 'inbox_full'; end if;
  if exists (select 1 from nese_signals where from_user = p_from and to_user = target and station_uuid = p_uuid) then
    return 'ok'; -- already waiting in their inbox
  end if;
  insert into nese_signals (from_user, to_user, station_uuid, station_name, station_place)
  values (p_from, target, left(p_uuid, 64), left(p_name, 200), left(p_place, 200));
  return 'ok';
end;
$$;

-- The member's incoming transmissions, newest first, with the sender's number.
create or replace function public.nese_inbox(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'from', m.nese_number, 'uuid', s.station_uuid,
    'name', s.station_name, 'place', s.station_place, 'sentAt', s.sent_at
  ) order by s.sent_at desc), '[]'::jsonb)
  from nese_signals s left join nese_members m on m.user_id = s.from_user
  where s.to_user = p_user;
$$;

-- Removes one transmission from the member's own inbox (after adding or dismissing it).
create or replace function public.nese_dismiss(p_user uuid, p_id bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from nese_signals where id = p_id and to_user = p_user;
$$;

revoke all on function public.nese_member(uuid, boolean), public.nese_send(uuid, integer, text, text, text),
  public.nese_inbox(uuid), public.nese_dismiss(uuid, bigint) from public, anon, authenticated;
grant execute on function public.nese_member(uuid, boolean), public.nese_send(uuid, integer, text, text, text),
  public.nese_inbox(uuid), public.nese_dismiss(uuid, bigint) to service_role;
