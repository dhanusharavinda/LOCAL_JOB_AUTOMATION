-- ============================================================================
-- GO CANDID8 - gmail_tokens.email
-- ============================================================================
-- Record WHICH Google account each user connected, so the UI can show
-- "Connected as name@gmail.com" instead of a generic "connected" state. The
-- Gmail integration is already per-user (one gmail_tokens row per user_id);
-- this just makes the connected identity visible. Idempotent.
-- ============================================================================

alter table public.gmail_tokens
  add column if not exists email text;
