-- Signal Wave: listening log for the private admin dashboard.
--
-- One row per station a listener actually heard (30+ seconds). Listeners are
-- identified only by a random ID their browser makes up; no IP address or
-- location is stored. The table has row-level security on and NO policies,
-- so the public app key can't read or write it at all. Only the server, using
-- the secret service key, records plays and reads the totals.

create table if not exists public.plays (
  id           bigint generated always as identity primary key,
  played_at    timestamptz not null default now(),
  visitor_id   uuid not null,
  user_id      uuid references auth.users (id) on delete set null,
  station_uuid text not null check (length(station_uuid) <= 64),
  station_name text check (length(station_name) <= 200),
  city         text check (length(city) <= 120),
  country      text check (length(country) <= 120),
  country_code text check (length(country_code) <= 4),
  genre        text check (length(genre) <= 80)
);

create index if not exists plays_played_at_idx on public.plays (played_at desc);
create index if not exists plays_station_idx on public.plays (station_uuid);
create index if not exists plays_visitor_idx on public.plays (visitor_id);

alter table public.plays enable row level security;
revoke all on public.plays from anon, authenticated;
grant select, insert on public.plays to service_role;
grant usage, select on sequence public.plays_id_seq to service_role;

-- Everything the dashboard shows, in one call. Dates are grouped in the
-- given time zone. Callable only with the service key.
create or replace function public.admin_stats(tz text default 'America/New_York')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (select * from public.plays),
  today as (select (now() at time zone tz)::date as d)
  select jsonb_build_object(
    'generated_at', now(),
    'visitors_total', (select count(distinct visitor_id) from p),
    'visitors_7d', (select count(distinct visitor_id) from p where played_at > now() - interval '7 days'),
    'visitors_today', (select count(distinct visitor_id) from p, today where (played_at at time zone tz)::date = today.d),
    'plays_total', (select count(*) from p),
    'plays_7d', (select count(*) from p where played_at > now() - interval '7 days'),
    'plays_today', (select count(*) from p, today where (played_at at time zone tz)::date = today.d),
    'stations_total', (select count(distinct station_uuid) from p),
    'countries_total', (select count(distinct country_code) from p where country_code is not null),
    'accounts_total', (select count(*) from auth.users),
    'accounts_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'signed_in_listeners', (select count(distinct user_id) from p where user_id is not null),
    'synced_accounts', (select count(*) from public.user_settings),
    'saved_stations_total', (select coalesce(sum(jsonb_array_length(favorites)), 0) from public.user_settings),
    'top_stations', (
      select coalesce(jsonb_agg(t order by t.plays desc, t.name), '[]'::jsonb) from (
        select station_uuid, max(station_name) as name, max(city) as city, max(country) as country,
               max(country_code) as country_code, max(genre) as genre,
               count(*) as plays, count(distinct visitor_id) as listeners
        from p group by station_uuid order by count(*) desc, max(station_name) limit 10
      ) t),
    'top_countries', (
      select coalesce(jsonb_agg(t order by t.plays desc, t.country), '[]'::jsonb) from (
        select country_code, max(country) as country, count(*) as plays,
               count(distinct station_uuid) as stations, count(distinct visitor_id) as listeners
        from p where country_code is not null
        group by country_code order by count(*) desc, max(country) limit 10
      ) t),
    'top_genres', (
      select coalesce(jsonb_agg(t order by t.plays desc, t.genre), '[]'::jsonb) from (
        select lower(genre) as genre, count(*) as plays
        from p where genre is not null and genre <> ''
        group by lower(genre) order by count(*) desc, lower(genre) limit 10
      ) t),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'plays', d.plays, 'visitors', d.visitors) order by d.day), '[]'::jsonb)
      from (
        select gs::date as day, coalesce(x.plays, 0) as plays, coalesce(x.visitors, 0) as visitors
        from today,
             generate_series(today.d - 29, today.d, interval '1 day') as gs
        left join (
          select (played_at at time zone tz)::date as day, count(*) as plays, count(distinct visitor_id) as visitors
          from p where played_at > now() - interval '31 days' group by 1
        ) x on x.day = gs::date
      ) d),
    'recent', (
      select coalesce(jsonb_agg(r order by r.played_at desc), '[]'::jsonb) from (
        select played_at, station_name, city, country, country_code, genre, (user_id is not null) as signed_in
        from p order by played_at desc limit 15
      ) r)
  );
$$;

revoke all on function public.admin_stats(text) from public, anon, authenticated;
grant execute on function public.admin_stats(text) to service_role;
