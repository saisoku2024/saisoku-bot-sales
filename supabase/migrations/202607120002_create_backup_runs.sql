-- Track manual and automated SAISOKU backup runs.

begin;

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('critical', 'full')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  triggered_by text,
  storage_bucket text,
  storage_path text,
  tables_count integer not null default 0,
  rows_count integer not null default 0,
  manifest jsonb,
  error text,
  created_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone
);

alter table public.backup_runs enable row level security;

drop policy if exists "authenticated read backup_runs" on public.backup_runs;
create policy "authenticated read backup_runs"
on public.backup_runs for select to authenticated using (true);

grant select on table public.backup_runs to authenticated;
grant all on table public.backup_runs to service_role;

commit;
