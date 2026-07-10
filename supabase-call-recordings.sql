-- Sales B2B: nagrania rozmow do transkrypcji ("Po rozmowie").
-- Wklej caly plik do Supabase -> SQL Editor -> New query -> Run.

insert into storage.buckets (id, name, public, file_size_limit)
values ('sales-b2b-call-recordings', 'sales-b2b-call-recordings', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400;

drop policy if exists "call_recordings_read_org" on storage.objects;
create policy "call_recordings_read_org"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'sales-b2b-call-recordings'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "call_recordings_insert_org" on storage.objects;
create policy "call_recordings_insert_org"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'sales-b2b-call-recordings'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "call_recordings_update_org" on storage.objects;
create policy "call_recordings_update_org"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'sales-b2b-call-recordings'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'sales-b2b-call-recordings'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "call_recordings_delete_org" on storage.objects;
create policy "call_recordings_delete_org"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'sales-b2b-call-recordings'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

select 'Sales B2B call recordings bucket ready' as result;
