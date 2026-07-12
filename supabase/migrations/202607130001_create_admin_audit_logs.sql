create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_email text,
  admin_role text check (admin_role in ('owner', 'admin')),
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  status text not null default 'success' check (status in ('success', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_entity_idx
  on public.admin_audit_logs (entity, entity_id);

create index if not exists admin_audit_logs_admin_email_idx
  on public.admin_audit_logs (admin_email);

alter table public.admin_audit_logs enable row level security;

drop policy if exists "Admin audit logs readable by active admins" on public.admin_audit_logs;
create policy "Admin audit logs readable by active admins"
  on public.admin_audit_logs
  for select
  using (
    exists (
      select 1
      from public.admin_profiles ap
      where ap.auth_user_id = auth.uid()
        and ap.is_active = true
        and ap.role in ('owner', 'admin')
    )
  );
