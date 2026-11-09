-- Neo Earth Radio: station checks can now record 'low_quality' (stream bitrate
-- below the minimum), shown on the admin dashboard's Station checks panel.

alter table public.station_checks drop constraint if exists station_checks_result_check;
alter table public.station_checks add constraint station_checks_result_check check (result in (
  'passed', 'not_https', 'no_coords', 'playlist', 'not_music',
  'no_city', 'slow_or_offline', 'not_audio', 'no_song_titles', 'low_quality'));

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
    'no_city', 'slow_or_offline', 'not_audio', 'no_song_titles', 'low_quality')
  on conflict (station_uuid) do update
    set result = excluded.result,
        country_code = coalesce(excluded.country_code, s.country_code),
        checked_at = now(),
        times_checked = s.times_checked + 1;
$$;

revoke all on function public.record_checks(jsonb) from public, anon, authenticated;
grant execute on function public.record_checks(jsonb) to service_role;
