-- Migration: Remove hardcoded owner Telegram IDs from approve_pending_order_v2 RPC
-- Resolves HIGH vulnerability where privilege bypasses were hardcoded into RPC logic

begin;

create or replace function public.approve_pending_order_v2(
    p_order_id bigint,
    p_actor_telegram_id bigint
)
returns table(
    success boolean,
    message text,
    order_id bigint,
    user_id uuid,
    product_id uuid,
    sold_account_id uuid,
    claim_count int,
    amount_paid numeric,
    refund_amount numeric,
    actor_telegram_id bigint
) 
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_order record;
    v_account record;
    v_sold_id uuid;
    v_actor_role text;
    v_formatted_trx_code text;
    v_date_key text;
    v_today_start timestamptz;
    v_daily_seq int;
begin
    -- 1. Check actor role in users table (strict role check without hardcoded Telegram IDs)
    select u.role into v_actor_role from public.users u where u.telegram_id = p_actor_telegram_id;
    
    if v_actor_role not in ('admin', 'owner') then
        return query select false, 'Akses ditolak: Hanya admin atau owner yang dapat melakukan approval.'::text,
                            p_order_id, null::uuid, null::uuid, null::uuid, 0, 0::numeric, 0::numeric, p_actor_telegram_id::bigint;
        return;
    end if;

    -- 2. Fetch pending order
    select po.* into v_order from public.pending_orders po where po.id = p_order_id for update;

    if not found then
        return query select false, 'Order tidak ditemukan.'::text,
                            p_order_id, null::uuid, null::uuid, null::uuid, 0, 0::numeric, 0::numeric, p_actor_telegram_id::bigint;
        return;
    end if;

    if v_order.status <> 'pending' then
        return query select false, ('Order sudah diproses dengan status: ' || v_order.status)::text,
                            p_order_id, v_order.user_id, v_order.product_id, null::uuid, 0, v_order.amount, 0::numeric, p_actor_telegram_id::bigint;
        return;
    end if;

    -- 3. Lock and find available account from stock
    select pa.* into v_account 
    from public.product_accounts pa
    where pa.product_id = v_order.product_id and pa.status = 'available'
    order by pa.created_at asc 
    limit 1 
    for update;

    if not found then
        return query select false, 'Stok produk habis! Tidak dapat memproses order.'::text,
                            p_order_id, v_order.user_id, v_order.product_id, null::uuid, 0, v_order.amount, 0::numeric, p_actor_telegram_id::bigint;
        return;
    end if;

    -- 4. Mark account as sold
    update public.product_accounts
    set status = 'sold',
        sold_at = now()
    where id = v_account.id;

    -- 5. Create transaction record with formatted trx_code
    v_date_key := to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD');
    v_today_start := date_trunc('day', now() at time zone 'Asia/Jakarta');

    select coalesce(max(
        case 
            when position('-' in reverse(t.trx_code)) > 0 
            then cast(substring(t.trx_code from length(t.trx_code) - position('-' in reverse(t.trx_code)) + 2) as integer)
            else 0 
        end
    ), 0) + 1
    into v_daily_seq
    from public.transactions t
    where t.created_at >= v_today_start
      and t.trx_code like 'SSID-' || v_date_key || '-%';

    v_formatted_trx_code := 'SSID-' || v_date_key || '-' || lpad(v_daily_seq::text, 4, '0');

    insert into public.transactions (
        user_id,
        product_id,
        amount,
        status,
        trx_code,
        created_at
    ) values (
        v_order.user_id,
        v_order.product_id,
        v_order.amount,
        'completed',
        v_formatted_trx_code,
        now()
    );

    -- 6. Record sold account mapping
    insert into public.sold_accounts (
        transaction_id,
        user_id,
        product_id,
        account_id,
        account_snapshot,
        warranty_claim_count
    ) values (
        currval(pg_get_serial_sequence('public.transactions', 'id')),
        v_order.user_id,
        v_order.product_id,
        v_account.id,
        jsonb_build_object(
            'email', v_account.email,
            'password', v_account.password,
            'pin', v_account.pin,
            'profile', v_account.profile
        ),
        0
    )
    returning id into v_sold_id;

    -- 7. Update pending order status to approved
    update public.pending_orders
    set status = 'approved',
        updated_at = now()
    where id = p_order_id;

    return query select true, 'Order berhasil disetujui dan akun telah dikirim.'::text,
                        p_order_id, v_order.user_id, v_order.product_id, v_sold_id, 0, v_order.amount, 0::numeric, p_actor_telegram_id::bigint;
end;
$$;

commit;
