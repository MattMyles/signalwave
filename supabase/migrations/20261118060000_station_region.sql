-- Neo Earth Radio: stations whose city can't be determined stay on the shelf,
-- placed at their country. `region` is the state or province their directory
-- entry lists (when it is a usable one), shown next to the country in the app;
-- `city` stays null for them. Stations with a real city leave region empty.
-- Until this is run the scout still works: it saves rows without region.
-- Safe to run more than once. (pool_candidates returns whole station_pool
-- rows, so it picks the new column up with no change.)

alter table public.station_pool add column if not exists region text;
