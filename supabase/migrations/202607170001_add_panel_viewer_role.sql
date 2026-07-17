-- Add read-only panel access role.
-- Viewer accounts can enter the web panel and read dashboard data, but server
-- write endpoints still require owner/admin in the application guard.

begin;

alter table public.admin_profiles
  drop constraint if exists admin_profiles_role_check;

alter table public.admin_profiles
  add constraint admin_profiles_role_check
  check (role in ('owner', 'admin', 'viewer'));

create or replace function public.get_admin_profile()
returns table (
  auth_user_id uuid,
  email text,
  role text,
  is_active boolean
)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select
    p.auth_user_id,
    p.email,
    p.role,
    p.is_active
  from public.admin_profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active = true
    and p.role in ('owner', 'admin', 'viewer')
  limit 1
$$;

revoke all on function public.get_admin_profile() from public;
revoke all on function public.get_admin_profile() from anon;
grant execute on function public.get_admin_profile() to authenticated;
grant execute on function public.get_admin_profile() to service_role;

commit;
