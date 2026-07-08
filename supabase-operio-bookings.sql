-- Operio: rezerwacje z formularza na stronie publicznej (operio-site).
-- Wklej caly plik do Supabase -> SQL Editor -> New query -> Run.

create extension if not exists pgcrypto;

create table if not exists public.operio_bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  email text not null,
  phone text not null default '',
  position text not null default '',
  problem text not null,
  booking_date date not null,
  booking_time text not null,
  booking_time_end text not null,
  status text not null default 'nowe',
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  constraint operio_bookings_name_length check (char_length(name) <= 200),
  constraint operio_bookings_company_length check (char_length(company) <= 200),
  constraint operio_bookings_email_length check (char_length(email) <= 200),
  constraint operio_bookings_problem_length check (char_length(problem) <= 4000)
);

create index if not exists operio_bookings_created_idx
  on public.operio_bookings (created_at desc);

create index if not exists operio_bookings_pending_idx
  on public.operio_bookings (imported_at) where imported_at is null;

-- RLS wlaczone bez zadnych polityk: strona publiczna nie ma bezposredniego
-- dostepu do tabeli. Zapis wykonuje wylacznie Edge Function
-- "operio-booking" kluczem service role, ktory omija RLS.
alter table public.operio_bookings enable row level security;

select 'Operio bookings ready' as result;
