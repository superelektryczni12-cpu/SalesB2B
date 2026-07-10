-- Sales B2B: zalaczniki (obrazy/pliki tekstowe) do sesji BriefAI.
-- Wklej caly plik do Supabase -> SQL Editor -> New query -> Run.

insert into storage.buckets (id, name, public, file_size_limit)
values ('sales-b2b-brief-attachments', 'sales-b2b-brief-attachments', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760;

drop policy if exists "brief_attachments_read_org" on storage.objects;
create policy "brief_attachments_read_org"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'sales-b2b-brief-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "brief_attachments_insert_org" on storage.objects;
create policy "brief_attachments_insert_org"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'sales-b2b-brief-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "brief_attachments_update_org" on storage.objects;
create policy "brief_attachments_update_org"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'sales-b2b-brief-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'sales-b2b-brief-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "brief_attachments_delete_org" on storage.objects;
create policy "brief_attachments_delete_org"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'sales-b2b-brief-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

select 'Sales B2B brief attachments bucket ready' as result;
