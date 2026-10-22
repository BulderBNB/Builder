-- Builder directory: people table + security rules
-- Run this once in Supabase SQL Editor

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  city text not null,
  roles text[] not null default '{}',
  bio text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.people enable row level security;

-- Anyone can submit a profile, but it always starts as "pending"
-- (can't self-approve by sending status=approved in the request)
create policy "anyone can submit a profile"
  on public.people
  for insert
  to anon
  with check (status = 'pending');

-- Anyone can read only approved profiles — pending submissions stay private
-- until reviewed in the Table Editor
create policy "anyone can view approved profiles"
  on public.people
  for select
  to anon
  using (status = 'approved');

-- No update/delete policies for anon = both denied by default (RLS default-deny)

-- RLS policies alone are not enough — Postgres also requires base table
-- privileges granted to the "anon" role. Needed if "Automatically expose
-- new tables" was unchecked during project setup (it also skips auto-grants).
grant usage on schema public to anon;
grant insert, select on public.people to anon;
