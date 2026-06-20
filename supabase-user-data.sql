-- Sales B2B 1.2: dane aplikacji przypisane do konkretnego konta.
-- Wklej calosc do Supabase -> SQL Editor -> New query -> Run.

create table if not exists public.user_app_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  data_key text not null,
  value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);

alter table public.user_app_data enable row level security;

drop policy if exists "user_app_data_read_own" on public.user_app_data;
create policy "user_app_data_read_own"
  on public.user_app_data for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_app_data_insert_own" on public.user_app_data;
create policy "user_app_data_insert_own"
  on public.user_app_data for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_app_data_update_own" on public.user_app_data;
create policy "user_app_data_update_own"
  on public.user_app_data for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_app_data_delete_own" on public.user_app_data;
create policy "user_app_data_delete_own"
  on public.user_app_data for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete
  on public.user_app_data
  to authenticated;

select 'Sales B2B user data ready' as result;
