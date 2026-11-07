-- Signal Wave: one row of saved settings per signed-in user.
-- Row-level security means each person can only read and change their own row,
-- even though the app talks to the database with a public key.

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  favorites  jsonb not null default '[]'::jsonb,
  genres     jsonb,                              -- null = never customized
  hidden     jsonb not null default '[]'::jsonb, -- stations flagged "not music"
  updated_at timestamptz not null default now(),
  constraint favorites_is_array check (jsonb_typeof(favorites) = 'array'),
  constraint hidden_is_array check (jsonb_typeof(hidden) = 'array'),
  constraint settings_size check (pg_column_size(favorites) + pg_column_size(hidden) < 512000)
);

alter table public.user_settings enable row level security;

drop policy if exists "read own settings" on public.user_settings;
drop policy if exists "insert own settings" on public.user_settings;
drop policy if exists "update own settings" on public.user_settings;
drop policy if exists "delete own settings" on public.user_settings;

create policy "read own settings" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own settings" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own settings" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own settings" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get no access at all.
revoke all on public.user_settings from anon;
