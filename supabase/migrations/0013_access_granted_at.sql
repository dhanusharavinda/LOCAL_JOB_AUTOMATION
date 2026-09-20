-- ──────────────────────────────────────────────────────────────────────────
-- Tailorly AI - explicit access grants
-- ──────────────────────────────────────────────────────────────────────────
-- Access used to be decided by profiles.approval_status alone. Migration
-- 0002 back-filled every account that existed at the time to 'approved',
-- so any of those accounts could reset its password and get straight in
-- without ever holding an invite.
--
-- access_granted_at is set ONLY when someone redeems an invite link or an
-- admin approves them. Null means no access regardless of what
-- approval_status says, so every legacy account is locked out until it is
-- granted deliberately.
--
-- Deliberately NOT back-filled: leaving it null is the whole point.
-- The server also adds this column on demand (ensureInviteSchema in
-- server/src/access.ts).

alter table public.profiles
  add column if not exists access_granted_at timestamptz;

comment on column public.profiles.access_granted_at is
  'When access was deliberately granted (invite redeemed or admin approval). Null = no access.';
