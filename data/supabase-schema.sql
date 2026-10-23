-- Builder: leaderboard table + security rules
-- Run this once in Supabase SQL Editor

-- RLS policies alone are not enough — Postgres also requires base table
-- privileges granted to the "anon" role. Needed if "Automatically expose
-- new tables" was unchecked during project setup (it also skips auto-grants).
grant usage on schema public to anon;

create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  score integer not null check (score >= 0 and score <= 1000000),
  created_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

-- Anyone can submit a score — this is a fun leaderboard with no cash prizes,
-- so there's no server-side verification of the actual quiz run. A bounded
-- check constraint (0–1,000,000, matching the ladder's top rung) is a soft
-- deterrent, not fraud-proofing.
create policy "anyone can submit a score"
  on public.leaderboard
  for insert
  to anon
  with check (true);

-- Leaderboard is public — anyone can read all scores
create policy "anyone can view the leaderboard"
  on public.leaderboard
  for select
  to anon
  using (true);

grant insert, select on public.leaderboard to anon;

-- No update/delete policies for anon = both denied by default (RLS default-deny)


-- ------------------------------------------------------------------
-- Legacy: the builder-profile "people" table is no longer used by the
-- site (the directory/join features were removed). If you want to clean
-- up the old data, run this manually — it's commented out on purpose:
--
-- drop table if exists public.people;
-- ------------------------------------------------------------------
