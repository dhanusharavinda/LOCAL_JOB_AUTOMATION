-- ============================================================================
-- GO CANDID8 — Initial Supabase Postgres schema (idempotent)
-- ============================================================================
-- Safe to re-run. Every policy is dropped before being recreated, so
-- partial / retried applies won't fail with "already exists".
-- ============================================================================

create extension if not exists "pgcrypto";

-- ──────────────────────────────────────────────────────────────────────────
-- profiles
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text not null,
  name                  text not null,
  plan                  text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  stripe_customer_id    text,
  stripe_subscription_id text,
  onboarded_at          timestamptz,
  created_at            timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Auto-provision a profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ──────────────────────────────────────────────────────────────────────────
-- user_settings
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  config_json jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "user_settings_self_all" on public.user_settings;
create policy "user_settings_self_all" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- candidates
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.candidates (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  email           text,
  resume_text     text,
  resume_filename text,
  notes           text,
  tier            smallint default 1 check (tier in (1, 2, 3)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_candidates_user on public.candidates(user_id);
alter table public.candidates enable row level security;
drop policy if exists "candidates_self_all" on public.candidates;
create policy "candidates_self_all" on public.candidates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- jobs
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id                  bigserial primary key,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  candidate_id        bigint references public.candidates(id) on delete set null,

  job_title           text not null,
  company_name        text not null,
  company_url         text,
  job_link            text,
  location            text,
  salary              text,
  seniority_level     text,
  applicants_count    text,
  apply_url           text,
  resume_url          text,
  outreach_email      text,
  description         text,

  status              text not null default 'applied'
                      check (status in ('filtered', 'saved', 'applied', 'interviewing', 'offer', 'rejected')),

  match_score         integer,
  match_reason        text,
  applied_date        timestamptz,
  notes               text,
  deadline            timestamptz,
  job_category        text,
  interview_date      timestamptz,
  offer_date          timestamptz,

  source              text default 'linkedin',
  sources             jsonb,
  source_count        integer default 1,
  content_hash        text,
  posted_at           timestamptz,
  freshness_score     real,
  tags                jsonb,

  cover_letter        text,
  hiring_message      text,
  flagged             boolean not null default false,
  interview_prep      text,

  expired             boolean not null default false,
  last_checked_at     timestamptz,
  expiry_reason       text,
  ats_score           integer,
  resume_profile_id   bigint,

  score_breakdown     jsonb,
  detected_role_type  text,
  keyword_match_rate  real,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists idx_jobs_user_link on public.jobs(user_id, job_link) where job_link is not null;
create index if not exists idx_jobs_user on public.jobs(user_id);
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_candidate on public.jobs(candidate_id);

alter table public.jobs enable row level security;
drop policy if exists "jobs_self_all" on public.jobs;
create policy "jobs_self_all" on public.jobs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- job_status_history
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.job_status_history (
  id          bigserial primary key,
  job_id      bigint not null references public.jobs(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_at  timestamptz not null default now()
);

create index if not exists idx_status_history_job on public.job_status_history(job_id);
create index if not exists idx_status_history_user on public.job_status_history(user_id);

alter table public.job_status_history enable row level security;
drop policy if exists "status_history_self_all" on public.job_status_history;
create policy "status_history_self_all" on public.job_status_history
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- resume_profiles
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.resume_profiles (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text not null,
  role_type         text not null,
  resume_text       text not null,
  original_filename text,
  is_default        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_resume_profiles_user on public.resume_profiles(user_id);
alter table public.resume_profiles enable row level security;
drop policy if exists "resume_profiles_self_all" on public.resume_profiles;
create policy "resume_profiles_self_all" on public.resume_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- skill_snapshots
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.skill_snapshots (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  total_jobs  integer default 0,
  skills_json jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_snapshots_user_date on public.skill_snapshots(user_id, date desc);
alter table public.skill_snapshots enable row level security;
drop policy if exists "skill_snapshots_self_all" on public.skill_snapshots;
create policy "skill_snapshots_self_all" on public.skill_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- career_events
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.career_events (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  organizer   text,
  location    text,
  event_date  timestamptz,
  event_url   text,
  description text,
  event_type  text default 'career_fair',
  source      text,
  scraped_at  timestamptz not null default now(),
  unique (user_id, event_url)
);

create index if not exists idx_events_user_date on public.career_events(user_id, event_date);
alter table public.career_events enable row level security;
drop policy if exists "career_events_self_all" on public.career_events;
create policy "career_events_self_all" on public.career_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- scraped_jobs_archive
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.scraped_jobs_archive (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  job_title     text not null,
  company_name  text not null,
  location      text,
  description   text,
  source        text,
  content_hash  text,
  scraped_at    timestamptz not null default now(),
  unique (user_id, content_hash)
);

create index if not exists idx_archive_user_scraped on public.scraped_jobs_archive(user_id, scraped_at desc);
alter table public.scraped_jobs_archive enable row level security;
drop policy if exists "archive_self_all" on public.scraped_jobs_archive;
create policy "archive_self_all" on public.scraped_jobs_archive
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- story_bank
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.story_bank (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  story_title   text not null,
  situation     text not null,
  task          text not null,
  action        text not null,
  result        text not null,
  reflection    text,
  tags          jsonb not null default '[]'::jsonb,
  source_job_id bigint references public.jobs(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_story_bank_user on public.story_bank(user_id);
create index if not exists idx_story_bank_source on public.story_bank(source_job_id);
alter table public.story_bank enable row level security;
drop policy if exists "story_bank_self_all" on public.story_bank;
create policy "story_bank_self_all" on public.story_bank
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- target_companies
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.target_companies (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  company_name      text not null,
  careers_url       text not null,
  ats_type          text not null default 'custom',
  title_keywords    jsonb not null default '[]'::jsonb,
  negative_keywords jsonb not null default '[]'::jsonb,
  last_scanned_at   timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists idx_target_companies_user on public.target_companies(user_id);
alter table public.target_companies enable row level security;
drop policy if exists "target_companies_self_all" on public.target_companies;
create policy "target_companies_self_all" on public.target_companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- project_bank
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.project_bank (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  link          text,
  date          text,
  location      text,
  summary       text,
  bullet_points jsonb not null,
  tags          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_project_bank_user on public.project_bank(user_id);
alter table public.project_bank enable row level security;
drop policy if exists "project_bank_self_all" on public.project_bank;
create policy "project_bank_self_all" on public.project_bank
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- usage_tracking
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.usage_tracking (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  candidate_id      bigint references public.candidates(id) on delete cascade,
  period            date not null,
  jobs_scraped      integer not null default 0,
  resumes_tailored  integer not null default 0,
  pipeline_runs     integer not null default 0,
  last_run_status   text,
  updated_at        timestamptz not null default now()
);

create unique index if not exists uniq_usage_user_candidate_period
  on public.usage_tracking (user_id, (coalesce(candidate_id, 0)), period);
create index if not exists idx_usage_user_period on public.usage_tracking(user_id, period);

alter table public.usage_tracking enable row level security;
drop policy if exists "usage_self_all" on public.usage_tracking;
create policy "usage_self_all" on public.usage_tracking
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- gmail_tokens
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.gmail_tokens (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  scope         text,
  token_type    text,
  expiry_date   bigint,
  connected_at  timestamptz not null default now(),
  last_sync_at  timestamptz
);

alter table public.gmail_tokens enable row level security;
drop policy if exists "gmail_tokens_self_all" on public.gmail_tokens;
create policy "gmail_tokens_self_all" on public.gmail_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Storage bucket policies (run AFTER creating the buckets in the dashboard)
-- ============================================================================
do $$
begin
  if exists (select 1 from storage.buckets where id = 'resumes') then
    drop policy if exists "resumes_self_select" on storage.objects;
    drop policy if exists "resumes_self_insert" on storage.objects;
    drop policy if exists "resumes_self_update" on storage.objects;
    drop policy if exists "resumes_self_delete" on storage.objects;

    create policy "resumes_self_select" on storage.objects
      for select to authenticated
      using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "resumes_self_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "resumes_self_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "resumes_self_delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if exists (select 1 from storage.buckets where id = 'resume-pdfs') then
    drop policy if exists "resume_pdfs_self_select" on storage.objects;
    drop policy if exists "resume_pdfs_self_insert" on storage.objects;
    drop policy if exists "resume_pdfs_self_update" on storage.objects;
    drop policy if exists "resume_pdfs_self_delete" on storage.objects;

    create policy "resume_pdfs_self_select" on storage.objects
      for select to authenticated
      using (bucket_id = 'resume-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "resume_pdfs_self_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'resume-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "resume_pdfs_self_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'resume-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "resume_pdfs_self_delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'resume-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
