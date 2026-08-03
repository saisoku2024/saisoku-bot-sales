-- Migration: Restrict broad RLS read policies to active admin profiles only
-- Resolves HIGH vulnerability where any authenticated user could query sensitive tables directly via PostgREST

begin;

-- Helper function to check if current authenticated user has an active admin profile
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
  );
$$;

revoke all on function public.is_active_admin() from public;
revoke all on function public.is_active_admin() from anon;
grant execute on function public.is_active_admin() to authenticated;
grant execute on function public.is_active_admin() to service_role;

-- 1. balance_logs
drop policy if exists "authenticated read balance_logs" on public.balance_logs;
drop policy if exists "admin read balance_logs" on public.balance_logs;
create policy "admin read balance_logs"
on public.balance_logs for select to authenticated
using (public.is_active_admin());

-- 2. debug_webhook_logs
drop policy if exists "authenticated read debug_webhook_logs" on public.debug_webhook_logs;
drop policy if exists "admin read debug_webhook_logs" on public.debug_webhook_logs;
create policy "admin read debug_webhook_logs"
on public.debug_webhook_logs for select to authenticated
using (public.is_active_admin());

-- 3. deposit_requests
drop policy if exists "authenticated read deposit_requests" on public.deposit_requests;
drop policy if exists "admin read deposit_requests" on public.deposit_requests;
create policy "admin read deposit_requests"
on public.deposit_requests for select to authenticated
using (public.is_active_admin());

-- 4. pending_orders
drop policy if exists "authenticated read pending_orders" on public.pending_orders;
drop policy if exists "admin read pending_orders" on public.pending_orders;
create policy "admin read pending_orders"
on public.pending_orders for select to authenticated
using (public.is_active_admin());

-- 5. product_accounts
drop policy if exists "authenticated read product_accounts" on public.product_accounts;
drop policy if exists "admin read product_accounts" on public.product_accounts;
create policy "admin read product_accounts"
on public.product_accounts for select to authenticated
using (public.is_active_admin());

-- 6. sold_accounts
drop policy if exists "authenticated read sold_accounts" on public.sold_accounts;
drop policy if exists "admin read sold_accounts" on public.sold_accounts;
create policy "admin read sold_accounts"
on public.sold_accounts for select to authenticated
using (public.is_active_admin());

-- 7. transactions
drop policy if exists "authenticated read transactions" on public.transactions;
drop policy if exists "admin read transactions" on public.transactions;
create policy "admin read transactions"
on public.transactions for select to authenticated
using (public.is_active_admin());

-- 8. users
drop policy if exists "authenticated read users" on public.users;
drop policy if exists "admin read users" on public.users;
create policy "admin read users"
on public.users for select to authenticated
using (public.is_active_admin());

commit;
