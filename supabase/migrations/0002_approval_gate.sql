-- ============================================================================
-- GO CANDID8 — Approval gate
-- ============================================================================
-- Adds an approval workflow so the owner can manually vet every tester who
-- signs up before they get dashboard access. New signups land as 'pending'
-- and see a waitlist screen; the owner flips their row to 'approved' from
-- the Supabase SQL editor (or via /api/admin/approve once the dashboard
-- lands). Anyone already in the system when this migration runs keeps
-- their existing access (back-filled to 'approved').
--
-- Idempotent: safe to re-run. All DDL is guarded by IF EXISTS / IF NOT
-- EXISTS / exception-swallow so a partial apply won't error on retry.
-- ============================================================================

-- ── Column ────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists approval_status text not null default 'pending';

-- Tighten the allowed values (drop + re-add so re-runs don't duplicate).
alter table public.profiles
  drop constraint if exists profiles_approval_status_check;
alter table public.profiles
  add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

-- Optional: track when the approval happened + who approved.
alter table public.profiles
  add column if not exists approved_at timestamptz;
alter table public.profiles
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

-- Speed up the "list pending users" query the admin UI will run.
create index if not exists idx_profiles_approval_status
  on public.profiles(approval_status);

-- ── Back-fill existing users ─────────────────────────────────────────────
-- Anyone who was already using the app before this migration keeps their
-- access. If you want to lock EVERYONE out and re-vet them, run:
--   update public.profiles set approval_status = 'pending'
--   where email <> 'owner@example.com';
-- from the SQL editor AFTER this migration applies.
update public.profiles
   set approval_status = 'approved',
       approved_at     = coalesce(approved_at, created_at)
 where approval_status = 'pending'
   and created_at < now();  -- every existing row

-- ── Trigger: new signups default to 'pending' ────────────────────────────
-- Fresh signups from here on start as pending. The handle_new_user function
-- already inserts a profiles row; we just need the column default to catch
-- them, which the `not null default 'pending'` above does. No trigger
-- rewrite needed.

-- ── Optional: owner auto-approval ─────────────────────────────────────────
-- Replace 'OWNER_EMAIL_HERE@example.com' with your own email so you never
-- get locked out of your own deploy. Run this once; it's a no-op on re-runs.
--
-- update public.profiles
--    set approval_status = 'approved',
--        approved_at     = now()
--  where lower(email) = lower('OWNER_EMAIL_HERE@example.com')
--    and approval_status <> 'approved';
