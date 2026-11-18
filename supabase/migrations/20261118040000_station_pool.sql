-- Neo Earth Radio: the station shelf.
-- A background scout (scripts/scout.js, run by .github/workflows/scout.yml)
-- finds stations, checks them over days and judges their genre by what they
-- actually play, then keeps the ones that passed here. NEXT draws from this
-- shelf first (api/next.js -> lib/pool.js) and only vets stations live when
-- the shelf has nothing for the pick.
--   station_pool   one row per station: where it is, its stream, and the
--                  genre keys it currently qualifies for (same keys as the
--                  server's genre specs: 'rock', 'tag:classic rock', ...)
--   song_lookups   cache of the iTunes lookups the scout makes, so each song
--                  is only ever asked about once (genre = Apple genres joined by '|')
--   scout_runs     one row per scout run, for the admin dashboard
--   pool_candidates / pool_stats / pool_mark_fail   functions the server calls
-- Server-only, like genre_reports: RLS on, no policies, service_role only.
-- Safe to run more than once.

create table if not exists public.station_pool (
  uuid            text primary key check (length(uuid) <= 64),
  source          text not null default 'radiobrowser' check (source in ('radiobrowser', 'icecast')),
  name            text not null check (length(name) <= 300),
  url             text not null check (length(url) <= 2000),
  homepage        text,
  favicon         text,
  tags            text,
  country         text,
  country_code    text check (length(country_code) <= 4),
  city            text,
  lat             double precision,
  lng             double precision,
  codec           text,
  bitrate         integer,
  cors            boolean,
  genres          text[] not null default '{}',
  samples         jsonb not null default '[]'::jsonb,
  local_ratio     real,
  ok_count        integer not null default 0,
  fail_streak     integer not null default 0,
  status          text not null default 'active' check (status in ('active', 'dead')),
  first_seen_at   timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  last_ok_at      timestamptz
);

create index if not exists station_pool_genres_idx on public.station_pool using gin (genres);
create index if not exists station_pool_status_ok_idx on public.station_pool (status, last_ok_at);
create index if not exists station_pool_checked_idx on public.station_pool (last_checked_at);
create unique index if not exists station_pool_url_idx on public.station_pool (url);

create table if not exists public.song_lookups (
  key        text primary key check (length(key) <= 400),
  genre      text,
  year       integer,
  found      boolean not null default false,
  looked_at  timestamptz not null default now()
);

create table if not exists public.scout_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  discovered   integer not null default 0,
  checked      integer not null default 0,
  added        integer not null default 0,
  now_dead     integer not null default 0,
  active_total integer not null default 0,
  notes        text
);
create index if not exists scout_runs_started_idx on public.scout_runs (started_at desc);

alter table public.station_pool enable row level security;
alter table public.song_lookups enable row level security;
alter table public.scout_runs enable row level security;
revoke all on public.station_pool, public.song_lookups, public.scout_runs from anon, authenticated;
grant select, insert, update on public.station_pool to service_role;
grant select, insert, update on public.song_lookups to service_role;
grant select, insert, update on public.scout_runs to service_role;

-- Stations NEXT may serve: active, verified in the last 48 hours, and not
-- failing live right now (3 failed liveness checks in a row bench a station
-- until the scout verifies it again).
-- p_keys     genre keys of the pick (empty = any)
-- p_exclude  station ids to leave out (heard before, reported)
-- p_countries  optional: only these country codes (the server uses it to
--              steer picks to one world region at a time)
drop function if exists public.pool_candidates(text[], text[], integer);
create or replace function public.pool_candidates(
  p_keys text[],
  p_exclude text[],
  p_limit integer default 60,
  p_countries text[] default null
)
returns setof public.station_pool
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.*
  from public.station_pool s
  where s.status = 'active'
    and s.last_ok_at > now() - interval '48 hours'
    and s.fail_streak < 3
    and (coalesce(cardinality(p_keys), 0) = 0 or s.genres && p_keys)
    and (p_countries is null or cardinality(p_countries) = 0 or s.country_code = any (p_countries))
    and not (s.uuid = any (coalesce(p_exclude, '{}'::text[])))
  order by random()
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

-- Counts of servable stations per genre key, plus:
--   '*'          all servable stations
--   'src:<name>' servable stations by source
--   'dead'       stations marked dead
--   'stale'      active stations not verified for 48 hours
create or replace function public.pool_stats()
returns table (key text, n integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select * from public.station_pool
    where status = 'active' and last_ok_at > now() - interval '48 hours' and fail_streak < 3
  )
  select g.k, count(*)::integer from live, unnest(live.genres) as g(k) group by g.k
  union all select '*', count(*)::integer from live
  union all select 'src:' || source, count(*)::integer from live group by source
  union all select 'dead', count(*)::integer from public.station_pool where status = 'dead'
  union all select 'stale', count(*)::integer from public.station_pool
    where status = 'active' and not coalesce(last_ok_at > now() - interval '48 hours' and fail_streak < 3, false);
$$;

-- A live liveness check failed for this station: count it. The scout decides
-- when a station is really dead.
create or replace function public.pool_mark_fail(p_uuid text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.station_pool
  set fail_streak = least(fail_streak + 1, 10)
  where uuid = p_uuid;
$$;

revoke all on function public.pool_candidates(text[], text[], integer, text[]) from public, anon, authenticated;
revoke all on function public.pool_stats() from public, anon, authenticated;
revoke all on function public.pool_mark_fail(text) from public, anon, authenticated;
grant execute on function public.pool_candidates(text[], text[], integer, text[]) to service_role;
grant execute on function public.pool_stats() to service_role;
grant execute on function public.pool_mark_fail(text) to service_role;
