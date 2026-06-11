-- ============================================================================
-- GO CANDID8 - career_roadmaps (AI Career Coach)
-- ============================================================================
-- One row per user holding the latest AI-generated career roadmap. The
-- coach reads the user's default resume, their scored jobs (match_score +
-- detected_role_type + salary), and the latest skill snapshot, then asks
-- the LLM for a positioning summary, skill gaps, a learning plan, a salary
-- benchmark, and concrete next actions. Stored as the latest snapshot per
-- user (upsert by user_id) so /api/career-coach is a single cheap read.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.career_roadmaps (
  user_id          uuid primary key references public.profiles(id) on delete cascade,

  -- Inferred or stated target role the roadmap is built around.
  role_target      text,

  -- 2-3 sentence positioning summary in the candidate's own framing.
  summary          text,

  -- [{ skill, why, priority }] - JD-driven gaps the candidate should close.
  skill_gaps       jsonb not null default '[]'::jsonb,

  -- [{ title, detail, resource, timeframe }] - the learning plan.
  learning_plan    jsonb not null default '[]'::jsonb,

  -- { role, currency, low, median, high, sample_size, note } - computed in
  -- code from the user's scored jobs, with an LLM note. Null when there is
  -- not enough parseable salary data.
  salary_benchmark jsonb,

  -- ["...", "..."] - the next concrete steps.
  action_items     jsonb not null default '[]'::jsonb,

  generated_at     timestamptz not null default now()
);

alter table public.career_roadmaps enable row level security;
drop policy if exists "career_roadmaps_self_all" on public.career_roadmaps;
create policy "career_roadmaps_self_all" on public.career_roadmaps
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
