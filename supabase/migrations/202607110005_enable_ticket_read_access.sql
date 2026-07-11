-- Allow authenticated dashboard users to read support ticket history.
-- Writes remain handled by server-side API routes/service role.

alter table if exists public.tickets enable row level security;
alter table if exists public.ticket_replies enable row level security;

do $$
begin
  if to_regclass('public.tickets') is not null then
    execute 'drop policy if exists "authenticated read tickets" on public.tickets';
    execute 'create policy "authenticated read tickets" on public.tickets for select to authenticated using (true)';
    execute 'revoke all on table public.tickets from public';
    execute 'grant select on table public.tickets to authenticated';
    execute 'grant all on table public.tickets to service_role';
  end if;

  if to_regclass('public.ticket_replies') is not null then
    execute 'drop policy if exists "authenticated read ticket_replies" on public.ticket_replies';
    execute 'create policy "authenticated read ticket_replies" on public.ticket_replies for select to authenticated using (true)';
    execute 'revoke all on table public.ticket_replies from public';
    execute 'grant select on table public.ticket_replies to authenticated';
    execute 'grant all on table public.ticket_replies to service_role';
  end if;
end $$;
