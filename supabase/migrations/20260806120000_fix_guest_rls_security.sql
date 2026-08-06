-- Migration: Fix guest RLS security vulnerabilities
-- Restricts sensitive table RLS policies exclusively to active owner and admin accounts.
-- Excludes viewer/guest role from querying stock credentials, sold accounts, user tables, and audit/financial logs via PostgREST.

begin;

-- Helper function: Returns true ONLY for active owner or admin accounts (excludes viewer/guest)
create or replace function public.is_active_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles
    where auth_user_id = auth.uid()
      and is_active = true
      and role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_active_admin() from public;
revoke all on function public.is_active_admin() from anon;
grant execute on function public.is_active_admin() to authenticated;
grant execute on function public.is_active_admin() to service_role;

-- Helper function: Returns true for any active panel account (owner, admin, viewer)
create or replace function public.is_active_panel_user()
returns boolean
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles
    where auth_user_id = auth.uid()
      and is_active = true
      and role in ('owner', 'admin', 'viewer')
  );
$$;

revoke all on function public.is_active_panel_user() from public;
revoke all on function public.is_active_panel_user() from anon;
grant execute on function public.is_active_panel_user() to authenticated;
grant execute on function public.is_active_panel_user() to service_role;

-- 1. Highly sensitive inventory and financial tables: RESTRICT EXCLUSIVELY to owner & admin (block viewer/guest)
drop policy if exists "admin read product_accounts" on public.product_accounts;
create policy "admin read product_accounts"
on public.product_accounts for select to authenticated
using (public.is_active_admin());

drop policy if exists "admin read sold_accounts" on public.sold_accounts;
create policy "admin read sold_accounts"
on public.sold_accounts for select to authenticated
using (public.is_active_admin());

drop policy if exists "admin read debug_webhook_logs" on public.debug_webhook_logs;
create policy "admin read debug_webhook_logs"
on public.debug_webhook_logs for select to authenticated
using (public.is_active_admin());

drop policy if exists "admin read balance_logs" on public.balance_logs;
create policy "admin read balance_logs"
on public.balance_logs for select to authenticated
using (public.is_active_admin());

drop policy if exists "admin read deposit_requests" on public.deposit_requests;
create policy "admin read deposit_requests"
on public.deposit_requests for select to authenticated
using (public.is_active_admin());

-- 2. General dashboard overview tables: Allow panel users (owner, admin, viewer) for read-only aggregate metrics
drop policy if exists "admin read transactions" on public.transactions;
create policy "panel read transactions"
on public.transactions for select to authenticated
using (public.is_active_panel_user());

drop policy if exists "admin read users" on public.users;
create policy "panel read users"
on public.users for select to authenticated
using (public.is_active_panel_user());

drop policy if exists "admin read pending_orders" on public.pending_orders;
create policy "panel read pending_orders"
on public.pending_orders for select to authenticated
using (public.is_active_panel_user());

commit;
