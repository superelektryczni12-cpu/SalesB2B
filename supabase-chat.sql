-- Sales B2B: live chat pracownikow i prywatne pliki.
-- Wklej caly plik do Supabase -> SQL Editor -> New query -> Run.

create extension if not exists pgcrypto;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_member_id uuid not null references public.organization_members(id) on delete cascade,
  recipient_member_id uuid references public.organization_members(id) on delete cascade,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint chat_messages_body_length check (char_length(body) <= 5000),
  constraint chat_messages_attachments_array check (jsonb_typeof(attachments) = 'array')
);

create index if not exists chat_messages_organization_created_idx
  on public.chat_messages (organization_id, created_at desc);

create index if not exists chat_messages_sender_idx
  on public.chat_messages (sender_member_id);

create index if not exists chat_messages_recipient_idx
  on public.chat_messages (recipient_member_id);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_read_org" on public.chat_messages;
create policy "chat_messages_read_org"
  on public.chat_messages for select
  to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "chat_messages_insert_org_member" on public.chat_messages;
create policy "chat_messages_insert_org_member"
  on public.chat_messages for insert
  to authenticated
  with check (
    public.is_organization_member(organization_id)
    and exists (
      select 1
      from public.organization_members sender
      where sender.id = sender_member_id
        and sender.organization_id = organization_id
        and sender.user_id = auth.uid()
        and sender.status = 'active'
    )
    and (
      recipient_member_id is null
      or exists (
        select 1
        from public.organization_members recipient
        where recipient.id = recipient_member_id
          and recipient.organization_id = organization_id
          and recipient.status = 'active'
      )
    )
  );

drop policy if exists "chat_messages_update_read_org" on public.chat_messages;
create policy "chat_messages_update_read_org"
  on public.chat_messages for update
  to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

grant select, insert, update on public.chat_messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('sales-b2b-chat-files', 'sales-b2b-chat-files', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760;

drop policy if exists "chat_files_read_org" on storage.objects;
create policy "chat_files_read_org"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'sales-b2b-chat-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat_files_insert_org" on storage.objects;
create policy "chat_files_insert_org"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'sales-b2b-chat-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat_files_update_org" on storage.objects;
create policy "chat_files_update_org"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'sales-b2b-chat-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'sales-b2b-chat-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat_files_delete_org" on storage.objects;
create policy "chat_files_delete_org"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'sales-b2b-chat-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

select 'Sales B2B chat ready' as result;
