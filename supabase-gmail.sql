-- Sales B2B: konta Gmail podpiete przez kazdego pracownika (zakladka Maile).
-- Wklej calosc do Supabase -> SQL Editor -> New query -> Run.
--
-- UWAGA (decyzja bezpieczenstwa, nie kopiowac wzorca z supabase-user-data.sql):
-- user_app_data pozwala adminowi/managerowi odczytac i nadpisac dowolny data_key
-- dowolnego pracownika w organizacji (public.can_manage_user_app_data). To jest
-- ok dla danych CRM, ale NIE dla tokenow OAuth do prywatnej skrzynki Gmail --
-- ktos z rola admin/manager moglby wtedy wyciagnac token i czytac/wysylac poczte
-- pracownika poza aplikacja, bezterminowo, az do recznego odwolania dostepu w
-- Google. Dlatego ta tabela ma WYLACZNIE polityki "wlasciciel" (auth.uid()),
-- bez zadnego mechanizmu admin-bypass. Renderer nigdy nie czyta tej tabeli
-- bezposrednio -- tylko przez edge functions gmail-oauth-exchange/gmail-api,
-- ktore uzywaja service role i zawsze skopuja sie do WLASNEGO userId wywolujacego.

create table if not exists public.gmail_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gmail_accounts enable row level security;

drop policy if exists "gmail_accounts_select_own" on public.gmail_accounts;
create policy "gmail_accounts_select_own"
  on public.gmail_accounts for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "gmail_accounts_update_own" on public.gmail_accounts;
create policy "gmail_accounts_update_own"
  on public.gmail_accounts for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "gmail_accounts_delete_own" on public.gmail_accounts;
create policy "gmail_accounts_delete_own"
  on public.gmail_accounts for delete
  to authenticated
  using (user_id = auth.uid());

-- Celowo brak insert policy dla "authenticated": wiersz zawsze tworzy
-- gmail-oauth-exchange przez klienta service-role (omija RLS).

grant select, update, delete on public.gmail_accounts to authenticated;

select 'Sales B2B gmail_accounts ready' as result;
