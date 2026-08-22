# GO CANDID8 - Job Automation Portal

Personal-brand SaaS for automating the job hunt end-to-end: scrape relevant postings, AI-filter them against your resume, auto-tailor your CV per role, draft cover letters, track applications on a kanban, practice interviews with an AI voice agent, and auto-apply through supported ATS systems.

---

## High-level architecture

```
job-tracker/
├── client/      React + Vite dashboard (Supabase auth, kanban UI, AI interview, settings)
├── server/      Express + Postgres (Supabase) - REST API for everything the client + extension talk to
├── pipeline/    Long-running TypeScript subprocess: scrape → AI filter → tailor → store
├── extension/   Chrome extension that auto-fills ATS forms using the user's apply profile
└── supabase/    Migrations: jobs, profiles, interview sessions, apply profiles, etc.
```

**Runtime model**: client and server run continuously. Pipeline is spawned per-user as a subprocess (so each run inherits its own env config). Extension lives in the user's browser and talks to the server via the same auth tokens.

---

## The pipeline (what happens on one run)

```
1. Keyword expansion       LLM expands "data engineer" → ETL/Analytics/Platform variants
2. Scrape (parallel)       LinkedIn, Indeed, Truefetch, +Naukri/Upwork (opt-in)
3. Dedup                   Cross-source merge by URL + title fuzzy match
4. Location filter         Country/region check against TARGET_COUNTRIES
5. AI relevance scoring    10-dimension rubric, weighted score, letter grade
6. Persistence             Top-N survivors written to jobs table
7. Tailor (top MAX_TAILOR_COUNT)
                           Generate role-specific resume PDF + cover letter
8. Notify                  Optional Telegram alert when score >= threshold
```

Every step is bounded (`APIFY_JOB_COUNT`, `MAX_TAILOR_COUNT`, `RELEVANCE_SCORE_THRESHOLD`) so a single run has a predictable upper-bound cost.

---

## Recent architectural changes (this session)

### 1. Keyword expansion - beats "ETL Engineer" misses
One gpt-4o-mini call at pipeline startup expands the user's literal keywords into the broader set of titles recruiters actually use (`data engineer` → `etl engineer, analytics engineer, data platform engineer, big data engineer`). Mutates `config.SEARCH_KEYWORDS` so every downstream scraper picks up the broader set automatically.
- File: [`pipeline/src/services/keywordExpander.ts`](pipeline/src/services/keywordExpander.ts)
- Toggle: `EXPAND_KEYWORDS=true|false` (default true)
- Safeguards: keeps user's original keywords at the front; strips seniority words; capped at 12 titles; in-memory cached.

### 2. Multi-keyword fan-out per scraper
Previously every Apify scraper (Indeed, Naukri, Truefetch) used `keywords[0]` only - 2/3 of the user's CSV silently dropped. Now each scraper fans out across up to `MAX_KEYWORDS_PER_SCRAPER` (default 3) keywords **in parallel**, dedupping by URL within the scraper.
- Helper: `runApifyActorMultiKeyword()` in [`pipeline/src/services/apify.ts`](pipeline/src/services/apify.ts)
- Same wall-clock time as a single call.

### 3. Soft seniority filter
LinkedIn's `f_E` (experience filter) is no longer applied as a hard scrape gate. Instead the user's preference (Entry / Associate / Mid-Senior / Director) is fed into the **AI relevance scorer's seniority_fit prompt**, so the scorer penalises mismatches in scoring rather than blocking them at scrape time. Fixes the "I picked entry-level but only see seniors" bug from LinkedIn returning zero entry roles in slow weeks.
- Toggle: `STRICT_SENIORITY_FILTER=true` reverts to old hard-filter behavior.
- Plumbing: [`pipeline/src/prompts/relevance.ts:60-84`](pipeline/src/prompts/relevance.ts#L60-L84) + [`pipeline/src/services/openai.ts:46-72`](pipeline/src/services/openai.ts#L46-L72)

### 4. New scrapers
- **Truefetch** (`truefetch~best-job-listing`) - multi-source aggregator across Indeed/LinkedIn/Glassdoor. Default ON.
- **Upwork** (`upwork-vibe~upwork-job-scraper`) - freelance / contract gigs. Default OFF; flip `SCRAPE_UPWORK=true` if hunting contract work.

### 5. Admin tailoring bypass
Admins (CSV-listed in `ADMIN_EMAILS` env) get unlimited daily manual resume tailors. Skips the advisory-lock transaction and the `free_tailor_log` insert so admin usage doesn't pollute the quota table.
- File: [`server/src/routes/free-tailor.ts`](server/src/routes/free-tailor.ts)

### 6. AI interview practice
Voice-driven mock interviews: GPT-4o-mini generates 10 questions tailored to the job + resume, OpenAI Whisper transcribes the candidate's answers, the model does a follow-up vs next decision per turn, and a final scoring pass produces a 10-dimension rubric.
- Difficulty slider: Easy / Medium / Hard.
- "I don't know" detection skips to the next question instead of looping into follow-ups.
- File: [`client/src/components/InterviewSession.tsx`](client/src/components/InterviewSession.tsx) + [`server/src/routes/interview.ts`](server/src/routes/interview.ts)

### 7. Defensive scoring fix
The relevance scorer now coerces non-numeric `score` fields from the LLM via `Number.isFinite` before clamping - prevents NaN propagation when GPT returns `"score": "high"` instead of a number. Fixes a silent verdict corruption bug.
- File: [`pipeline/src/services/openai.ts:84-99`](pipeline/src/services/openai.ts#L84-L99)

---

## Updated cost per run

Default config: Ireland target, no India, no Upwork, `APIFY_JOB_COUNT=100`, `MAX_KEYWORDS_PER_SCRAPER=3`, expansion ON.

| Step | Provider | Approximate cost |
|---|---|---|
| Keyword expansion | OpenAI (gpt-4o-mini) | ~$0.0002 |
| LinkedIn scrape (1 call, OR-joined keywords) | Apify | ~$0.20 |
| Indeed scrape (3 parallel calls) | Apify | ~$0.10 |
| Truefetch scrape (3 parallel calls) | Apify | ~$0.10 |
| AI relevance scoring (~200 jobs survive dedup, ~$0.001/job, cached prefix) | OpenAI | ~$0.20 |
| Resume tailoring (top 20 jobs, ~$0.01 each) | OpenAI | ~$0.20 |
| Cover letter / why-fit (top 20, optional) | OpenAI | ~$0.10 |
| **Total per pipeline run** | | **~$0.90** |

With opt-in sources:
- `+ India targeting` → adds Naukri scrape: **+$0.10** → ~$1.00 / run
- `+ SCRAPE_UPWORK=true` → adds Upwork: **+$0.10** → ~$1.10 / run
- `+ Both` → ~$1.20 / run

### Interview practice (per session, separate from pipeline)
| Step | Provider | Approximate cost |
|---|---|---|
| Question generation (10 questions) | OpenAI | ~$0.01 |
| Per-turn decide step (10 questions × follow-ups) | OpenAI | ~$0.02 |
| Whisper transcription (~5-10 min of audio) | OpenAI | ~$0.04 |
| TTS for AI voice (~5k chars total) | OpenAI | ~$0.08 |
| Final rubric scoring | OpenAI | ~$0.02 |
| **Total per interview session** | | **~$0.15-0.20** |

### Other one-off operations
- Manual resume tailor (free-tailor endpoint): ~$0.02 per tailor. Free tier capped at 1/day, Pro at 5/day, admins unlimited.
- Job-detail AI features (analyze-resume, regenerate cover letter from kanban card): ~$0.01 each.
- Apply-form AI answer (extension auto-fills free-text fields): ~$0.001 per answer, cached in `apply_profiles.custom_answers` so repeated questions are free.

---

## Configuration

The pipeline reads everything from env vars (server injects per-user config when spawning the subprocess). Full list lives in [`pipeline/src/config.ts`](pipeline/src/config.ts); the key tunables:

| Env var | Default | What it does |
|---|---|---|
| `APIFY_API_TOKEN` | (required) | Apify auth, used by all Apify-backed scrapers |
| `OPENAI_API_KEY` | (required) | OpenAI auth for all LLM/Whisper/TTS calls |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default chat model across server + pipeline |
| `APIFY_JOB_COUNT` | `100` | Target relevant jobs after AI filter (over-scrape is 2.5×) |
| `MAX_TAILOR_COUNT` | `20` | How many top-scored jobs get resume + cover letter generation |
| `MAX_KEYWORDS_PER_SCRAPER` | `3` | Keyword fan-out cap for Indeed/Truefetch/Naukri/Upwork |
| `EXPAND_KEYWORDS` | `true` | LLM expansion of role keywords at startup |
| `STRICT_SENIORITY_FILTER` | `false` | Send `f_E` to LinkedIn as hard filter (was the old behavior) |
| `SCRAPE_TRUEFETCH` | `true` | Multi-source aggregator scraper |
| `SCRAPE_UPWORK` | `false` | Freelance / contract gigs (turn on if hunting contract) |
| `TARGET_COUNTRIES` | `ireland` | CSV of country slugs; controls Indeed domain + Naukri-on-India |
| `LINKEDIN_TIME_FILTER` | `r604800` | `r86400`=1d, `r604800`=1w, `r2592000`=30d |
| `LINKEDIN_EXPERIENCE` | `""` | CSV of f_E codes; now used as soft AI hint unless STRICT_SENIORITY_FILTER=true |
| `RELEVANCE_SCORE_THRESHOLD` | `5` | Min relevance score (1-10 scale) to keep a job |
| `ADMIN_EMAILS` | `""` | CSV; admins get unlimited manual tailors + admin panel |

Server-only vars live in [`server/.env.example`](server/.env.example) - Supabase URL + service-role key, OpenAI key, CORS allow-list, admin emails, etc.

---

## Common operations

### Run the pipeline manually (single user)
```bash
cd pipeline
# pipeline reads its env from process.env - populate via .env or `export`
npm run start
```

### Start the dashboard locally
```bash
cd server && npm run dev    # API on :3001
cd client && npm run dev    # Dashboard on :5173
```

### Deploy
Server + pipeline run on Railway (Dockerfile + nixpacks.toml at root); client deploys to Vercel; database + storage are Supabase. The pipeline is invoked as a subprocess from the server's `/api/pipeline/start` endpoint, inheriting the user's per-row config (resume, keywords, target role, plan tier).

---

## Notes for future maintainers

- **Tenant isolation**: every SQL query touching user data scopes by `WHERE user_id = ${userId}`. Storage paths are prefixed by `{userId}/`. RLS policies in Supabase enforce the same on direct browser access. The four ATS handlers (`server/src/services/ats/*.ts`) refuse to run if `job.user_id` is missing from the caller's payload - closes a latent foot-gun where a future caller could accidentally use one user's resume under another user's session.
- **Apify scrapers fail independently**: `Promise.allSettled` in the orchestrator means one broken scraper doesn't sink the whole run. Each surfaces a `log.warn` with the actor that failed.
- **The AI relevance prompt is byte-stable** so OpenAI's prefix-cache hits on every job (50% cost discount). Be careful when editing [`pipeline/src/prompts/relevance.ts`](pipeline/src/prompts/relevance.ts) - even a whitespace change invalidates the cache for the rest of the run.
- **Pipeline subprocess auth**: server signs a one-shot M2M token at boot (`INTERNAL_PIPELINE_TOKEN`) and passes it via env to the subprocess. The subprocess uses it to call `/api/internal/*` endpoints (write-back of scraped jobs, status updates).

to do:
AI Career Coach provides a roadmap, salary benchmarks, and learning suggestions tuned to your goals.

Realtime Job Matching surfaces curated jobs matched to your skills, salary, and city, refreshed hourly.

have my profile feature to collect personal career info in order to auto fill job applications using our extension!