-- SAISOKU Supabase security baseline
-- Goal:
-- 1) Stop public/anon table access from PostgREST.
-- 2) Keep the admin web panel read-only for authenticated Supabase Auth users.
-- 3) Keep Telegram bot flows working through the Edge Function service role.
-- 4) Remove public execution grants from sensitive RPC functions.

begin;

-- ------------------------------------------------------------
-- RLS: enable on all public tables exposed through PostgREST
-- ------------------------------------------------------------
alter table public.balance_logs enable row level security;
alter table public.debug_webhook_logs enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.loyalty_settings enable row level security;
alter table public.pending_orders enable row level security;
alter table public.product_accounts enable row level security;
alter table public.product_templates enable row level security;
alter table public.products enable row level security;
alter table public.sold_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.upload_stock_session enable row level security;
alter table public.user_states enable row level security;
alter table public.users enable row level security;
alter table public.users_profile enable row level security;
alter table public.voucher_claims enable row level security;
alter table public.vouchers enable row level security;

-- ------------------------------------------------------------
-- Policies: authenticated web panel can read; no write policies yet.
-- Writes should be reintroduced through audited server-side APIs/RPCs.
-- ------------------------------------------------------------
drop policy if exists "authenticated read balance_logs" on public.balance_logs;
create policy "authenticated read balance_logs"
on public.balance_logs for select to authenticated using (true);

drop policy if exists "authenticated read debug_webhook_logs" on public.debug_webhook_logs;
create policy "authenticated read debug_webhook_logs"
on public.debug_webhook_logs for select to authenticated using (true);

drop policy if exists "authenticated read deposit_requests" on public.deposit_requests;
create policy "authenticated read deposit_requests"
on public.deposit_requests for select to authenticated using (true);

drop policy if exists "authenticated read loyalty_settings" on public.loyalty_settings;
create policy "authenticated read loyalty_settings"
on public.loyalty_settings for select to authenticated using (true);

drop policy if exists "authenticated read pending_orders" on public.pending_orders;
create policy "authenticated read pending_orders"
on public.pending_orders for select to authenticated using (true);

drop policy if exists "authenticated read product_accounts" on public.product_accounts;
create policy "authenticated read product_accounts"
on public.product_accounts for select to authenticated using (true);

drop policy if exists "authenticated read product_templates" on public.product_templates;
create policy "authenticated read product_templates"
on public.product_templates for select to authenticated using (true);

drop policy if exists "authenticated read products" on public.products;
create policy "authenticated read products"
on public.products for select to authenticated using (true);

drop policy if exists "authenticated read sold_accounts" on public.sold_accounts;
create policy "authenticated read sold_accounts"
on public.sold_accounts for select to authenticated using (true);

drop policy if exists "authenticated read transactions" on public.transactions;
create policy "authenticated read transactions"
on public.transactions for select to authenticated using (true);

drop policy if exists "authenticated read upload_sessions" on public.upload_sessions;
create policy "authenticated read upload_sessions"
on public.upload_sessions for select to authenticated using (true);

drop policy if exists "authenticated read upload_stock_session" on public.upload_stock_session;
create policy "authenticated read upload_stock_session"
on public.upload_stock_session for select to authenticated using (true);

drop policy if exists "authenticated read user_states" on public.user_states;
create policy "authenticated read user_states"
on public.user_states for select to authenticated using (true);

drop policy if exists "authenticated read users" on public.users;
create policy "authenticated read users"
on public.users for select to authenticated using (true);

drop policy if exists "authenticated read users_profile" on public.users_profile;
create policy "authenticated read users_profile"
on public.users_profile for select to authenticated using (true);

drop policy if exists "authenticated read voucher_claims" on public.voucher_claims;
create policy "authenticated read voucher_claims"
on public.voucher_claims for select to authenticated using (true);

drop policy if exists "authenticated read vouchers" on public.vouchers;
create policy "authenticated read vouchers"
on public.vouchers for select to authenticated using (true);

-- ------------------------------------------------------------
-- View: make products_sorted run as invoker to honor caller permissions.
-- ------------------------------------------------------------
alter view public.products_sorted set (security_invoker = true);

-- ------------------------------------------------------------
-- RPC grants: block direct browser/API execution. Edge Functions use service_role.
-- ------------------------------------------------------------
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
grant execute on all functions in schema public to service_role;

-- ------------------------------------------------------------
-- Function hardening: lock search_path to avoid mutable search_path warnings.
-- ------------------------------------------------------------
alter function public.admin_add_balance(bigint, bigint, bigint) set search_path = public, pg_temp;
alter function public.admin_reduce_balance(bigint, bigint, bigint) set search_path = public, pg_temp;
alter function public.approve_deposit_atomic(uuid, bigint, text) set search_path = public, pg_temp;
alter function public.approve_pending_order(uuid, bigint) set search_path = public, pg_temp;
alter function public.buy_product_with_balance(bigint, uuid, integer) set search_path = public, pg_temp;
alter function public.buy_product_with_balance_backup(bigint, uuid, integer) set search_path = public, pg_temp;
alter function public.cancel_deposit_atomic(uuid, bigint) set search_path = public, pg_temp;
alter function public.cancel_order_atomic(uuid, bigint) set search_path = public, pg_temp;
alter function public.check_account_upload_status(uuid, text, text) set search_path = public, pg_temp;
alter function public.claim_daily_checkin(bigint, bigint) set search_path = public, pg_temp;
alter function public.claim_voucher_by_code(bigint, text) set search_path = public, pg_temp;
alter function public.confirm_deposit_atomic(uuid, bigint) set search_path = public, pg_temp;
alter function public.confirm_order_atomic(uuid, bigint) set search_path = public, pg_temp;
alter function public.get_product_detail_for_bot(uuid, uuid) set search_path = public, pg_temp;
alter function public.get_products_with_stock(integer, integer) set search_path = public, pg_temp;
alter function public.get_stock_products(integer, integer) set search_path = public, pg_temp;
alter function public.get_user_dashboard_summary(bigint) set search_path = public, pg_temp;
alter function public.get_user_loyalty_discount(bigint) set search_path = public, pg_temp;
alter function public.get_user_loyalty_summary(bigint) set search_path = public, pg_temp;
alter function public.insert_product_stock(uuid, text, text, text, text) set search_path = public, pg_temp;
alter function public.reject_deposit_atomic(uuid, bigint) set search_path = public, pg_temp;
alter function public.reject_order_atomic(uuid, bigint) set search_path = public, pg_temp;
alter function public.take_available_account(uuid) set search_path = public, pg_temp;

commit;
