-- ──────────────────────────────────────────────────────────────────────────
-- Tailorly AI - per-run OpenAI cost
-- ──────────────────────────────────────────────────────────────────────────
-- free_tailor_log recorded that a run happened but not what it cost, so
-- the only way to answer "what is this costing me" was to multiply a row
-- count by an average. These columns hold the token counts the OpenAI
-- API itself reported for that run, plus the dollar figure derived from
-- them at the price in force at the time.
--
-- Nullable on purpose: rows written before this existed keep NULL, and
-- the admin panel falls back to a measured average for those, labelling
-- the result as partly estimated rather than presenting it as exact.
--
-- The server also adds these on demand (ensureQuotaSchema in
-- server/src/routes/free-tailor.ts).

alter table public.free_tailor_log
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists cost_usd numeric(10, 6);

comment on column public.free_tailor_log.cost_usd is
  'USD for this run, from the API''s own token counts. NULL = predates cost tracking; estimate it.';
