-- Sales B2B: konta użytkowników, organizacje, role i uprawnienia.
-- Wklej cały plik do Supabase -> SQL Editor -> New query -> Run.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  full_name text not null,
  role text not null default 'handlowiec'
    check (role in ('admin', 'manager', 'koordynator', 'handlowiec', 'specjalista')),
  permissions text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_members_org_email_key
  on public.organization_members (organization_id, lower(email));

create unique index if not exists organization_members_user_key
  on public.organization_members (user_id)
  where user_id is not null;

create or replace function public.is_organization_member(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.is_organization_admin(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization
      and user_id = auth.uid()
      and status = 'active'
      and role in ('admin', 'manager')
  );
$$;

create or replace function public.handle_new_sales_b2b_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_member public.organization_members%rowtype;
  new_organization_id uuid;
  requested_name text;
  requested_company text;
begin
  requested_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  requested_company := coalesce(nullif(trim(new.raw_user_meta_data ->> 'company_name'), ''), requested_name || ' - firma');

  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), requested_name)
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();

  select * into invited_member
  from public.organization_members
  where lower(email) = lower(new.email)
    and status = 'pending'
    and user_id is null
  order by created_at
  limit 1
  for update;

  if found then
    update public.organization_members
    set user_id = new.id,
        full_name = coalesce(nullif(full_name, ''), requested_name),
        status = 'active',
        updated_at = now()
    where id = invited_member.id;
  else
    insert into public.organizations (name, created_by)
    values (requested_company, new.id)
    returning id into new_organization_id;

    insert into public.organization_members (
      organization_id, user_id, email, full_name, role, permissions, status
    ) values (
      new_organization_id,
      new.id,
      lower(new.email),
      requested_name,
      'admin',
      array['all']::text[],
      'active'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_sales_b2b_user_created on auth.users;
create trigger on_sales_b2b_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_sales_b2b_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists "profile_read_own" on public.profiles;
create policy "profile_read_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "organization_read_member" on public.organizations;
create policy "organization_read_member"
  on public.organizations for select
  to authenticated
  using (public.is_organization_member(id));

drop policy if exists "organization_update_admin" on public.organizations;
create policy "organization_update_admin"
  on public.organizations for update
  to authenticated
  using (public.is_organization_admin(id))
  with check (public.is_organization_admin(id));

drop policy if exists "members_read_same_organization" on public.organization_members;
create policy "members_read_same_organization"
  on public.organization_members for select
  to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "members_insert_admin" on public.organization_members;
create policy "members_insert_admin"
  on public.organization_members for insert
  to authenticated
  with check (
    public.is_organization_admin(organization_id)
    and user_id is null
    and status = 'pending'
    and role <> 'admin'
  );

drop policy if exists "members_update_admin" on public.organization_members;
create policy "members_update_admin"
  on public.organization_members for update
  to authenticated
  using (public.is_organization_admin(organization_id))
  with check (
    public.is_organization_admin(organization_id)
    and role <> 'admin'
  );

drop policy if exists "members_delete_admin" on public.organization_members;
create policy "members_delete_admin"
  on public.organization_members for delete
  to authenticated
  using (
    public.is_organization_admin(organization_id)
    and user_id is distinct from auth.uid()
    and role <> 'admin'
  );

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;

-- Dane robocze aplikacji sa przechowywane oddzielnie dla kazdego konta.
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
create policy "user_app_data_read_own" on public.user_app_data
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "user_app_data_insert_own" on public.user_app_data;
create policy "user_app_data_insert_own" on public.user_app_data
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_app_data_update_own" on public.user_app_data;
create policy "user_app_data_update_own" on public.user_app_data
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "user_app_data_delete_own" on public.user_app_data;
create policy "user_app_data_delete_own" on public.user_app_data
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.user_app_data to authenticated;

-- Kontrola po uruchomieniu:
select 'Sales B2B schema ready' as result;
