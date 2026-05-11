-- ============================================================================
-- GO CANDID8 - apply_profiles + jobs.apply_* tracking columns
-- ============================================================================
-- Adds the data model for the auto-apply feature:
--
--   1. apply_profiles - one row per user. Holds the answers the extension
--      and server-side ATS submitters need to fill an application form
--      (personal info, work auth, salary, EEO, plus a free-text custom
--      answer cache keyed by normalized question text).
--
--   2. jobs.apply_attempted_at / apply_method / apply_errors - per-job
--      bookkeeping for application attempts. Combined with the existing
--      'applied' enum value on jobs.status, this gives the kanban view a
--      complete record of what the extension or server-side submitter did.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─── apply_profiles ─────────────────────────────────────────────────────────
create table if not exists public.apply_profiles (
  user_id              uuid primary key references public.profiles(id) on delete cascade,

  -- Personal
  full_name            text,
  email                text,
  phone                text,
  linkedin_url         text,
  github_url           text,
  portfolio_url        text,
  street               text,
  city                 text,
  state_region         text,
  postcode             text,
  country              text,

  -- Work authorization
  work_auth_status     text,            -- "Authorized" | "Need sponsorship" | "Citizen" | "GC" | "H1B" | "Stamp4" | etc.
  requires_sponsorship boolean,
  willing_to_relocate  boolean,

  -- Compensation
  salary_min           integer,         -- annual
  salary_max           integer,
  salary_currency      text default 'USD',

  -- Career
  years_experience     integer,
  highest_degree       text,            -- "Bachelor's" | "Master's" | "PhD" | etc.
  university           text,
  graduation_year      integer,
  start_date           text,            -- "Immediately" | "2 weeks notice" | ISO date

  -- US/IE/UK EEO. All nullable; user can leave blank to "decline to state".
  -- For EU users we don't auto-fill these without explicit per-question consent.
  ethnicity            text,
  gender               text,
  veteran_status       text,
  disability_status    text,
  pronouns             text,

  -- Story / narrative answers reused across applications (why this company,
  -- why this role, biggest accomplishment, etc.). Free-text, ~1k chars each.
  why_interested       text,
  greatest_achievement text,
  problem_solved       text,
  unique_strength      text,

  -- Cache of AI-generated answers, keyed by a normalized question text
  -- (lowercase, punctuation stripped, whitespace collapsed). Lets the
  -- extension reuse a previous answer without paying for a new OpenAI
  -- call when the same question appears on a different application.
  custom_answers       jsonb not null default '{}'::jsonb,

  updated_at           timestamptz not null default now()
);

alter table public.apply_profiles enable row level security;
drop policy if exists "apply_profiles_self_all" on public.apply_profiles;
create policy "apply_profiles_self_all" on public.apply_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── jobs apply tracking columns ────────────────────────────────────────────
-- Three new nullable columns. Defaults are NULL so existing rows remain
-- untouched. Populated by /api/apply/track when the extension reports an
-- outcome, or directly by the server-side ATS submitter on success.
alter table public.jobs
  add column if not exists apply_attempted_at  timestamptz,
  add column if not exists apply_method        text,   -- 'extension_linkedin' | 'extension_greenhouse' | 'api_lever' | etc.
  add column if not exists apply_errors        text;

create index if not exists idx_jobs_apply_attempted
  on public.jobs(user_id, apply_attempted_at desc)
  where apply_attempted_at is not null;
