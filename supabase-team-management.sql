-- Sales B2B: zespoly, przelozeni i cele miesieczne.
-- Wklej calosc do Supabase -> SQL Editor -> New query -> Run.

alter table public.organization_members
  add column if not exists manager_member_id uuid references public.organization_members(id) on delete set null;

alter table public.organization_members
  add column if not exists monthly_goals jsonb not null default '{}'::jsonb;

update public.organization_members
set monthly_goals = '{}'::jsonb
where monthly_goals is null;

create index if not exists organization_members_manager_member_id_idx
  on public.organization_members (manager_member_id);

comment on column public.organization_members.manager_member_id is
  'Przelozony pracownika w tej samej organizacji. Admin moze przypisac dowolnego managera, manager przypisuje ludzi do siebie.';

comment on column public.organization_members.monthly_goals is
  'Cele miesieczne pracownika, np. {"calls": 400, "meetings": 20, "offers": 12, "sales": 4, "revenue": 50000}.';

select 'Sales B2B team management ready' as result;
