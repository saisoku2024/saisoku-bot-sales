begin;

do $$
declare
  target_table text;
  target_tables text[] := array[
    'users',
    'products',
    'product_accounts',
    'transactions',
    'balance_logs',
    'vouchers',
    'tickets',
    'ticket_replies',
    'admin_audit_logs',
    'api_rate_limits'
  ];
begin
  foreach target_table in array target_tables loop
    execute format('alter table if exists public.%I enable row level security', target_table);
    execute format('revoke insert, update, delete on table public.%I from anon', target_table);
    execute format('revoke insert, update, delete on table public.%I from authenticated', target_table);
    execute format('grant all on table public.%I to service_role', target_table);
  end loop;
end $$;

commit;
