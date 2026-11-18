-- Neo Earth Radio, build 57: judging genres more closely.
--
-- 1. artist_info: what MusicBrainz says about an artist (home country and the
--    genres people gave them), so the scout asks about each artist once a month
--    and the live paths can read genres without ever asking MusicBrainz. Filled by
--    the scout (scripts/scout.js), read by lib/pool.js and api/nowplaying.js.
--    `tags` is the genre names joined by '|', most voted first. Server-only.
-- 2. pool_candidates(): a station with no tags at all (most stations in India,
--    the Philippines, Nepal and Indonesia) is only served for an Any pick (no genre
--    chosen) once at least 2 of its song samples were found in Apple's catalog.
--    With a genre picked nothing changes: such a station only has genres at all when
--    its songs vouched for them.
-- 3. genre_reports.suggested: the genre a listener said the song really is
--    (a genre key such as 'tag:dancehall' or 'reggae'), picked from the app's list
--    after tapping WRONG GENRE?. Null when they skipped. The app keeps working
--    before this is run: the report is saved without it.
-- (The genre editor's verified counts need no new function: they use pool_stats().)
-- Safe to run more than once.

create table if not exists public.artist_info (
  name       text primary key check (length(name) <= 200),
  country    text check (length(country) <= 4),
  tags       text not null default '',
  looked_at  timestamptz not null default now()
);
alter table public.artist_info enable row level security;
revoke all on public.artist_info from anon, authenticated;
grant select, insert, update on public.artist_info to service_role;

alter table public.genre_reports add column if not exists suggested text check (length(suggested) <= 80);

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
    -- an untagged station needs 2+ identified songs before it plays for an Any pick
    and (
      coalesce(cardinality(p_keys), 0) > 0
      or coalesce(s.tags, '') <> ''
      or (select count(*) from jsonb_array_elements(coalesce(s.samples, '[]'::jsonb)) e where e->>'known' = 'true') >= 2
    )
    and (p_countries is null or cardinality(p_countries) = 0 or s.country_code = any (p_countries))
    and not (s.uuid = any (coalesce(p_exclude, '{}'::text[])))
  order by random()
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
