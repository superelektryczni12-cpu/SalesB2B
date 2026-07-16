-- Sales B2B: wspolny rejestr "kto zajal te firme" (ostrzezenia miedzy pracownikami).
-- Wklej calosc do Supabase -> SQL Editor -> New query -> Run.
--
-- Kontekst: kazdy pracownik generuje WLASNA, prywatna liste firm (Apollo/Google) w
-- user_app_data (data_key='companies') -- dwoch pracownikow niezaleznie szukajacych
-- w tym samym segmencie moze dostac dwie osobne, niepowiazane lokalne kopie TEJ SAMEJ
-- realnej firmy, wiec dzwonia do niej po kilka razy. Ta tabela to CELOWO ODWROTNA
-- decyzja widocznosci niz gmail_accounts (supabase-gmail.sql): tam kazdy uzytkownik
-- widzi WYLACZNIE swoje wlasne dane, tutaj kazdy aktywny czlonek organizacji MUSI
-- widziec wszystkie zajete firmy calej organizacji -- o to w tej funkcji chodzi.

create table if not exists public.company_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  identity_key text not null,
  identity_type text not null check (identity_type in ('domain','phone','name_city')),
  company_name text not null,
  claimed_by_user_id uuid not null references auth.users(id) on delete cascade,
  claimed_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, identity_key)
);

alter table public.company_claims enable row level security;

drop policy if exists "company_claims_select_org" on public.company_claims;
create policy "company_claims_select_org"
  on public.company_claims for select
  to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = company_claims.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Celowo brak insert/update/delete policy dla "authenticated": zapisuje wylacznie
-- edge function company-claims przez klienta service-role (omija RLS), zeby moc
-- zweryfikowac uprawnienia (admin/manager moze przypisac w imieniu innego pracownika)
-- i pobrac prawdziwa nazwe celu server-side zamiast ufac danym od klienta.

grant select on public.company_claims to authenticated;

select 'Sales B2B company_claims ready' as result;
