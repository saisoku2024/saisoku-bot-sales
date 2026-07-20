begin;

alter table public.products
  add column if not exists is_promo_active boolean not null default false,
  add column if not exists promo_price_reguler numeric,
  add column if not exists promo_price_reseller numeric,
  add column if not exists promo_label text;

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
  promo_price_reguler numeric,
  promo_price_reseller numeric,
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
    coalesce(p.promo_price_reguler, 0)::numeric as promo_price_reguler,
    coalesce(p.promo_price_reseller, 0)::numeric as promo_price_reseller,
    case
      when coalesce(p.is_promo_active, false) = true
        and coalesce(u.role, 'reguler') = 'reseller'
        and coalesce(p.promo_price_reseller, 0) > 0
        then coalesce(p.promo_price_reseller, 0)::numeric
      when coalesce(p.is_promo_active, false) = true
        and coalesce(u.role, 'reguler') = 'reseller'
        and coalesce(p.promo_price_reguler, 0) > 0
        then coalesce(p.promo_price_reguler, 0)::numeric
      when coalesce(p.is_promo_active, false) = true
        and coalesce(p.promo_price_reguler, 0) > 0
        then coalesce(p.promo_price_reguler, 0)::numeric
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
    p.promo_price_reguler,
    p.promo_price_reseller,
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
  with user_role as (
    select coalesce(role, 'reguler') as role
    from public.users
    where id = p_user_id
  )
  select
    p.id as product_id,
    p.name as product_name,
    p.product_code,
    p.promo_label,
    case
      when ur.role = 'reseller' and coalesce(p.promo_price_reseller, 0) > 0
        then coalesce(p.promo_price_reseller, 0)::numeric
      when coalesce(p.promo_price_reguler, 0) > 0
        then coalesce(p.promo_price_reguler, 0)::numeric
      when ur.role = 'reseller'
        then greatest(coalesce(p.price_normal, 0) - coalesce(p.reseller_discount, 0), 0)::numeric
      else coalesce(p.price_normal, 0)::numeric
    end as final_price,
    count(pa.id) filter (where pa.status = 'available') as stock_count
  from public.products p
  cross join user_role ur
  left join public.product_accounts pa on pa.product_id = p.id
  where coalesce(p.is_active, true) = true
    and coalesce(p.is_promo_active, false) = true
  group by
    p.id,
    p.name,
    p.product_code,
    p.promo_label,
    p.price_normal,
    p.reseller_discount,
    p.promo_price_reguler,
    p.promo_price_reseller,
    ur.role
  having count(pa.id) filter (where pa.status = 'available') > 0
  order by p.name asc;
$$;

revoke all on function public.get_product_detail_for_bot(uuid, uuid) from public;
revoke all on function public.get_active_promos_for_bot(uuid) from public;
revoke all on function public.get_product_detail_for_bot(uuid, uuid) from anon;
revoke all on function public.get_active_promos_for_bot(uuid) from anon;
grant execute on function public.get_product_detail_for_bot(uuid, uuid) to service_role;
grant execute on function public.get_active_promos_for_bot(uuid) to service_role;

commit;
