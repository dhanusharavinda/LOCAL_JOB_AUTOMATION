-- ──────────────────────────────────────────────────────────────────────────
-- GO CANDID8 - invite links (invite-only launch)
-- ──────────────────────────────────────────────────────────────────────────
-- The owner generates single-use invite links from the admin panel and
-- DMs them to people (e.g. LinkedIn commenters). Opening a link and
-- signing in redeems it: the account is approved and gets free access
-- for `access_days` days (default 30).
--
--   invite_links.token          random, url-safe, single-use
--   invite_links.redeemed_by    who used it (null = still unused)
--   invite_links.revoked_at     set when the owner cancels an unused link
--   profiles.access_expires_at  null = no expiry (admins, legacy testers)
--
-- Access to the table goes through the API server only (service role),
-- so RLS is enabled with no policies: direct client access is denied.
-- The server also creates these on demand (ensureInviteSchema in
-- server/src/access.ts) so a deploy that missed this migration still works.

create table if not exists public.invite_links (
  id           bigserial primary key,
  token        text not null unique,
  label        text,
  access_days  integer not null default 30,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  redeemed_by  uuid references public.profiles(id) on delete set null,
  redeemed_at  timestamptz,
  revoked_at   timestamptz
);

create index if not exists idx_invite_links_created on public.invite_links(created_at desc);

alter table public.invite_links enable row level security;

alter table public.profiles add column if not exists access_expires_at timestamptz;
alter table public.profiles add column if not exists invite_id bigint;
