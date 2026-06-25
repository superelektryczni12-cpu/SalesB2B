-- Sales B2B: administrator moze przegladac i aktualizowac dane kont
-- nalezacych do tej samej organizacji. Uruchom calosc w Supabase SQL Editor.

create or replace function public.can_manage_user_app_data(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user = auth.uid() or exists (
    select 1
    from public.organization_members target
    join public.organization_members supervisor
      on supervisor.organization_id = target.organization_id
    where target.user_id = target_user
      and target.status = 'active'
      and supervisor.user_id = auth.uid()
      and supervisor.status = 'active'
      and supervisor.role in ('admin', 'manager')
  );
$$;

revoke all on function public.can_manage_user_app_data(uuid) from public;
grant execute on function public.can_manage_user_app_data(uuid) to authenticated;

drop policy if exists "user_app_data_read_team_admin" on public.user_app_data;
create policy "user_app_data_read_team_admin"
  on public.user_app_data for select
  to authenticated
  using (public.can_manage_user_app_data(user_id));

drop policy if exists "user_app_data_insert_team_admin" on public.user_app_data;
create policy "user_app_data_insert_team_admin"
  on public.user_app_data for insert
  to authenticated
  with check (public.can_manage_user_app_data(user_id));

drop policy if exists "user_app_data_update_team_admin" on public.user_app_data;
create policy "user_app_data_update_team_admin"
  on public.user_app_data for update
  to authenticated
  using (public.can_manage_user_app_data(user_id))
  with check (public.can_manage_user_app_data(user_id));

drop policy if exists "user_app_data_delete_team_admin" on public.user_app_data;
create policy "user_app_data_delete_team_admin"
  on public.user_app_data for delete
  to authenticated
  using (public.can_manage_user_app_data(user_id));

select 'Sales B2B admin team access ready' as result;
