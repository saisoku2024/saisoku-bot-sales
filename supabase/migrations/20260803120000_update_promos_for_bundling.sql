-- Migration: Update Promos for Multi-Product Bundling
begin;

-- 1. Create promo_items table
create table if not exists public.promo_items (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid references public.promos(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  qty integer default 1,
  created_at timestamp with time zone default now()
);

-- Enable RLS and permissions
alter table public.promo_items enable row level security;
create policy "Allow read access to authenticated users" on public.promo_items
  for select using (auth.role() = 'authenticated');
create policy "Allow all access to service role" on public.promo_items
  using (true) with check (true);

-- 2. Make product_id column in promos nullable
alter table public.promos alter column product_id drop not null;

-- 3. Recreate create_promo_campaign function to support multiple products via JSONB array
create or replace function public.create_promo_campaign(
  p_name text,
  p_description text,
  p_price integer,
  p_allocated_qty integer,
  p_items jsonb, -- array of { product_id: uuid, qty: integer }
  p_end_at timestamp with time zone default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_promo_id uuid;
  v_item json;
  v_product_id uuid;
  v_qty integer;
  v_actual_allocated integer;
  v_required_qty integer;
  v_product_name text;
begin
  -- 1. Insert into promos
  insert into public.promos (
    name, description, price, product_id, allocated_qty, end_at, is_active
  ) values (
    p_name, p_description, p_price, null, p_allocated_qty, p_end_at, true
  ) returning id into v_promo_id;

  -- 2. Loop through bundling items
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    v_required_qty := p_allocated_qty * v_qty;

    -- Fetch product name for error logging
    select name into v_product_name from public.products where id = v_product_id;

    -- Insert into promo_items
    insert into public.promo_items (promo_id, product_id, qty)
    values (v_promo_id, v_product_id, v_qty);

    -- Allocate available accounts by assigning promo_id
    with target_accounts as (
      select id
      from public.product_accounts
      where product_id = v_product_id
        and status = 'available'
        and promo_id is null
      order by created_at asc
      limit v_required_qty
      for update
    )
    update public.product_accounts pa
    set promo_id = v_promo_id
    from target_accounts ta
    where pa.id = ta.id;

    get diagnostics v_actual_allocated = row_count;

    -- Verify if enough accounts were allocated
    if v_actual_allocated < v_required_qty then
      raise exception 'Stok untuk produk "%" tidak mencukupi. Tersedia: %, yang diminta: %', v_product_name, v_actual_allocated, v_required_qty;
    end if;
  end loop;

  return v_promo_id;
end;
$function$;

-- Apply security alterations
alter function public.create_promo_campaign(text, text, integer, integer, jsonb, timestamp with time zone) set search_path = public, pg_temp;

commit;
