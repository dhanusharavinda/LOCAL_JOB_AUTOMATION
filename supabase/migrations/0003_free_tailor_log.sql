-- ============================================================================
-- GO CANDID8 — free_tailor_log
-- ============================================================================
-- The /api/free-tailor route used to create this table lazily at first use
-- (see server/src/routes/free-tailor.ts:37-46). That worked for the runtime
-- but broke the admin dashboard's /api/auth/admin/users query, which joins
-- against free_tailor_log to surface per-user manual-tailor counts. On a
-- fresh deploy where no tester has clicked Tailor yet, the table doesn't
-- exist and the admin query 500s.
--
-- Create it here so it's always present. The shape matches what the
-- runtime used to create (user_id as TEXT so the runtime's CREATE IF NOT
-- EXISTS stays a no-op and we don't have to migrate existing data).
-- Idempotent.
-- ============================================================================

create table if not exists public.free_tailor_log (
  id          serial primary key,
  user_id     text not null,
  created_at  timestamptz not null default now()
);

-- Admin queries scan WHERE user_id = ... AND created_at >= date_trunc(...),
-- so index on both columns. Speeds up the admin dashboard load when the
-- table has thousands of rows.
create index if not exists idx_free_tailor_log_user
  on public.free_tailor_log(user_id);

create index if not exists idx_free_tailor_log_user_created
  on public.free_tailor_log(user_id, created_at desc);

-- RLS: runtime auth middleware bypasses RLS (server uses the Postgres
-- superuser connection), but we still enable + define a self-only policy
-- as a second line of defence in case any future path uses a per-JWT
-- connection.
alter table public.free_tailor_log enable row level security;
drop policy if exists "free_tailor_log_self_all" on public.free_tailor_log;
create policy "free_tailor_log_self_all" on public.free_tailor_log
  for all using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
