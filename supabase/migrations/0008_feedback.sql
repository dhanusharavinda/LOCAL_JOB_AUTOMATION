-- ============================================================================
-- GO CANDID8 - feedback capture
-- ============================================================================
-- Server-side store for bug reports / feature requests / general feedback sent
-- from the floating "Contact" button. Previously feedback only opened a
-- mailto: link, so delivery was unreliable and nothing was recorded. This
-- table captures every submission so it's never lost, and the endpoint can
-- return a real confirmation to the user.
--
-- Written only by the server (service role) via POST /api/feedback. RLS is on
-- with no policy, so direct client/anon access is denied; the superuser
-- server connection bypasses RLS to insert. Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.feedback (
  id          bigserial primary key,
  user_id     uuid,               -- optional; the button is available anonymously
  email       text,               -- optional contact address
  category    text,               -- 'bug' | 'feature' | 'general'
  message     text not null,
  page        text,               -- where it was sent from (path)
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;

create index if not exists idx_feedback_created_at on public.feedback(created_at desc);
