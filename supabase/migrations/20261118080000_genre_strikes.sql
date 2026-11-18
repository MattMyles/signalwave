-- Neo Earth Radio: WRONG GENRE? strikes, and a record of what stations play.
--
-- 1. user_settings.genre_blocks: stations a listener has blocked for a genre
--    (ten WRONG GENRE? strikes on one station for one genre), as
--    { "<genre key>": ["<station uuid>", ...] }. Synced across the listener's
--    devices (union on merge). Row-level security on the table already limits
--    it to its owner. The app keeps working (without syncing blocks) until
--    this has been run.
-- 2. station_songs: the songs listeners' checks have seen each station play
--    (written by api/nowplaying.js with the server key whenever a station's
--    title changes), so /admin can show a reported station's recent songs.
--    Server-only, like the play log: RLS on, no policies. At most 30 rows per
--    station are kept (a trigger trims on insert).
-- Safe to run more than once.

alter table public.user_settings add column if not exists genre_blocks jsonb;

alter table public.user_settings drop constraint if exists genre_blocks_is_object;
alter table public.user_settings add constraint genre_blocks_is_object
  check (genre_blocks is null or jsonb_typeof(genre_blocks) = 'object');

create table if not exists public.station_songs (
  id          bigint generated always as identity primary key,
  uuid        text not null check (length(uuid) <= 64),
  title       text not null check (length(title) <= 300),
  first_seen  timestamptz not null default now()
);
create index if not exists station_songs_uuid_seen_idx on public.station_songs (uuid, first_seen desc);

create or replace function public.station_songs_trim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.station_songs
  where uuid = new.uuid
    and id not in (select id from public.station_songs where uuid = new.uuid order by first_seen desc, id desc limit 30);
  return null;
end;
$$;
drop trigger if exists station_songs_trim_trg on public.station_songs;
create trigger station_songs_trim_trg after insert on public.station_songs
  for each row execute function public.station_songs_trim();

alter table public.station_songs enable row level security;
revoke all on public.station_songs from anon, authenticated;
grant select, insert, delete on public.station_songs to service_role;
