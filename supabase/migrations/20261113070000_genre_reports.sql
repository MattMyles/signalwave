-- Neo Earth Radio: "WRONG GENRE?" reports from listeners.
-- One row per genre the listener had picked when they reported a station.
-- Reports wait for review in the admin dashboard (status 'pending'). Once the
-- admin agrees ('approved'), the server stops serving that station for that
-- genre (it can still come up in other genres it might suit); 'rejected'
-- reports are ignored. The admin's own reports are approved straight away.
-- Server-only, like the play log: RLS on, no policies. Safe to run more than once.

create table if not exists public.genre_reports (
  id            bigint generated always as identity primary key,
  station_uuid  text not null check (length(station_uuid) <= 64),
  station_name  text check (length(station_name) <= 200),
  genre_key     text not null check (length(genre_key) <= 80),
  station_genre text check (length(station_genre) <= 80),
  song          text check (length(song) <= 300),
  city          text check (length(city) <= 120),
  country_code  text check (length(country_code) <= 4),
  visitor_id    text check (length(visitor_id) <= 64),
  user_id       uuid,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.genre_reports add column if not exists status text not null default 'pending';
alter table public.genre_reports add column if not exists reviewed_at timestamptz;
create index if not exists genre_reports_genre_idx on public.genre_reports (genre_key, station_uuid);
create index if not exists genre_reports_created_idx on public.genre_reports (created_at desc);
create index if not exists genre_reports_status_idx on public.genre_reports (status);

alter table public.genre_reports enable row level security;
revoke all on public.genre_reports from anon, authenticated;
grant select, insert, update on public.genre_reports to service_role;
