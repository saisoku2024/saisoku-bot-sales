-- Migration: Atomic Warranty Account Replacement RPC
-- Resolves HIGH vulnerability where account replacement operations were non-atomic and un-checked across multiple queries

begin;

create or replace function public.replace_warranty_account_atomic(
  p_ticket_id uuid,
  p_admin_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_ticket record;
  v_trx record;
  v_user_telegram_id text;
  v_available_acc record;
  v_sold_acc record;
  v_new_snapshot jsonb;
  v_new_claim_count int;
begin
  -- 1. Lock and fetch ticket
  select t.*, u.telegram_id as user_telegram_id
  into v_ticket
  from public.tickets t
  left join public.users u on u.id = t.user_id
  where t.id = p_ticket_id
  for update of t;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Tiket tidak ditemukan');
  end if;

  if v_ticket.transaction_id is null then
    return jsonb_build_object('success', false, 'error', 'Tiket ini tidak terasosiasi dengan transaksi order');
  end if;

  -- 2. Lock and fetch transaction
  select tr.*
  into v_trx
  from public.transactions tr
  where tr.id = v_ticket.transaction_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Transaksi order tidak ditemukan');
  end if;

  -- 3. Find & lock available replacement account from stock
  select pa.id, pa.email, pa.password, pa.pin, pa.profile
  into v_available_acc
  from public.product_accounts pa
  where pa.product_id = v_trx.product_id
    and pa.status = 'available'
  order by pa.created_at asc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stok pengganti habis! Silakan restock produk ini terlebih dahulu.');
  end if;

  -- 4. Mark replacement account as sold
  update public.product_accounts
  set status = 'sold',
      sold_at = now()
  where id = v_available_acc.id;

  -- 5. Update sold_accounts
  v_new_snapshot := jsonb_build_object(
    'email', v_available_acc.email,
    'password', v_available_acc.password,
    'pin', v_available_acc.pin,
    'profile', v_available_acc.profile
  );

  select * into v_sold_acc
  from public.sold_accounts
  where transaction_id = v_trx.id
  for update;

  if found then
    v_new_claim_count := coalesce(v_sold_acc.warranty_claim_count, 0) + 1;
    update public.sold_accounts
    set account_id = v_available_acc.id,
        account_snapshot = v_new_snapshot,
        warranty_claim_count = v_new_claim_count,
        warranty_last_claim_at = now()
    where id = v_sold_acc.id;
  else
    v_new_claim_count := 1;
    insert into public.sold_accounts (
      transaction_id,
      user_id,
      product_id,
      account_id,
      account_snapshot,
      warranty_claim_count,
      warranty_last_claim_at
    ) values (
      v_trx.id,
      v_trx.user_id,
      v_trx.product_id,
      v_available_acc.id,
      v_new_snapshot,
      1,
      now()
    );
  end if;

  -- 6. Update ticket status to resolved
  update public.tickets
  set status = 'resolved',
      resolved_at = now(),
      feedback = 'Akun pengganti dikirim otomatis oleh ' || p_admin_email
  where id = p_ticket_id;

  -- 7. Insert ticket reply
  insert into public.ticket_replies (
    ticket_id,
    sender,
    message
  ) values (
    p_ticket_id,
    'admin',
    'Permintaan garansi telah diproses dan akun pengganti baru telah dialokasikan.'
  );

  return jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'telegram_id', v_ticket.user_telegram_id,
    'replacement', v_new_snapshot,
    'claim_count', v_new_claim_count
  );
end;
$$;

revoke all on function public.replace_warranty_account_atomic(uuid, text) from public;
revoke all on function public.replace_warranty_account_atomic(uuid, text) from anon;
grant execute on function public.replace_warranty_account_atomic(uuid, text) to authenticated;
grant execute on function public.replace_warranty_account_atomic(uuid, text) to service_role;

commit;
