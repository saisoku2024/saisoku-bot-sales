-- Phase 1 voucher targeting:
-- keep vouchers as balance/deposit bonus, add role eligibility for reguler/reseller/both.

begin;

alter table public.vouchers
  add column if not exists target_role text not null default 'both';

update public.vouchers
set target_role = 'both'
where target_role is null or target_role = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vouchers_target_role_check'
      and conrelid = 'public.vouchers'::regclass
  ) then
    alter table public.vouchers
      add constraint vouchers_target_role_check
      check (target_role in ('reguler', 'reseller', 'both'));
  end if;
end $$;

grant select on table public.vouchers to authenticated;
grant all on table public.vouchers to service_role;

commit;
