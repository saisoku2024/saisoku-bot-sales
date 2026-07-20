begin;

alter table public.products
  add column if not exists promo_price numeric;

update public.products
set promo_price = coalesce(promo_price, promo_price_reguler, promo_price_reseller)
where promo_price is null
  and (promo_price_reguler is not null or promo_price_reseller is not null);

drop function if exists public.get_product_detail_for_bot(uuid, uuid);
drop function if exists public.get_active_promos_for_bot(uuid);

create or replace function public.get_product_detail_for_bot(
  p_product_id uuid,
  p_user_id uuid
)
returns table (
  product_id uuid,
  product_name text,
  product_code text,
  description text,
  tos_description text,
  user_role text,
  price_normal numeric,
  reseller_discount numeric,
  is_promo_active boolean,
  promo_price numeric,
  final_price numeric,
  stock_count bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    p.id as product_id,
    p.name as product_name,
    p.product_code,
    p.description,
    p.tos_description,
    coalesce(u.role, 'reguler') as user_role,
    coalesce(p.price_normal, 0)::numeric as price_normal,
    coalesce(p.reseller_discount, 0)::numeric as reseller_discount,
    coalesce(p.is_promo_active, false) as is_promo_active,
    coalesce(p.promo_price, 0)::numeric as promo_price,
    case
      when coalesce(p.is_promo_active, false) = true
        and coalesce(p.promo_price, 0) > 0
        then coalesce(p.promo_price, 0)::numeric
      when coalesce(u.role, 'reguler') = 'reseller'
        then greatest(coalesce(p.price_normal, 0) - coalesce(p.reseller_discount, 0), 0)::numeric
      else coalesce(p.price_normal, 0)::numeric
    end as final_price,
    count(pa.id) filter (where pa.status = 'available') as stock_count
  from public.products p
  left join public.users u on u.id = p_user_id
  left join public.product_accounts pa on pa.product_id = p.id
  where p.id = p_product_id
    and coalesce(p.is_active, true) = true
  group by
    p.id,
    p.name,
    p.product_code,
    p.description,
    p.tos_description,
    p.price_normal,
    p.reseller_discount,
    p.is_promo_active,
    p.promo_price,
    u.role;
$$;

create or replace function public.get_active_promos_for_bot(
  p_user_id uuid
)
returns table (
  product_id uuid,
  product_name text,
  product_code text,
  promo_label text,
  final_price numeric,
  stock_count bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    p.id as product_id,
    p.name as product_name,
    p.product_code,
    p.promo_label,
    coalesce(p.promo_price, 0)::numeric as final_price,
    count(pa.id) filter (where pa.status = 'available') as stock_count
  from public.products p
  left join public.product_accounts pa on pa.product_id = p.id
  where coalesce(p.is_active, true) = true
    and coalesce(p.is_promo_active, false) = true
    and coalesce(p.promo_price, 0) > 0
  group by
    p.id,
    p.name,
    p.product_code,
    p.promo_label,
    p.promo_price
  having count(pa.id) filter (where pa.status = 'available') > 0
  order by p.name asc;
$$;

create or replace function public.buy_product_with_balance(
  p_telegram_id bigint,
  p_product_id uuid,
  p_qty integer
)
returns table (
  success boolean,
  message text,
  user_id uuid,
  product_id uuid,
  qty integer,
  unit_price integer,
  total_price integer,
  old_balance integer,
  new_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_user_role text;
  v_user_balance integer;
  v_user_banned boolean;

  v_product_name text;
  v_product_code text;
  v_price_normal integer;
  v_reseller_discount integer;
  v_product_active boolean;
  v_is_promo_active boolean;
  v_promo_price integer;

  v_unit_price integer;
  v_total_price integer;
  v_new_balance integer;
  v_now timestamptz := now();

  v_account_ids uuid[];
  v_account_count integer;

  v_trx_id uuid;
  v_trx_code text;
  v_account record;
begin
  if p_telegram_id is null or p_telegram_id <= 0 then
    return query select false, 'Telegram ID tidak valid', null::uuid, null::uuid, 0, 0, 0, 0, 0;
    return;
  end if;

  if p_product_id is null then
    return query select false, 'Product ID tidak valid', null::uuid, null::uuid, 0, 0, 0, 0, 0;
    return;
  end if;

  if p_qty is null or p_qty <= 0 then
    return query select false, 'Qty tidak valid', null::uuid, p_product_id, 0, 0, 0, 0, 0;
    return;
  end if;

  select u.id, u.role, coalesce(u.balance, 0), coalesce(u.is_banned, false)
  into v_user_id, v_user_role, v_user_balance, v_user_banned
  from public.users u
  where u.telegram_id = p_telegram_id
  for update;

  if v_user_id is null then
    return query select false, 'User tidak ditemukan', null::uuid, p_product_id, 0, 0, 0, 0, 0;
    return;
  end if;

  if v_user_banned then
    return query select false, 'Akun kamu sedang dibanned', v_user_id, p_product_id, 0, 0, 0, v_user_balance, v_user_balance;
    return;
  end if;

  select
    p.name,
    p.product_code,
    coalesce(p.price_normal, 0),
    coalesce(p.reseller_discount, 0),
    coalesce(p.is_active, true),
    coalesce(p.is_promo_active, false),
    coalesce(p.promo_price, 0)
  into
    v_product_name,
    v_product_code,
    v_price_normal,
    v_reseller_discount,
    v_product_active,
    v_is_promo_active,
    v_promo_price
  from public.products p
  where p.id = p_product_id;

  if v_product_name is null then
    return query select false, 'Produk tidak ditemukan', v_user_id, p_product_id, p_qty, 0, 0, v_user_balance, v_user_balance;
    return;
  end if;

  if not v_product_active then
    return query select false, 'Produk sedang nonaktif', v_user_id, p_product_id, p_qty, 0, 0, v_user_balance, v_user_balance;
    return;
  end if;

  if v_is_promo_active and v_promo_price > 0 then
    v_unit_price := v_promo_price;
  elsif v_user_role = 'reseller' then
    v_unit_price := greatest(v_price_normal - coalesce(v_reseller_discount, 0), 0);
  else
    v_unit_price := v_price_normal;
  end if;

  if v_unit_price <= 0 then
    return query select false, 'Harga produk tidak valid', v_user_id, p_product_id, p_qty, 0, 0, v_user_balance, v_user_balance;
    return;
  end if;

  v_total_price := v_unit_price * p_qty;

  if v_user_balance < v_total_price then
    return query select false, 'Saldo tidak cukup', v_user_id, p_product_id, p_qty, v_unit_price, v_total_price, v_user_balance, v_user_balance;
    return;
  end if;

  with locked_accounts as (
    select pa.id
    from public.product_accounts pa
    where pa.product_id = p_product_id
      and pa.status = 'available'
    order by pa.id asc
    limit p_qty
    for update skip locked
  )
  select array_agg(id), count(*)
  into v_account_ids, v_account_count
  from locked_accounts;

  if coalesce(v_account_count, 0) < p_qty then
    return query select false, 'Stok tidak cukup', v_user_id, p_product_id, p_qty, v_unit_price, v_total_price, v_user_balance, v_user_balance;
    return;
  end if;

  v_new_balance := v_user_balance - v_total_price;

  update public.users
  set balance = v_new_balance
  where id = v_user_id;

  insert into public.balance_logs (
    user_id, amount, type, reference_id, note, created_at, idempotency_key
  )
  values (
    v_user_id,
    v_total_price,
    'purchase',
    null,
    'Pembelian ' || v_product_name || ' x' || p_qty,
    v_now,
    'buy_balance:' || p_telegram_id::text || ':' || p_product_id::text || ':' || v_now::text
  );

  update public.product_accounts
  set status = 'sold',
      sold_at = timezone('UTC', v_now),
      sold_to = p_telegram_id::text
  where id = any(v_account_ids)
    and status = 'available';

  if not found then
    raise exception 'Gagal update stok';
  end if;

  for v_account in
    select *
    from public.product_accounts
    where id = any(v_account_ids)
    order by id asc
  loop
    v_trx_code := 'SALDO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

    insert into public.transactions (
      trx_code, user_id, product_id, price, payment_method, status, account_id, purchased_at, approved_at, created_at, invoice
    )
    values (
      v_trx_code, v_user_id, p_product_id, v_unit_price, 'balance', 'paid', v_account.id, v_now, v_now, v_now, null
    )
    returning id into v_trx_id;

    insert into public.sold_accounts (
      transaction_id, user_id, product_id, account_snapshot, warranty_claim_count, created_at
    )
    values (
      v_trx_id,
      v_user_id,
      p_product_id,
      coalesce(v_account.account_data, '{}'::jsonb) || jsonb_build_object('sold_at', v_now),
      0,
      v_now
    );
  end loop;

  return query select true, 'Pembelian berhasil', v_user_id, p_product_id, p_qty, v_unit_price, v_total_price, v_user_balance, v_new_balance;
end;
$$;

revoke all on function public.get_product_detail_for_bot(uuid, uuid) from public;
revoke all on function public.get_active_promos_for_bot(uuid) from public;
revoke all on function public.buy_product_with_balance(bigint, uuid, integer) from public;
revoke all on function public.get_product_detail_for_bot(uuid, uuid) from anon;
revoke all on function public.get_active_promos_for_bot(uuid) from anon;
revoke all on function public.buy_product_with_balance(bigint, uuid, integer) from anon;
grant execute on function public.get_product_detail_for_bot(uuid, uuid) to service_role;
grant execute on function public.get_active_promos_for_bot(uuid) to service_role;
grant execute on function public.buy_product_with_balance(bigint, uuid, integer) to service_role;

commit;
