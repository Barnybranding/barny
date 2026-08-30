-- Super-admin-only staff directory. auth.users isn't directly queryable by
-- clients, so this security-definer function is the only way the admin
-- UI can list staff emails alongside their role.

begin;

create or replace function public.list_staff()
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can list staff accounts';
  end if;

  return query
  select a.user_id, u.email::text, a.role, a.created_at
  from public.admin_users a
  join auth.users u on u.id = a.user_id
  order by a.created_at desc;
end;
$$;

revoke all on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;

commit;
