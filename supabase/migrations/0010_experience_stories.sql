-- ──────────────────────────────────────────────────────────────────────────
-- GO CANDID8 - experience_stories
-- ──────────────────────────────────────────────────────────────────────────
-- First-person work-experience narratives generated from the resume:
--   - monologue:   "tell me about your time at X" spoken narrative
--   - day_in_life: "a typical day looked like..."
--   - how_it_felt: pace / ownership / learning, the human side
--   - followups:   [{question, answer|null}] - the AI asks for every
--                  detail the resume doesn't answer instead of inventing;
--                  answered entries keep their answer as an audit trail.
--   - status:      draft (open questions remain) | complete
-- The server also creates this table on demand (ensureExperienceTable in
-- routes/story-bank.ts) so deploys that missed this migration still work.

create table if not exists public.experience_stories (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  company      text not null,
  title        text not null,
  date_range   text,
  monologue    text not null,
  day_in_life  text,
  how_it_felt  text,
  followups    jsonb not null default '[]'::jsonb,
  status       text not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_experience_stories_user on public.experience_stories(user_id);

alter table public.experience_stories enable row level security;
drop policy if exists "experience_stories_self_all" on public.experience_stories;
create policy "experience_stories_self_all" on public.experience_stories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
