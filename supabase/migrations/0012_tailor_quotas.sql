-- ──────────────────────────────────────────────────────────────────────────
-- GO CANDID8 - per-user tailor quotas
-- ──────────────────────────────────────────────────────────────────────────
-- Early access gives each person 5 tailored resumes and 5 cover letters per
-- day. Resumes and cover letters are counted separately, so free_tailor_log
-- rows carry a `kind`, and the owner can raise or lower one person's daily
-- allowance from the admin panel via profiles.tailor_limit (null = default).
--
-- The server also applies this on demand (ensureQuotaSchema in
-- server/src/routes/free-tailor.ts) so a deploy that missed this migration
-- still enforces quotas correctly.

alter table public.free_tailor_log
  add column if not exists kind text not null default 'tailor';

create index if not exists idx_free_tailor_log_user_kind_day
  on public.free_tailor_log (user_id, kind, created_at desc);

alter table public.profiles
  add column if not exists tailor_limit integer;
