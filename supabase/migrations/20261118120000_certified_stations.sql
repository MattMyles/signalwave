-- Neo Earth Radio: CERTIFIED stations (build 57).
-- The admin (ADMIN_EMAILS) can stamp the station that's playing as truly a genre or style:
-- one row per (station, genre key). Certified stations are served FIRST for that genre, to
-- listeners who haven't heard them yet, so new listeners start on the best signals. No song
-- check applies to a certified key (the admin's judgment wins over Apple's labels).
--   uuid          the station id (Radio Browser, or an Icecast-only id from the shelf)
--   genre_key     a main genre ('rock') or a style ('tag:classic rock'), as the app names them
--   station       snapshot of the public station object, so it can be served even when it is not
--                 on the station shelf or in Radio Browser
--   certified_by  the admin's email
-- Server-only, like genre_reports: RLS on, no policies, service role only (api/certify.js).
-- The app works without this table: nothing is certified until it exists. Safe to run more than once.

create table if not exists public.certified_stations (
  uuid          text not null check (length(uuid) <= 64),
  genre_key     text not null check (length(genre_key) <= 80),
  station       jsonb not null,
  certified_by  text check (length(certified_by) <= 200),
  certified_at  timestamptz not null default now(),
  primary key (uuid, genre_key)
);
create index if not exists certified_stations_genre_idx on public.certified_stations (genre_key);
create index if not exists certified_stations_at_idx on public.certified_stations (certified_at desc);

alter table public.certified_stations enable row level security;
revoke all on public.certified_stations from anon, authenticated;
grant select, insert, update, delete on public.certified_stations to service_role;
