-- ──────────────────────────────────────────────────────────────────────────
-- Tailorly AI - weekly interview allowance + audio budget
-- ──────────────────────────────────────────────────────────────────────────
-- The AI interviewer is the most expensive thing the product does: about
-- 15c a session at 10 questions, against 0.15c for a tailored resume,
-- and nearly all of that is speech-to-text billed per MINUTE of audio.
--
-- Two controls follow from that:
--
--   profiles.interview_limit  weekly sessions for one person. NULL means
--                             the site default. Same shape as tailor_limit.
--
--   interview_sessions.stt_seconds  how much audio this session has sent
--                             for transcription. Cost scales with minutes
--                             of microphone, not with questions answered,
--                             so a session where someone walks away with
--                             the mic open is the real risk. The server
--                             refuses more audio past a per-session cap.
--
--   interview_sessions.cost_usd  what the session actually cost, so the
--                             admin panel can show it next to resumes.
--
-- The server also adds these on demand (ensureInterviewSchema in
-- server/src/routes/interview.ts).

alter table public.profiles
  add column if not exists interview_limit integer;

alter table public.interview_sessions
  add column if not exists stt_seconds integer not null default 0,
  add column if not exists cost_usd numeric(10, 6) not null default 0;

comment on column public.profiles.interview_limit is
  'Interview sessions allowed per week. NULL = site default.';
comment on column public.interview_sessions.stt_seconds is
  'Seconds of audio sent to speech-to-text. Capped per session; cost scales with this, not question count.';
