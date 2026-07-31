-- ========================================================
-- REPLACEMENT & AUDIT MIGRATION FOR APPROVE_PENDING_ORDER
-- ========================================================

DROP FUNCTION IF EXISTS public.approve_pending_order(UUID, BIGINT);

CREATE OR REPLACE FUNCTION public.approve_pending_order(
    p_order_id UUID,
    p_actor_telegram_id BIGINT
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    order_id UUID,
    transaction_id UUID,
    user_id UUID,
    product_id UUID,
    qty INT,
    unit_price NUMERIC,
    total_price NUMERIC,
    out_telegram_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_account RECORD;
    v_trx_id UUID;
    v_sold_id UUID;
    v_actor_role TEXT;
    v_formatted_trx_code TEXT;
    v_date_key TEXT;
    v_today_start TIMESTAMPTZ;
    v_daily_seq INT;
BEGIN
    -- 1. Check actor role in users table (Allow 'admin', 'owner', or OWNER_TELEGRAM_ID 72246533 / 6038163311)
    SELECT role INTO v_actor_role FROM public.users WHERE telegram_id = p_actor_telegram_id;
    
    IF v_actor_role NOT IN ('admin', 'owner') AND p_actor_telegram_id NOT IN (72246533, 6038163311) THEN
        RETURN QUERY SELECT FALSE, 'Akses ditolak: Hanya admin atau owner yang dapat melakukan approval.'::TEXT,
                            p_order_id, NULL::UUID, NULL::UUID, NULL::UUID, 0, 0::NUMERIC, 0::NUMERIC, p_actor_telegram_id;
        RETURN;
    END IF;

    -- 2. Fetch pending order
    SELECT * INTO v_order FROM public.pending_orders WHERE id = p_order_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Order tidak ditemukan.'::TEXT,
                            p_order_id, NULL::UUID, NULL::UUID, NULL::UUID, 0, 0::NUMERIC, 0::NUMERIC, p_actor_telegram_id;
        RETURN;
    END IF;

    IF v_order.status = 'approved' AND EXISTS (SELECT 1 FROM public.transactions WHERE invoice LIKE p_order_id::TEXT || '%') THEN
        RETURN QUERY SELECT FALSE, 'Order ini sudah di-approve sebelumnya.'::TEXT,
                            p_order_id, NULL::UUID, v_order.user_id, v_order.product_id, v_order.qty, v_order.unit_price, v_order.total_price, v_order.telegram_id;
        RETURN;
    END IF;

    -- 3. Lock and find available account from stock
    SELECT * INTO v_account 
    FROM public.product_accounts 
    WHERE product_id = v_order.product_id AND status = 'available'
    ORDER BY created_at ASC 
    LIMIT 1 
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Mark pending_order status as approved waiting restock
        UPDATE public.pending_orders SET status = 'approved', approved_at = NOW(), approved_by = v_order.user_id WHERE id = p_order_id;
        
        RETURN QUERY SELECT FALSE, 'Stok produk habis! Order ditandai sebagai Pending Delivery/Restock.'::TEXT,
                            p_order_id, NULL::UUID, v_order.user_id, v_order.product_id, v_order.qty, v_order.unit_price, v_order.total_price, v_order.telegram_id;
        RETURN;
    END IF;

    -- 4. Mark account as sold
    UPDATE public.product_accounts
    SET status = 'sold',
        sold_to = v_order.telegram_id::TEXT,
        sold_at = NOW()
    WHERE id = v_account.id;

    -- 5. Calculate daily order sequence
    v_date_key := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD');
    v_today_start := date_trunc('day', NOW() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
    
    SELECT COUNT(*) + 1 INTO v_daily_seq
    FROM public.transactions
    WHERE created_at >= v_today_start;

    v_formatted_trx_code := 'SSID-' || v_date_key || '-' || lpad(v_daily_seq::TEXT, 6, '0');

    -- 6. Insert transaction
    INSERT INTO public.transactions (
        trx_code,
        user_id,
        product_id,
        price,
        payment_method,
        status,
        account_id,
        invoice,
        purchased_at,
        approved_at,
        created_at
    ) VALUES (
        v_formatted_trx_code,
        v_order.user_id,
        v_order.product_id,
        v_order.unit_price,
        COALESCE(v_order.payment_method, 'manual'),
        'paid',
        v_account.id,
        p_order_id::TEXT || '-' || substring(v_account.id::TEXT from 1 for 8),
        NOW(),
        NOW(),
        NOW()
    ) RETURNING id INTO v_trx_id;

    -- 7. Insert sold_accounts snapshot with full credentials
    INSERT INTO public.sold_accounts (
        user_id,
        product_id,
        transaction_id,
        account_id,
        account_snapshot,
        warranty_claim_count,
        created_at
    ) VALUES (
        v_order.user_id,
        v_order.product_id,
        v_trx_id,
        v_account.id,
        jsonb_build_object(
            'email', v_account.email,
            'password', v_account.password,
            'profile', v_account.profile,
            'pin', v_account.pin,
            'sold_at', NOW()
        ),
        0,
        NOW()
    ) RETURNING id INTO v_sold_id;

    -- 8. Update pending_orders status to approved
    UPDATE public.pending_orders 
    SET status = 'approved',
        approved_at = NOW()
    WHERE id = p_order_id;

    RETURN QUERY SELECT TRUE, 'Approval order berhasil.'::TEXT,
                        p_order_id, v_trx_id, v_order.user_id, v_order.product_id, v_order.qty, v_order.unit_price, v_order.total_price, v_order.telegram_id;
END;
$$;
