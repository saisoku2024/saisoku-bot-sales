begin;

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  level text not null default 'error',
  message text not null,
  stack text,
  route text,
  actor text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);
create index if not exists error_logs_source_idx on public.error_logs (source);
create index if not exists error_logs_level_idx on public.error_logs (level);

alter table public.error_logs enable row level security;

revoke insert, update, delete on table public.error_logs from anon;
revoke insert, update, delete on table public.error_logs from authenticated;
grant all on table public.error_logs to service_role;

commit;
