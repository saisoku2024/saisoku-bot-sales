begin;

drop function if exists public.get_products_with_stock(integer, integer);
drop function if exists public.get_product_detail_for_bot(uuid, uuid);

create or replace function public.get_products_with_stock(
  p_page integer default 1,
  p_limit integer default 10
)
returns table (
  id uuid,
  name text,
  product_code text,
  stock bigint,
  total_count bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with visible_products as (
    select
      p.id,
      p.name,
      p.product_code,
      count(pa.id) filter (where pa.status = 'available') as stock
    from public.products p
    left join public.product_accounts pa on pa.product_id = p.id
    where coalesce(p.is_active, true) = true
    group by p.id, p.name, p.product_code
    having count(pa.id) filter (where pa.status = 'available') > 0
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
$$;

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
    coalesce(u.role, 'regular') as user_role,
    coalesce(p.price_normal, 0)::numeric as price_normal,
    coalesce(p.reseller_discount, 0)::numeric as reseller_discount,
    case
      when coalesce(u.role, 'regular') = 'reseller'
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
    u.role;
$$;

revoke all on function public.get_products_with_stock(integer, integer) from public;
revoke all on function public.get_product_detail_for_bot(uuid, uuid) from public;
revoke all on function public.get_products_with_stock(integer, integer) from anon;
revoke all on function public.get_product_detail_for_bot(uuid, uuid) from anon;
grant execute on function public.get_products_with_stock(integer, integer) to service_role;
grant execute on function public.get_product_detail_for_bot(uuid, uuid) to service_role;

commit;
