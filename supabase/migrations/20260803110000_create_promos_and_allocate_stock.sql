-- Migration: Create Promos Table and Stock Allocation Logic
begin;

-- 1. Create promos table
create table if not exists public.promos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price integer not null, -- Harga khusus promo (Rupiah)
  product_id uuid references public.products(id) on delete cascade,
  allocated_qty integer not null, -- Jumlah alokasi awal stok
  start_at timestamp with time zone default now(),
  end_at timestamp with time zone, -- Tanggal berakhir promo
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

-- Enable RLS and permissions
alter table public.promos enable row level security;
create policy "Allow read access to authenticated users" on public.promos
  for select using (auth.role() = 'authenticated');
create policy "Allow all access to service role" on public.promos
  using (true) with check (true);

-- 2. Add promo_id to product_accounts
alter table public.product_accounts add column if not exists promo_id uuid references public.promos(id) on delete set null;
create index if not exists idx_product_accounts_promo_id on public.product_accounts(promo_id);

-- 3. Update take_available_account to ignore promo stock
create or replace function public.take_available_account(product_id_input uuid)
 returns setof product_accounts
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin

return query
update product_accounts
set status='reserved',
reserved_at = now()
where id = (
select id
from product_accounts
where product_id = product_id_input
and status='available'
and promo_id is null -- HANYA ambil stok normal!
limit 1
for update skip locked
)
returning *;

end;
$function$;

-- 4. Create function to take promo account
create or replace function public.take_promo_account(promo_id_input uuid)
 returns setof product_accounts
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin

return query
update product_accounts
set status='reserved',
reserved_at = now()
where id = (
select id
from product_accounts
where promo_id = promo_id_input
and status='available'
limit 1
for update skip locked
)
returning *;

end;
$function$;

-- 5. Update stock queries to ignore promo stock
create or replace function public.get_products_with_stock(p_page integer default 1, p_limit integer default 10)
 returns table(id uuid, name text, product_code text, stock bigint, total_count bigint)
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with visible_products as (
    select
      p.id,
      p.name,
      p.product_code,
      count(pa.id) filter (where pa.status = 'available' and pa.promo_id is null) as stock
    from public.products p
    left join public.product_accounts pa on pa.product_id = p.id
    where coalesce(p.is_active, true) = true
    group by p.id, p.name, p.product_code
    having count(pa.id) filter (where pa.status = 'available' and pa.promo_id is null) > 0
  ),
  counted as (
    select count(*)::bigint as total_count from visible_products
  )
  select
    vp.id,
    vp.name,
    vp.product_code,
    vp.stock,
    counted.total_count
  from visible_products vp
  cross join counted
  order by vp.name asc
  limit greatest(p_limit, 1)
  offset greatest(p_page - 1, 0) * greatest(p_limit, 1);
$function$;

create or replace function public.get_stock_products(p_page integer default 1, p_limit integer default 8)
 returns table(id uuid, name text, stock bigint, total_count bigint)
 language sql
 set search_path to 'public', 'pg_temp'
as $function$
  with stock_summary as (
    select
      p.id,
      p.name,
      count(pa.id)::bigint as stock
    from products p
    left join product_accounts pa
      on pa.product_id = p.id
     and pa.status = 'available'
     and pa.promo_id is null
    where p.is_active = true
    group by p.id, p.name
    having count(pa.id) > 0
  ),
  counted as (
    select
      ss.*,
      count(*) over()::bigint as total_count
    from stock_summary ss
  )
  select *
  from counted
  order by name asc
  limit greatest(p_limit, 1)
  offset greatest((p_page - 1) * p_limit, 0);
$function$;

-- 6. Create RPC function to create promo campaign and allocate stock
create or replace function public.create_promo_campaign(
  p_name text,
  p_description text,
  p_price integer,
  p_product_id uuid,
  p_allocated_qty integer,
  p_end_at timestamp with time zone default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_promo_id uuid;
  v_actual_allocated integer;
begin
  -- 1. Insert into promos
  insert into public.promos (
    name, description, price, product_id, allocated_qty, end_at, is_active
  ) values (
    p_name, p_description, p_price, p_product_id, p_allocated_qty, p_end_at, true
  ) returning id into v_promo_id;

  -- 2. Allocate available accounts by assigning promo_id
  with target_accounts as (
    select id
    from public.product_accounts
    where product_id = p_product_id
      and status = 'available'
      and promo_id is null
    order by created_at asc
    limit p_allocated_qty
    for update
  )
  update public.product_accounts pa
  set promo_id = v_promo_id
  from target_accounts ta
  where pa.id = ta.id;

  get diagnostics v_actual_allocated = row_count;

  -- 3. If the actual allocated is less than requested, raise error to abort
  if v_actual_allocated < p_allocated_qty then
    raise exception 'Stok tidak mencukupi untuk dialokasikan. Stok tersedia: %, yang diminta: %', v_actual_allocated, p_allocated_qty;
  end if;

  return v_promo_id;
end;
$function$;

-- 7. Create function to expire and restore promos
create or replace function public.expire_and_restore_promos()
 returns table(expired_count bigint, restored_stock_count bigint)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_expired_count bigint := 0;
  v_restored_count bigint := 0;
begin
  -- Restore available stock accounts from expired/inactive promos
  with expired_promos as (
    select id from public.promos
    where is_active = true and end_at <= now()
  ),
  restored as (
    update public.product_accounts
    set promo_id = null
    where promo_id in (select id from expired_promos)
      and status = 'available'
    returning id
  )
  select count(*) into v_restored_count from restored;

  -- Mark expired promos as inactive
  with updated as (
    update public.promos
    set is_active = false
    where is_active = true and end_at <= now()
    returning id
  )
  select count(*) into v_expired_count from updated;

  return query select v_expired_count, v_restored_count;
end;
$function$;

-- Apply security alterations
alter function public.take_available_account(uuid) set search_path = public, pg_temp;
alter function public.take_promo_account(uuid) set search_path = public, pg_temp;
alter function public.create_promo_campaign(text, text, integer, uuid, integer, timestamp with time zone) set search_path = public, pg_temp;
alter function public.expire_and_restore_promos() set search_path = public, pg_temp;

commit;
