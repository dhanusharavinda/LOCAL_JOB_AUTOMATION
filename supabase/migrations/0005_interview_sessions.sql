-- ============================================================================
-- GO CANDID8 - interview_sessions
-- ============================================================================
-- AI-powered interview practice. The user picks a job (or pastes a JD +
-- resume + optional fine-tune note for jobs not in their tracker), the
-- server generates 8-12 questions tailored to the role, and the user
-- speaks answers via the browser's Web Speech API. Each turn the model
-- decides "follow-up vs next" using the running rubric, capped at 2
-- follow-ups per question. After the last turn the server runs a final
-- scoring pass with a fixed rubric and persists a readiness score.
--
-- Storage strategy:
--   - questions    : LLM-generated question list, jsonb array
--   - transcript   : conversation turns with timestamps, jsonb array
--   - rubric       : final per-dimension scoring + per-question feedback
--   - metrics      : deterministic counts (filler words, WPM, hedging)
--   - readiness_score: integer 0-100, denormalized onto jobs.interview_readiness_score
--
-- All large fields are jsonb so we keep one row per session and avoid
-- a join on the hot path. Sessions are bounded (12 questions, 20 min)
-- so the row stays well under Postgres' practical jsonb size.
-- ============================================================================

create table if not exists public.interview_sessions (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  job_id          bigint references public.jobs(id) on delete set null,

  -- Optional manual context for jobs not tracked in the dashboard. The
  -- user pastes the JD + resume + a "what should the interviewer focus
  -- on?" note. Mutually exclusive with job_id in the UI but we don't
  -- enforce that at the DB level: power users may want to override
  -- their stored resume for a single practice session.
  manual_jd       text,
  manual_resume_text text,
  fine_tune_focus text,

  mode            text not null check (mode in ('behavioral', 'technical')),
  status          text not null default 'active'
                  check (status in ('active', 'completed', 'abandoned')),

  questions       jsonb not null default '[]'::jsonb,
  transcript      jsonb not null default '[]'::jsonb,
  rubric          jsonb,
  metrics         jsonb,
  readiness_score integer,

  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_interview_sessions_user
  on public.interview_sessions(user_id, started_at desc);
create index if not exists idx_interview_sessions_job
  on public.interview_sessions(job_id)
  where job_id is not null;

alter table public.interview_sessions enable row level security;
drop policy if exists "interview_sessions_self_all" on public.interview_sessions;
create policy "interview_sessions_self_all" on public.interview_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Denormalized readiness score on the jobs row so the kanban card can
-- render the "interview readiness" badge without joining
-- interview_sessions on every dashboard render.
alter table public.jobs
  add column if not exists interview_readiness_score integer;
