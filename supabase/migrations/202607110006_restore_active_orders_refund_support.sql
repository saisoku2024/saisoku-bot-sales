-- Restore support tables/columns required by Telegram active orders,
-- warranty ticket flow, search sessions, and refund calculator.

alter table if exists public.tickets
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

alter table if exists public.transactions
  add column if not exists expired_at timestamp with time zone,
  add column if not exists expiry_notified boolean default false;

alter table if exists public.products
  add column if not exists duration_days integer default 30;

alter table if exists public.sold_accounts
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null,
  add column if not exists warranty_claim_count integer not null default 0,
  add column if not exists warranty_last_claim_at timestamp with time zone;

do $$
begin
  if to_regclass('public.sold_accounts') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'sold_accounts_transaction_id_fkey'
        and conrelid = 'public.sold_accounts'::regclass
    ) then
      alter table public.sold_accounts
        add constraint sold_accounts_transaction_id_fkey
        foreign key (transaction_id) references public.transactions(id) on delete set null;
    end if;
  end if;
end $$;

create table if not exists public.ticket_sessions (
  telegram_id bigint primary key,
  created_at timestamp with time zone default now()
);

create table if not exists public.search_sessions (
  telegram_id bigint primary key,
  created_at timestamp with time zone default now()
);

create table if not exists public.warranty_sessions (
  telegram_id bigint primary key,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  photo_file_id text,
  step text not null,
  created_at timestamp with time zone default now()
);

alter table public.ticket_sessions enable row level security;
alter table public.search_sessions enable row level security;
alter table public.warranty_sessions enable row level security;

grant all on table public.ticket_sessions to service_role;
grant all on table public.search_sessions to service_role;
grant all on table public.warranty_sessions to service_role;
grant select on table public.ticket_sessions to authenticated;
grant select on table public.search_sessions to authenticated;
grant select on table public.warranty_sessions to authenticated;

create or replace function public.check_and_notify_expired_subscriptions()
returns table(target_telegram_id bigint, out_invoice text, out_product_name text)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query
  update transactions t
  set expiry_notified = true
  from products p, users u
  where t.product_id = p.id
    and t.user_id = u.id
    and t.status = 'paid'
    and t.expired_at <= now()
    and coalesce(t.expiry_notified, false) = false
  returning u.telegram_id, t.invoice, p.name;
end;
$$;

grant execute on function public.check_and_notify_expired_subscriptions() to service_role;
