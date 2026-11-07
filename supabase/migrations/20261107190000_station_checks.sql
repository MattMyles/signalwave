-- Signal Wave: the latest check result for every station the server has
-- looked at, for the "Station checks" panel on the admin dashboard.
-- Server-only, like the play log: RLS on, no policies.

create table if not exists public.station_checks (
  station_uuid  text primary key check (length(station_uuid) <= 64),
  result        text not null check (result in (
                  'passed', 'not_https', 'no_coords', 'playlist', 'not_music',
                  'no_city', 'slow_or_offline', 'not_audio', 'no_song_titles')),
  country_code  text check (length(country_code) <= 4),
  checked_at    timestamptz not null default now(),
  times_checked integer not null default 1
);

create index if not exists station_checks_result_idx on public.station_checks (result);

alter table public.station_checks enable row level security;
revoke all on public.station_checks from anon, authenticated;
grant select, insert, update on public.station_checks to service_role;

-- Saves a batch of results: [{ "uuid": "...", "result": "passed", "cc": "FR" }, ...]
create or replace function public.record_checks(rows jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.station_checks as s (station_uuid, result, country_code)
  select distinct on (r->>'uuid') left(r->>'uuid', 64), r->>'result', left(nullif(upper(r->>'cc'), ''), 4)
  from jsonb_array_elements(rows) as r
  where r->>'uuid' is not null and r->>'result' in (
    'passed', 'not_https', 'no_coords', 'playlist', 'not_music',
    'no_city', 'slow_or_offline', 'not_audio', 'no_song_titles')
  on conflict (station_uuid) do update
    set result = excluded.result,
        country_code = coalesce(excluded.country_code, s.country_code),
        checked_at = now(),
        times_checked = s.times_checked + 1;
$$;

revoke all on function public.record_checks(jsonb) from public, anon, authenticated;
grant execute on function public.record_checks(jsonb) to service_role;

-- Totals for the dashboard panel.
create or replace function public.admin_check_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'checked', (select count(*) from public.station_checks),
    'passed', (select count(*) from public.station_checks where result = 'passed'),
    'checked_7d', (select count(*) from public.station_checks where checked_at > now() - interval '7 days'),
    'passed_countries', (select count(distinct country_code) from public.station_checks where result = 'passed'),
    'by_result', (
      select coalesce(jsonb_object_agg(result, n), '{}'::jsonb)
      from (select result, count(*) as n from public.station_checks group by result) t)
  );
$$;

revoke all on function public.admin_check_stats() from public, anon, authenticated;
grant execute on function public.admin_check_stats() to service_role;
