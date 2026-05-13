-- ============================================================================
-- GO CANDID8 - recruiter_followup column
-- ============================================================================
-- Per-job on-demand recruiter follow-up email. Generated AFTER the user has
-- applied to a role through any channel (extension auto-apply, manual apply
-- on the company site, etc.) and wants to send a short, attention-grabbing
-- note to the hiring manager / recruiter.
--
-- Distinct from the existing `cover_letter` column (which is a formal cover
-- letter sent WITH the application) and `hiring_message` (the "Why I'm a fit"
-- short pitch). This one is the follow-up nudge that comes AFTER application
-- submit, written in a more personal Tldr-style voice.
-- ============================================================================

alter table public.jobs
  add column if not exists recruiter_followup text;
