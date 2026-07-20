-- Keep transaction history readable even if old stock rows are later purged.
update public.sold_accounts sa
set account_snapshot = jsonb_strip_nulls(
  coalesce(sa.account_snapshot, '{}'::jsonb)
  || jsonb_build_object(
    'email', pa.email,
    'password', pa.password,
    'pin', pa.pin,
    'profile', pa.profile,
    'sold_at', pa.sold_at
  )
)
from public.transactions t
join public.product_accounts pa on pa.id = t.account_id
where sa.transaction_id = t.id
  and (
    sa.account_snapshot is null
    or not (sa.account_snapshot ? 'email')
    or not (sa.account_snapshot ? 'password')
    or not (sa.account_snapshot ? 'pin')
    or not (sa.account_snapshot ? 'profile')
    or not (sa.account_snapshot ? 'sold_at')
  );
