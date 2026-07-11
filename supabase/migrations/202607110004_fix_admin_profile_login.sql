-- Fix admin panel login guard.
-- The web panel calls public.get_admin_profile() after Supabase Auth login.
-- This migration ensures the RPC is executable by authenticated users and that
-- the current owner email is registered as an active admin profile.

begin;

create table if not exists public.admin_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('owner', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_profiles enable row level security;

drop policy if exists "authenticated read own admin profile" on public.admin_profiles;
create policy "authenticated read own admin profile"
on public.admin_profiles
for select
to authenticated
using (auth_user_id = auth.uid());

insert into public.admin_profiles (auth_user_id, email, role, is_active)
select id, email, 'owner', true
from auth.users
where lower(email) = lower('saisoku@ssidmail.my.id')
on conflict (auth_user_id) do update
set email = excluded.email,
    role = 'owner',
    is_active = true,
    updated_at = now();

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
    and p.role in ('owner', 'admin')
  limit 1
$$;

revoke all on function public.get_admin_profile() from public;
revoke all on function public.get_admin_profile() from anon;
grant execute on function public.get_admin_profile() to authenticated;
grant execute on function public.get_admin_profile() to service_role;

grant usage on schema public to authenticated;
grant select on table public.admin_profiles to authenticated;
grant all on table public.admin_profiles to service_role;

commit;
