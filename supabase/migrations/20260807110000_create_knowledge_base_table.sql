-- Create knowledge_base table for AI training data & monitoring
create table if not exists public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'General',
  content text not null,
  tags text[] default '{}',
  source_file text,
  status text not null default 'active',
  created_by text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Index for search and filtering
create index if not exists idx_knowledge_base_category on public.knowledge_base(category);
create index if not exists idx_knowledge_base_created_at on public.knowledge_base(created_at desc);

-- Enable RLS
alter table public.knowledge_base enable row level security;

-- RLS policies
drop policy if exists "authenticated read knowledge_base" on public.knowledge_base;
create policy "authenticated read knowledge_base"
on public.knowledge_base for select to authenticated using (true);

drop policy if exists "authenticated admin write knowledge_base" on public.knowledge_base;
create policy "authenticated admin write knowledge_base"
on public.knowledge_base for all to authenticated using (true) with check (true);
