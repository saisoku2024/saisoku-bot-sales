-- SAISOKU follow-up security hardening
-- Covers objects used by the Telegram bot but missed by the first baseline.

begin;

-- qty_sessions is used by the bot for temporary custom quantity input.
-- Keep it service-role writable and, if the table exists, expose only read access
-- to authenticated users to match the current read-only admin panel policy.
alter table if exists public.qty_sessions enable row level security;

do $$
begin
  if to_regclass('public.qty_sessions') is not null then
    execute 'drop policy if exists "authenticated read qty_sessions" on public.qty_sessions';
    execute 'create policy "authenticated read qty_sessions" on public.qty_sessions for select to authenticated using (true)';

    execute 'revoke all on table public.qty_sessions from public';
    execute 'revoke all on table public.qty_sessions from anon';
    execute 'revoke all on table public.qty_sessions from authenticated';

    execute 'grant select on table public.qty_sessions to authenticated';
    execute 'grant all on table public.qty_sessions to service_role';
  end if;
end
$$;

-- delete_order_atomic is called by the Telegram bot. Lock search_path for every
-- overload/signature in public without assuming the exact deployed arguments.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'delete_order_atomic'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end loop;
end
$$;

commit;
