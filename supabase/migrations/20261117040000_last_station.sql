-- Neo Earth Radio: remember the last station a signed-in listener was playing,
-- so JACK IN can resume it on any of their devices.
--
-- One small JSON object on the existing user_settings row (the station's
-- details plus an "at" timestamp in milliseconds). Row-level security on the
-- table already limits it to its owner. Safe to run more than once. The app
-- keeps working (without the cross-device resume) until this has been run.

alter table public.user_settings add column if not exists last_station jsonb;

alter table public.user_settings drop constraint if exists last_station_is_object;
alter table public.user_settings add constraint last_station_is_object
  check (last_station is null or jsonb_typeof(last_station) = 'object');
