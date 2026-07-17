begin;

create table if not exists public.admin_access_logs (
  id uuid primary key default gen_random_uuid(),
  admin_email text,
  admin_role text,
  event_type text not null,
  path text,
  ip_address text,
  city text,
  region text,
  country text,
  latitude text,
  longitude text,
  user_agent text,
  referrer text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_access_logs_created_at_idx on public.admin_access_logs (created_at desc);
create index if not exists admin_access_logs_admin_email_idx on public.admin_access_logs (admin_email);
create index if not exists admin_access_logs_event_type_idx on public.admin_access_logs (event_type);
create index if not exists admin_access_logs_ip_address_idx on public.admin_access_logs (ip_address);

alter table public.admin_access_logs enable row level security;

revoke insert, update, delete on table public.admin_access_logs from anon;
revoke insert, update, delete on table public.admin_access_logs from authenticated;
grant all on table public.admin_access_logs to service_role;

commit;
