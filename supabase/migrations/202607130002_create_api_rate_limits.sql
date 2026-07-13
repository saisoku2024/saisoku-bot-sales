create table if not exists public.api_rate_limits (
  key text primary key,
  scope text not null,
  actor text not null,
  count integer not null default 1,
  window_start timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limits_scope_idx
  on public.api_rate_limits (scope);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits (updated_at desc);

alter table public.api_rate_limits enable row level security;

grant all on table public.api_rate_limits to service_role;
