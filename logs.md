started
>>>Initializing pipeline...
╔══════════════════════════════════════════╗
║ Job Automation Pipeline ║
╚══════════════════════════════════════════╝
 ✓22:21:00 ✓ Configuration validated
>>>22:21:00 >>> Expanding role keywords to catch synonymous titles...
22:21:05 Keyword expansion: "ai engineer, python developer, data engineer, ai analyst, data analyst, graduate, Junior Data, ml engineer" → 17 titles (ai engineer, python developer, data engineer, ai analyst, data analyst, graduate...)
>>>22:21:05 >>> Scraping source (target 20 relevant → requesting 50 raw, 2.5× over-scrape)...
22:21:05 Starting source source scraper...
22:21:05 Search URL: [search url]
22:21:05 Requesting 50 jobs from source
22:21:06 Actor run started (ID: u9Kgc68lhTU20RWBC)
22:21:17 Scraping in progress... (10s elapsed, status: RUNNING)
22:21:28 Scraping in progress... (20s elapsed, status: RUNNING)
22:21:38 Scraping in progress... (30s elapsed, status: RUNNING)
22:21:49 Scraping in progress... (40s elapsed, status: RUNNING)
22:22:00 Scraping in progress... (50s elapsed, status: SUCCEEDED)
 ✓22:22:00 ✓ Scraping complete, fetching results...
22:22:01 [debug] First item location-related keys: ["location","workplaceTypes","country"]
22:22:01 [debug] First item location value: "Dublin, County Dublin, Ireland"
 ✓22:22:01 ✓ source: 50 jobs
>>>22:22:01 >>> Scraping other job boards...
>>>22:22:01 >>> Scraping source for keywords: ai engineer, python developer, data engineer, ai analyst, data analyst...
22:22:01 Target countries: ireland
22:22:01 source: fanning out across 3 keyword(s) @ 10 jobs each
22:22:01 Starting source source[ai engineer] scraper (valig~source-jobs-scraper)...
22:22:01 Starting source source[python developer] scraper (valig~source-jobs-scraper)...
22:22:01 Starting source source[data engineer] scraper (valig~source-jobs-scraper)...
22:22:01 Truefetch: fanning out across 3 keyword(s) @ 10 jobs each
22:22:01 Starting source Truefetch[ai engineer] scraper (truefetch~best-job-listing)...
22:22:01 Starting source Truefetch[python developer] scraper (truefetch~best-job-listing)...
22:22:01 Starting source Truefetch[data engineer] scraper (truefetch~best-job-listing)...
22:22:01 Aggregator enabled (multi-source)
22:22:01 source skipped (india not in TARGET_COUNTRIES)
22:22:02 source[ai engineer] run started (ID: OSrNmt6WngnsSHC7n)
22:22:02 source[data engineer] run started (ID: g3Vsy2r998C1OUnsV)
22:22:02 Truefetch[python developer] run started (ID: Xl5BwAXvqpPmLTe0b)
22:22:02 source[python developer] run started (ID: t1qvB8rNVDvkYMCvs)
22:22:02 Truefetch[ai engineer] run started (ID: 37SE1r5VIQDs1hrta)
22:22:02 Truefetch[data engineer] run started (ID: oDoVhgd0HF9V01j1c)
22:22:13 source[ai engineer] scraping... (10s elapsed, status: SUCCEEDED)
22:22:13 source[data engineer] scraping... (10s elapsed, status: SUCCEEDED)
22:22:13 source[python developer] scraping... (10s elapsed, status: SUCCEEDED)
22:22:13 Truefetch[ai engineer] scraping... (10s elapsed, status: RUNNING)
22:22:13 Truefetch[python developer] scraping... (10s elapsed, status: RUNNING)
 ✓22:22:13 ✓ source[ai engineer]: 10 raw items
22:22:13 Truefetch[data engineer] scraping... (10s elapsed, status: RUNNING)
 ✓22:22:13 ✓ source[data engineer]: 10 raw items
 ✓22:22:13 ✓ source[python developer]: 10 raw items
22:22:13 source: 22 unique jobs after inline dedup
22:22:24 Truefetch[ai engineer] scraping... (20s elapsed, status: RUNNING)
22:22:24 Truefetch[python developer] scraping... (20s elapsed, status: RUNNING)
22:22:24 Truefetch[data engineer] scraping... (20s elapsed, status: RUNNING)
22:22:35 Truefetch[ai engineer] scraping... (30s elapsed, status: RUNNING)
22:22:35 Truefetch[python developer] scraping... (30s elapsed, status: RUNNING)
22:22:35 Truefetch[data engineer] scraping... (30s elapsed, status: RUNNING)
22:22:46 Truefetch[ai engineer] scraping... (40s elapsed, status: RUNNING)
22:22:46 Truefetch[python developer] scraping... (40s elapsed, status: RUNNING)
22:22:46 Truefetch[data engineer] scraping... (40s elapsed, status: RUNNING)
22:22:57 Truefetch[ai engineer] scraping... (50s elapsed, status: RUNNING)
22:22:57 Truefetch[python developer] scraping... (50s elapsed, status: RUNNING)
22:22:57 Truefetch[data engineer] scraping... (50s elapsed, status: RUNNING)
22:23:07 Truefetch[ai engineer] scraping... (60s elapsed, status: RUNNING)
22:23:08 Truefetch[python developer] scraping... (60s elapsed, status: RUNNING)
22:23:08 Truefetch[data engineer] scraping... (60s elapsed, status: SUCCEEDED)
 ✓22:23:08 ✓ Truefetch[data engineer]: 30 raw items
22:23:18 Truefetch[ai engineer] scraping... (70s elapsed, status: RUNNING)
22:23:18 Truefetch[python developer] scraping... (70s elapsed, status: RUNNING)
22:23:29 Truefetch[ai engineer] scraping... (80s elapsed, status: RUNNING)
22:23:29 Truefetch[python developer] scraping... (80s elapsed, status: RUNNING)
22:23:40 Truefetch[ai engineer] scraping... (90s elapsed, status: RUNNING)
22:23:40 Truefetch[python developer] scraping... (90s elapsed, status: RUNNING)
22:23:51 Truefetch[ai engineer] scraping... (100s elapsed, status: RUNNING)
22:23:51 Truefetch[python developer] scraping... (100s elapsed, status: SUCCEEDED)
 ✓22:23:52 ✓ Truefetch[python developer]: 21 raw items
22:24:02 Truefetch[ai engineer] scraping... (110s elapsed, status: RUNNING)
22:24:13 Truefetch[ai engineer] scraping... (120s elapsed, status: RUNNING)
22:24:24 Truefetch[ai engineer] scraping... (130s elapsed, status: RUNNING)
22:24:35 Truefetch[ai engineer] scraping... (140s elapsed, status: SUCCEEDED)
 ✓22:24:35 ✓ Truefetch[ai engineer]: 30 raw items
22:24:35 Truefetch: 63 unique jobs after inline dedup
22:24:35 source: 22 jobs
22:24:35 Aggregator: 63 jobs
 ✓22:24:35 ✓ Other-board scrapers: 85 raw → 85 unique jobs
 ✓22:24:35 ✓ Other boards: 85 unique jobs (post-dedup within source group)
>>>22:24:35 >>> Scanning company careers portals...
22:24:37 [PortalScanner] Scanning 20 target company portals...
22:24:37 [PortalScanner] Adobe: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
 ⚠22:24:37 ⚠ [PortalScanner] Airbnb: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "airbnb" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:37 [PortalScanner] Airbnb: dropped 189 non-targeted-country postings (PORTAL_STRICT_LOCATION=on)
22:24:37 [PortalScanner] Airbnb: 44 matched, capped to 15 freshest (raise MAX_JOBS_PER_PORTAL_COMPANY to widen)
 ✓22:24:37 ✓ [PortalScanner] Airbnb: 15 relevant jobs found
22:24:39 [PortalScanner] Amazon: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
22:24:39 [PortalScanner] Apple: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
 ⚠22:24:39 ⚠ [PortalScanner] Atlassian: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "atlassian" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:39 [PortalScanner] Atlassian: 0 matching jobs
 ⚠22:24:40 ⚠ [PortalScanner] Cloudflare: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "cloudflare" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:41 [PortalScanner] Cloudflare: dropped 47 non-targeted-country postings (PORTAL_STRICT_LOCATION=on)
22:24:41 [PortalScanner] Cloudflare: 0 matching jobs
 ⚠22:24:42 ⚠ [PortalScanner] Datadog: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "datadog" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:43 [PortalScanner] Datadog: dropped 176 non-targeted-country postings (PORTAL_STRICT_LOCATION=on)
 ✓22:24:43 ✓ [PortalScanner] Datadog: 13 relevant jobs found
 ⚠22:24:44 ⚠ [PortalScanner] Figma: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "figma" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:45 [PortalScanner] Figma: dropped 97 non-targeted-country postings (PORTAL_STRICT_LOCATION=on)
 ✓22:24:45 ✓ [PortalScanner] Figma: 2 relevant jobs found
22:24:46 [PortalScanner] Google: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
 ⚠22:24:46 ⚠ [PortalScanner] HubSpot: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "hubspot" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:47 [PortalScanner] HubSpot: 0 matching jobs
 ⚠22:24:48 ⚠ [PortalScanner] Linear: careers_url "[search url]" doesn't look like a ashby ATS endpoint. Guessing slug = "linear" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:49 [PortalScanner] Linear: 0 matching jobs
22:24:50 [PortalScanner] Meta: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
22:24:50 [PortalScanner] Microsoft: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
 ⚠22:24:50 ⚠ [PortalScanner] Netflix: careers_url "[search url]" doesn't look like a lever ATS endpoint. Guessing slug = "netflix" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:51 [PortalScanner] Netflix: 0 matching jobs
 ⚠22:24:53 ⚠ [PortalScanner] Notion: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "notion" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:53 [PortalScanner] Notion: 0 matching jobs
22:24:55 [PortalScanner] Salesforce: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
 ⚠22:24:55 ⚠ [PortalScanner] Shopify: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "shopify" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:55 [PortalScanner] Shopify: 0 matching jobs
 ⚠22:24:57 ⚠ [PortalScanner] Spotify: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "spotify" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:57 [PortalScanner] Spotify: 0 matching jobs
22:24:59 [PortalScanner] Stripe: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
 ⚠22:24:59 ⚠ [PortalScanner] Vercel: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "vercel" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
22:24:59 [PortalScanner] Vercel: dropped 41 non-targeted-country postings (PORTAL_STRICT_LOCATION=on)
22:24:59 [PortalScanner] Vercel: 16 matched, capped to 15 freshest (raise MAX_JOBS_PER_PORTAL_COMPANY to widen)
 ✓22:24:59 ✓ [PortalScanner] Vercel: 15 relevant jobs found
 ✓22:25:01 ✓ Company Careers: 45 jobs
22:25:01 Scrape source breakdown:
22:25:01 source 22 jobs
22:25:01 Aggregator 63 jobs
22:25:01 Company Careers 45 jobs
22:25:01 unknown 50 jobs
22:25:01 Total raw 180 jobs (before dedup across sources)
 ✓22:25:01 ✓ Merged total: 172 fresh jobs (180 raw, 8 older than 14 days dropped)
>>>22:25:01 >>> Checking for duplicates against tracker (kanban dashboard)...
>>>
 ○22:25:03 ○ ↩ "Data Operations Analyst - Outbound Reporting" @ The Citco Group Limited (already in kanban, matched by title_company)
 ○22:25:03 ○ ↩ "Data and Reporting Analyst" @ Capita (already in kanban, matched by title_company)
 ○22:25:03 ○ ↩ "Technical Product Manager QVAC - 100% remote" @ Tether Operations Limited (already in kanban, matched by title_company)
 ○22:25:03 ○ ↩ "Technical Product Manager QVAC - 100% remote" @ Tether Operations Limited (already in kanban, matched by title_company)
 ○22:25:03 ○ ↩ "Technical Product Manager QVAC - 100% remote" @ Tether Operations Limited (already in kanban, matched by title_company)
 ✓22:25:03 ✓ 167 new jobs (5 duplicates filtered against kanban before AI scoring)
 ✓22:26:03 ✓ Archived 167 jobs for skills analysis
22:26:03 JobsExpo: 14 events found
22:26:13 Meetup (ireland): 23 tech events found
22:26:18 TechMeetups: 5 events found (cities: dublin, cork, galway)
22:26:18 Extra event sources for ireland: 27 total
22:26:39 Eventbrite: 464 events found for keywords [ai engineer, python developer, data engineer]
 ✓22:27:04 ✓ Career events for ireland: 65 scraped, 4 new
>>>22:27:04 >>> Filtering by location (per TARGET_COUNTRIES / LOCATION_REGIONS)...
>>>
22:27:04 [debug] Sample location values: ["Dublin, County Dublin, Ireland","Dublin, County Dublin, Ireland","Dublin, County Dublin, Ireland","Greater Dublin","Mullingar, County Westmeath, Ireland"]
22:27:04 [dropped] "Senior Software Engineer, Data Authoring Platform" @ "Airbnb" — location names a non-selected country: "Remote USA"
22:27:04 [dropped] "Staff Software Engineer, Communication Products" @ "Airbnb" — location names a non-selected country: "Remote - USA"
22:27:04 [dropped] "Staff Software Engineer, Build" @ "Airbnb" — location names a non-selected country: "Remote - USA"
22:27:04 [dropped] "Senior Staff Machine Learning Engineer, Post Training" @ "Airbnb" — location names a non-selected country: "Remote - USA"
22:27:04 [dropped] "Software Engineer, Guest & Host" @ "Airbnb" — location names a non-selected country: "Remote, USA "
22:27:04 [dropped] "Senior Backend Software Engineer, Media Ingestion & Serving" @ "Airbnb" — location names a non-selected country: "Remote - USA"
22:27:04 [dropped] "Director, Major Accounts" @ "Datadog" — location names a non-selected country: "Texas, USA, Remote"
22:27:04 [dropped] "Key Accounts Executive" @ "Datadog" — location names a non-selected country: "Illinois, USA, Remote; Michigan, USA, Remote; Minnesota, USA, Remote; Ohio, USA, Remote; Texas, USA, Remote"
22:27:04 [dropped] "Key Accounts Executive" @ "Datadog" — location names a non-selected country: "California, USA, Remote; Colorado, USA, Remote; Washington, USA, Remote"
22:27:04 [dropped] "Major Account Manager" @ "Datadog" — location names a non-selected country: "Florida, USA, Remote; North Carolina, USA, Remote"
22:27:04 [dropped] "Major Account Manager (UK)" @ "Datadog" — location names a non-selected country: "United Kingdom, Remote"
22:27:04 [dropped] "Senior Developer Advocate - Data Observability" @ "Datadog" — location names a non-selected country: "California, USA, Remote; Colorado, USA, Remote; Illinois, USA, Remote; New York, USA, Remote; Washington, USA, Remote"
22:27:04 [dropped] "Staff AI Engineer - Notebooks " @ "Datadog" — location names a non-selected country: "Portugal, Remote"
22:27:04 [dropped] "Technical Account Manager 2 (Thai Speaking)" @ "Datadog" — location names a non-selected country: "Thailand, Remote"
22:27:04 [dropped] "Senior Customer Support Engineer" @ "Vercel" — location names a non-selected country: "Remote - Japan"
22:27:04 29 total jobs dropped (outside ireland or restricted remote)
 ✓22:27:04 ✓ 138 jobs in target locations (filtered out 29)
>>>22:27:04 >>> Fetching uploaded resume from tracker...
>>>
 ✓22:27:06 ✓ Resume loaded (3887 chars)
 ✓22:27:06 ✓ PDF generation: using local server (no warm-up needed)
>>>22:27:06 >>> Phase 1: Scoring 138 jobs (target: 20 relevant after filter, threshold: >= 6, concurrency: 8)...
>>>
22:27:13 [1/138] Distribution Planning Student @ GE HealthCare
 ○22:27:13 ○ Not relevant (score: 4/10): The role is fundamentally mismatched for an engineering candidate, leading to a low overall score.
22:27:13 [2/138] Share Your Profile With Nord Anglia International School Dublin!, NORD ANGLIA INTERNATIONAL SCHOOL DUBLIN @ Guardian Jobs
 ○22:27:13 ○ Not relevant (score: 4/10): The job is fundamentally mismatched with the candidate's target roles in engineering and data fields.
22:27:13 [3/138] Sales Associate, Italy @ Cohesity
 ○22:27:13 ○ Not relevant (score: 4/10): The candidate's profile fundamentally mismatches the sales role requirements.
22:27:14 [4/138] Graduate Sales Executive (Hungarian Market) @ Revolut
 ○22:27:14 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the sales role requirements.
22:27:14 [5/138] Senior COUPA Analyst @ Bank of Ireland
 ○22:27:14 ○ Not relevant (score: 4/10): The role is fundamentally misaligned with the candidate's engineering background and entry-level preference.
22:27:14 [6/138] Accounting Graduate Programme 2026 @ PTSB
 ○22:27:14 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's skills and target roles in engineering and data.
22:27:14 [7/138] Trainee Optical Assistant @ Specsavers
 ○22:27:14 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's technical background and aspirations.
22:27:14 [8/138] Casual Academic Talent Pool - Business - ISTM @ UNSW
 ○22:27:14 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the tutoring position in Information Systems.
22:27:25 [9/138] HR Co-Ordinator (12-month Graduate Placement) @ Zoetis
 ○22:27:25 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's engineering background and focus.
22:27:25 [10/138] Revenue Assurance Analyst @ Radius
 ○22:27:25 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's target positions in engineering and data roles.
22:27:25 [11/138] Sales Development Representative Intern @ Cohesity
 ○22:27:25 ○ Not relevant (score: 4/10): The candidate is not a fit for the Sales Development Representative role due to a fundamental category mismatch and lack of relevant skills.
22:27:26 [12/138] Talent Acquisition Coordinator @ ORS
 ○22:27:26 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the recruitment role, leading to a poor overall fit.
22:27:26 [13/138] Operations Professional Development Program (PDP) - Graduate Programme @ Abbott
 ○22:27:26 ○ Not relevant (score: 4/10): The role is fundamentally misaligned with the candidate's target positions in engineering and data fields.
22:27:26 [14/138] Veterinary Nurse - Graduate / Junior position @ IVC Evidensia
 ○22:27:26 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's engineering background.
22:27:26 [15/138] Hiring now! Entry-Level English Teacher (ESL) | No Experience Needed @ English 1
 ○22:27:26 ○ Not relevant (score: 4/10): The role is fundamentally mismatched as it is an English teaching position, not aligned with the candidate's engineering background.
22:27:30 [16/138] Maintrol Support Engineer @ Ryanair - Europe's Favourite Airline
 ○22:27:30 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's target engineering and data roles.
22:27:31 [17/138] Met us at NIBRT? Start your career in Medical Information with ProPharma @ ProPharma
 ○22:27:31 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the medical information position, resulting in a fundamental mismatch.
22:27:33 [18/138] Hiring now! Entry-Level English Teacher (ESL) | No Experience Needed @ English 1
 ○22:27:33 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the teaching role, leading to a fundamental mismatch.
22:27:33 [19/138] Hiring now! Entry-Level English Teacher (ESL) | No Experience Needed @ English 1
 ○22:27:33 ○ Not relevant (score: 4/10): The role is a teaching position, which is fundamentally different from the candidate's targeted engineering roles.
22:27:34 [20/138] Hiring now! Entry-Level English Teacher (ESL) | No Experience Needed @ English 1
 ○22:27:34 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's engineering and data background.
22:27:34 [21/138] Post Doctoral Fellow - Department of Physics and Astronomy @ Clemson University MBA Programs
 ○22:27:34 ○ Not relevant (score: 4/10): The candidate's background in AI and data engineering does not align with the requirements for a postdoctoral position in plasma physics.
22:27:35 [22/138] Graduate Structural Engineer - 2026 Graduate Programme @ myGwork - LGBTQ+ Business Community
 ○22:27:35 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's engineering focus in data and AI.
22:27:35 [23/138] 2026 Ireland Graduate Electrical Engineer: Energy Sector @ myGwork - LGBTQ+ Business Community
 ○22:27:35 ○ Not relevant (score: 4/10): The role is fundamentally mismatched as it requires electrical engineering skills, not data or AI expertise.
22:27:39 [24/138] Data Analyst - Process Management (12 Month FTC) | PGIM Ireland @ PGIM Ireland
 ○22:27:39 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's engineering focus, leading to a low overall fit.
22:27:41 [25/138] Junior Ecologist @ ERM
 ○22:27:41 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the ecological focus of this position.
22:27:42 [26/138] Intern - (System Verification Group) @ Cadence
22:27:43 [27/138] Qualtrics Platform Analyst @ The Citco Group Limited
 ○22:27:43 ○ Not relevant (score: 3/10): The candidate is not a fit for the Qualtrics Platform Analyst role due to fundamental category mismatch and significant skill gaps.
22:27:43 [28/138] Hiring now! Entry-Level English Teacher (ESL) | No Experience Needed @ English 1
 ○22:27:43 ○ Not relevant (score: 4/10): The role is fundamentally mismatched as it is an English teaching position, not aligned with the candidate's engineering focus.
22:27:43 [29/138] Hiring now! Entry-Level English Teacher (ESL) | No Experience Needed @ English 1
 ○22:27:43 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's skills and target roles.
22:27:44 [30/138] Graduate Electrical Services Engineers 2026 @ Jones Engineering
 ○22:27:44 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the electrical engineering position.
22:27:45 [31/138] Project Design Engineer (Mechanical) REF: 2605b @ Fingleton White
 ○22:27:45 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's target positions in data and AI engineering.
22:27:48 [32/138] 2026 Graduate Programme - Earth & Environment - Mining @ targetjobs UK
 ○22:27:48 ○ Not relevant (score: 4/10): The role is fundamentally mismatched as it is focused on mining engineering, not data or AI engineering.
22:27:49 [33/138] Remote Software Developer @ Turing
 ○22:27:49 ○ Not relevant (score: 4/10): The candidate is not a fit due to fundamental mismatches in role type and experience requirements.
22:27:50 [34/138] Graduate Engineer - Limerick @ BAM UK & Ireland
 ○22:27:50 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the civil engineering focus of this position.
22:27:50 [35/138] Intern @ Cadence
 ○22:27:50 ○ Not relevant (score: 4/10): The role is not aligned with the candidate's target positions in data and AI engineering, resulting in a low overall fit.
22:27:51 [36/138] Intern SSG @ Cadence
 ○22:27:51 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's target positions in data and AI engineering.
22:27:51 [37/138] Design Engineer I @ Cadence
 ○22:27:51 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the electronic design focus of the position.
22:27:51 [38/138] Power Apps Specialist - Dublin - 145175 @ Jones Engineering
 ○22:27:51 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements for the Power Apps Specialist position.
22:27:53 [39/138] Graduate Mechanical Engineer - 2026 @ Winthrop Technologies
 ○22:27:53 ○ Not relevant (score: 4/10): The role is for a Graduate Mechanical Engineer, which does not match the candidate's background in data and AI engineering.
22:27:55 [40/138] R&D Operations Engineer Graduate @ Amcor
 ○22:27:55 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the operational focus of the R&D Operations Engineer position.
22:27:57 [41/138] CSV Engineer @ QCS Staffing
 ○22:27:57 ○ Not relevant (score: 4/10): The role is fundamentally misaligned with the candidate's skills and target positions.
22:27:57 [42/138] Graduate Engineer - Water @ Nicholas O'Dwyer Ltd
 ○22:27:57 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the Graduate Engineer position in civil engineering.
22:27:59 [43/138] Software Engineering Graduate - 12 month Fixed Term Contract @ Valeo
22:27:59 [44/138] Graduate Embedded Test Engineer (2026) @ MBRYONICS
22:28:00 [45/138] Software Development Apprenticeship, Engineering, October 2026 Start @ Google
22:28:01 [46/138] Associate Software Engineer (Ruby & React) @ Zendesk
22:28:02 [47/138] Engineering Manager, Channels & Platform @ Siena AI
 ○22:28:02 ○ Not relevant (score: 4/10): The candidate is not a fit for the Engineering Manager role due to a fundamental mismatch in role type and seniority.
22:28:03 [48/138] Software AI Engineering Graduate - 12 month Fixed Term Contract @ Valeo
22:28:04 [49/138] Graduate - Software Engineer - 12 month FTC @ Valeo
22:28:05 [50/138] Process Engineer II @ Boston Scientific
 ○22:28:05 ○ Not relevant (score: 4/10): The candidate's skills and desired roles do not align with the mechanical engineering focus of this position.
22:28:06 [51/138] Commercial Graduate Rotation Program - Benelux Market @ Salesforce
 ○22:28:06 ○ Not relevant (score: 4/10): The candidate is not a fit due to the fundamental mismatch with the sales role category.
22:28:07 [52/138] Principal Software Engineer - Red Hat OpenShift Installer (EMEA) @ Red Hat
 ○22:28:07 ○ Not relevant (score: 4/10): The role is a senior software engineering position requiring extensive experience, which does not align with the candidate's entry-level preference.
22:28:07 [53/138] Microsoft Security Engineer @ Codec
 ○22:28:07 ○ Not relevant (score: 2/10): The candidate's skills and career focus do not align with the Microsoft Security Engineer role requirements.
22:28:07 [54/138] Manager, Content Adversarial Red Team @ Google
 ○22:28:07 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's skills and experience level.
22:28:08 [55/138] Lead Full Stack Engineer - Operating Systems New @ Kohlberg Kravis Roberts & Co.
 ○22:28:08 ○ Not relevant (score: 4/10): The role is fundamentally mismatched as it is finance-focused rather than engineering-focused.
22:28:10 [56/138] Staff Technical Program Manager, Site Reliability Engineering @ MongoDB
 ○22:28:10 ○ Not relevant (score: 4/10): The candidate is not a fit for this Technical Program Manager role due to significant mismatches in role type and experience level.
22:28:11 [57/138] Senior Platform Software Engineer @ Acuity Inc.
 ○22:28:11 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for the Platform Software Engineer role.
22:28:12 [58/138] Kafka Technical Lead @ Tata Consultancy Services (TCS)
 ○22:28:12 ○ Not relevant (score: 4/10): The role is a senior Technical Architect position, which does not align with the candidate's entry-level preference and skills.
22:28:14 [59/138] Sr Software Eng @ PlayStation
 ○22:28:14 ○ Not relevant (score: 4/10): The candidate is not a fit for the Senior Software Engineer role due to significant mismatches in skills and experience.
22:28:14 [60/138] Staff Software Engineer - Grafana Cloud k6 | Ireland | Remote @ Grafana Labs
 ○22:28:14 ○ Not relevant (score: 4/10): The candidate is not a fit for this DevOps/SRE role due to fundamental category mismatches and skills misalignment.
22:28:15 [61/138] Account Executive, SMB - UK Market @ DocuSign
 ○22:28:15 ○ Not relevant (score: 4/10): The candidate is not a fit for the Account Executive role due to a fundamental category mismatch.
22:28:16 [62/138] Software Eng II @ PlayStation
 ○22:28:16 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the specialized requirements of the Kernel Security Engineer role.
22:28:17 [63/138] Ads Solutions Engineer, gTech @ Google
 ○22:28:17 ○ Not relevant (score: 4/10): The candidate is not a fit for the Technical Solutions Consultant role due to fundamental category mismatch and significant experience gap.
22:28:19 [64/138] Process Engineer II @ Boston Scientific
 ○22:28:19 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the mechanical engineering focus of the Process Engineer II position.
22:28:20 [65/138] Engineering Manager, Channels & Platform @ Siena AI
 ○22:28:20 ○ Not relevant (score: 4/10): The role is for an Engineering Manager, which is not aligned with the candidate's entry-level aspirations.
22:28:20 [66/138] Manager, Content Adversarial Red Team @ Google
 ○22:28:20 ○ Not relevant (score: 4/10): The candidate is not a fit for this senior Trust & Safety role due to significant experience and category mismatches.
22:28:22 [67/138] Commercial Graduate Rotation Program - Benelux Market @ Salesforce
 ○22:28:22 ○ Not relevant (score: 4/10): The candidate is not a fit due to the fundamental mismatch with the sales role category.
22:28:22 [68/138] Microsoft Security Engineer @ Codec
 ○22:28:22 ○ Not relevant (score: 4/10): The candidate's skills and role preference do not align with the Microsoft Security Engineer position.
22:28:23 [69/138] Principal Software Engineer - Red Hat OpenShift Installer (EMEA) @ Red Hat
 ○22:28:23 ○ Not relevant (score: 4/10): The candidate's profile does not align with the seniority and skill requirements of the Senior Software Engineer role.
22:28:24 [70/138] Staff Technical Program Manager, Site Reliability Engineering @ MongoDB
 ○22:28:24 ○ Not relevant (score: 4/10): The candidate is not a fit for this Technical Program Management role due to significant mismatches in category, skills, and experience.
22:28:25 [71/138] Staff Technical Program Manager, Site Reliability Engineering @ MongoDB
 ○22:28:25 ○ Not relevant (score: 4/10): The candidate is not a fit for the Technical Program Manager role due to a fundamental mismatch in category and experience level.
22:28:26 [72/138] Senior AI Engineer @ Compliance & Risks
 ○22:28:26 ○ Not relevant (score: 2/10): The job is a sales role, fundamentally mismatched with the candidate's engineering focus.
22:28:26 [73/138] Senior Platform Software Engineer @ Acuity Inc.
 ○22:28:26 ○ Not relevant (score: 3/10): The role is fundamentally misaligned with the candidate's targeted positions and experience level.
22:28:27 [74/138] Senior Software Engineer (AI) @ Hays Recruitment
 ○22:28:27 ○ Not relevant (score: 2/10): The role is a sales position, which fundamentally mismatches the candidate's engineering focus.
22:28:28 [75/138] Lead Data Engineer @ Mastercard
 ○22:28:28 ○ Not relevant (score: 2/10): The candidate is not a fit for this Account Executive role due to a fundamental category mismatch.
22:28:29 [76/138] Staff AI Product Designer @ Intercom
 ○22:28:29 ○ Not relevant (score: 2/10): The candidate is not a fit for the Account Executive sales role due to fundamental category mismatch.
22:28:29 [77/138] Staff Software Engineer - Grafana Cloud k6 | Ireland | Remote @ Grafana Labs
 ○22:28:29 ○ Not relevant (score: 2/10): The role is fundamentally mismatched as it is a sales position, not engineering.
22:28:30 [78/138] Process Engineer II @ Boston Scientific
 ○22:28:30 ○ Not relevant (score: 4/10): The candidate is not suited for this sales role due to a fundamental category mismatch.
22:28:31 [79/138] Junior Full Stack Engineer @ EXL Service
 ○22:28:31 ○ Not relevant (score: 2/10): The candidate is not a fit for this Account Executive sales role due to a fundamental category mismatch.
22:28:32 [80/138] Senior Process Engineer @ Boston Scientific
 ○22:28:32 ○ Not relevant (score: 2/10): The role is a sales position, which fundamentally mismatches the candidate's engineering background.
22:28:33 [81/138] Principal Software Engineer - Red Hat OpenShift Installer (EMEA) @ Red Hat, Inc.
 ○22:28:33 ○ Not relevant (score: 2/10): The job is an Account Executive role, which is fundamentally misaligned with the candidate's engineering focus.
22:28:33 [82/138] Full Stack Engineer @ EXL Service
 ○22:28:33 ○ Not relevant (score: 2/10): The candidate is not a fit for the Account Executive role due to a fundamental category mismatch.
22:28:34 [83/138] Kafka Technical Lead @ Tata Consultancy Services (TCS)
 ○22:28:34 ○ Not relevant (score: 4/10): The role is a senior technical architect position with significant experience requirements, which does not match the candidate's entry-level preference.
22:28:35 [84/138] Kafka Technical Lead @ Tata Consultancy Services
 ○22:28:35 ○ Not relevant (score: 2/10): The job is an Account Executive position, which is fundamentally misaligned with the candidate's engineering focus.
22:28:37 [85/138] Lead Full Stack Engineer - Operating Systems New @ Kohlberg Kravis Roberts & Co.
 ○22:28:37 ○ Not relevant (score: 2/10): The candidate is not suited for this sales role, which is fundamentally different from their target positions.
22:28:37 [86/138] Lead Full Stack Engineer - Operating Systems New @ Kohlberg Kravis Roberts & Co.
 ○22:28:37 ○ Not relevant (score: 4/10): The role is fundamentally mismatched with the candidate's engineering background and entry-level preference.
22:28:38 [87/138] Staff Software Engineer - Grafana Cloud k6 | Ireland | Remote @ Grafana Labs
 ○22:28:38 ○ Not relevant (score: 4/10): The role is a DevOps position which fundamentally mismatches the candidate's engineering and data-focused background.
22:28:40 [88/138] Senior Platform Software Engineer @ Acuity Inc.
 ○22:28:40 ○ Not relevant (score: 2/10): The role is fundamentally mismatched as it is a sales position, not engineering.
22:28:41 [89/138] Ads Solutions Engineer, gTech @ Google
 ○22:28:41 ○ Not relevant (score: 4/10): The candidate is not a fit for the Technical Solutions Consultant role due to fundamental category mismatches and seniority requirements.
22:28:42 [90/138] Site Engineer @ Elite Talent Hub
 ○22:28:42 ○ Not relevant (score: 2/10): The candidate is not a fit for the Account Executive role due to a fundamental category mismatch.
22:28:43 [91/138] Account Executive, SMB - UK Market @ DocuSign
 ○22:28:43 ○ Not relevant (score: 4/10): The candidate is not a fit for the Account Executive role due to a fundamental category mismatch and lack of relevant skills.
22:28:44 [92/138] Software Eng II @ PlayStation
 ○22:28:44 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for the Software Engineer II - Kernel Security role.
22:28:44 [93/138] Sr Software Eng @ PlayStation
 ○22:28:44 ○ Not relevant (score: 4/10): The candidate's skills and experience do not match the requirements for the Senior Software Engineer role at Sony Interactive Entertainment.
22:28:45 [94/138] Electrical Project Manager | Dublin @ SSA Recruitment Ireland
 ○22:28:45 ○ Not relevant (score: 2/10): The role is fundamentally misaligned with the candidate's engineering focus and entry-level preference.
22:28:46 [95/138] Senior Software Engineer – Sensors (Cork, Ireland) @ Qualcomm
 ○22:28:46 ○ Not relevant (score: 2/10): The candidate's profile is fundamentally mismatched with the Account Executive role.
22:28:47 [96/138] Senior Process Engineer - South Dublin (DT18627) @ ICDS Recruitment Consultants
 ○22:28:47 ○ Not relevant (score: 2/10): The candidate is not suited for this Account Executive position due to a fundamental category mismatch.
22:28:50 [97/138] Documentation Platform Engineer @ Bentley Systems
 ○22:28:50 ○ Not relevant (score: 2/10): The candidate is fundamentally mismatched for this sales role.
22:28:50 [98/138] Junior Mechanical Engineer | Dublin / Europe @ SSA Recruitment Ireland
 ○22:28:50 ○ Not relevant (score: 2/10): The candidate is not a fit for the Account Executive role due to a fundamental category mismatch.
22:28:52 [99/138] Engineer @ AIA
 ○22:28:52 ○ Not relevant (score: 2/10): The candidate is not a fit for this Account Executive role due to a fundamental category mismatch and lack of relevant skills.
22:28:52 [100/138] Data Networks and Telecoms Engineer | Grade VII @ Mercy University Hospital
 ○22:28:52 ○ Not relevant (score: 2/10): The job is a sales position, fundamentally mismatched with the candidate's engineering background.
22:28:56 [101/138] Technical Product Manager QVAC (100% remote Worldwide) @ Tether Operations Limited
 ○22:28:56 ○ Not relevant (score: 4/10): The role is a senior product management position, which does not align with the candidate's entry-level preference and skills.
22:28:56 [102/138] Full Stack Engineer @ EXL Service
22:28:57 [103/138] Senior Data Quality Developer @ Sumitomo Group
 ○22:28:57 ○ Not relevant (score: 4/10): The candidate is not a fit for this banking role due to fundamental category mismatch and seniority misalignment.
22:28:59 [104/138] Full-Stack Developer @ Arup
22:29:01 [105/138] Technical Solutions Engineer, Security @ Google
 ○22:29:01 ○ Not relevant (score: 4/10): The role is a customer support position requiring extensive experience, which does not align with the candidate's entry-level aspirations.
22:29:01 [106/138] Python Developer (Fast API / FinTech Project) @ Resourceful Talent Group
22:29:03 [107/138] Data Scientist (Python & SQL) - Freelance AI Trainer @ Mindrift
 ○22:29:03 ○ Not relevant (score: 4/10): The role requires extensive experience and a portfolio that the candidate does not possess, making it a poor fit.
22:29:03 [108/138] Full Stack Engineer @ EXL Service
22:29:03 [109/138] Technical Product Manager QVAC (100% remote Worldwide) @ Tether Operations Limited
 ○22:29:03 ○ Not relevant (score: 4/10): The role is a Senior Technical Product Manager position, which is not aligned with the candidate's entry-level preference and skill set.
22:29:07 [110/138] Senior AI Engineer @ FindingVega
 ○22:29:07 ○ Not relevant (score: 4/10): The candidate's entry-level preference and lack of required experience make this a poor fit.
22:29:07 [111/138] Freelance Data Scraping Engineer (Python) @ Mindrift
22:29:08 [112/138] Senior AI Engineer @ Sigmar Recruitment
 ○22:29:08 ○ Not relevant (score: 4/10): The role is a senior position, which does not align with the candidate's entry-level preference.
22:29:08 [113/138] Data Scientist with Python @ Methodius IT Recruitment
 ○22:29:08 ○ Not relevant (score: 4/10): The candidate is not a fit due to fundamental mismatches in role type and required experience.
22:29:15 [114/138] Python Developer @ RECRUITERS
22:29:15 [115/138] Python Developer - Back End (Jun/Mid level) @ Solas IT Recruitment
22:29:15 [116/138] Junior Full Stack Developer @ RWS Group
22:29:15 [117/138] Senior Data Scraping Engineer (Python) @ Mindrift
22:29:16 [118/138] Data Scientist @ Adroit People Limited (UK)
 ○22:29:16 ○ Not relevant (score: 4/10): The candidate's profile does not align with the Data Science Consultant role due to fundamental category and seniority mismatches.
22:29:19 [119/138] Full Stack Engineer (Python, React, AI) @ Barden
22:29:20 [120/138] Freelance Data Science Engineer (Python & SQL) @ Mindrift
 ○22:29:20 ○ Not relevant (score: 4/10): The role requires extensive experience and expertise, which does not align with the candidate's entry-level aspirations.
22:29:20 [121/138] Junior Python Engineer (Test Automation) - Cork, Ireland @ Qualcomm
22:29:25 [122/138] Senior Software Engineer - Python (Hybrid) @ Nitro Software
 ○22:29:25 ○ Not relevant (score: 4/10): The role is a senior position, which does not align with the candidate's entry-level preference.
22:29:26 [123/138] Full Stack AI Engineer @ Nicoll Curtin
22:29:27 [124/138] Data Engineer @ K&K Talents
22:29:27 [125/138] Mid-Level Data & BI Engineer – Career progression! @ Archer Recruitment
 ○22:29:27 ○ Not relevant (score: 4/10): The candidate's entry-level preference does not align with the seniority required for this Mid-Level Data & BI Engineer role.
22:29:27 [126/138] Senior Data Engineer @ Elevate Partners
 ○22:29:27 ○ Not relevant (score: 4/10): The candidate is not a fit for the Senior Investment Data Engineer role due to significant experience and seniority mismatches.
22:29:30 [127/138] Data Visualisation Developer @ Warman O'Brien
 ○22:29:30 ○ Not relevant (score: 4/10): The candidate is not a fit due to fundamental category mismatch and significant experience gap.
22:29:31 [128/138] Senior Data Engineer @ Land Rover Experience Eastnor
22:29:32 [129/138] Senior Analytics Engineer @ Beeline
 ○22:29:32 ○ Not relevant (score: 4/10): The candidate is not a fit for this data science leadership role due to fundamental mismatches in category and required skills.
22:29:33 [130/138] Senior Principal, Tax Controversy @ Airbnb
 ○22:29:33 ○ Not relevant (score: 2/10): The role is fundamentally mismatched as it is a sales position, not engineering.
22:29:34 [131/138] Senior Frontend Engineer, Reliability Experience @ Airbnb
 ○22:29:34 ○ Not relevant (score: 2/10): The candidate is not a fit for this sales role due to a fundamental category mismatch.
22:29:37 [132/138] Manager, Luxe Supply @ Airbnb
 ○22:29:37 ○ Not relevant (score: 2/10): The candidate is not suited for this Account Executive sales role due to a fundamental category mismatch.
22:29:37 [133/138] Analytics Engineer @ Trulioo
22:29:37 [134/138] Technical Account Manager 2 - EMEA @ Datadog
 ○22:29:37 ○ Not relevant (score: 2/10): The role is fundamentally mismatched as it is a sales position, not engineering.
22:29:40 [135/138] Manager, Mid-Market Sales (Nordics, CEE, Baltics) @ Datadog
 ○22:29:40 ○ Not relevant (score: 4/10): The candidate is not a fit for the Sales Executive role due to a fundamental category mismatch.
22:29:42 [136/138] Staff AI Engineer - Notebooks @ Datadog
 ○22:29:42 ○ Not relevant (score: 2/10): The job is a sales role, fundamentally misaligned with the candidate's engineering focus.
22:29:42 [137/138] Technical Account Manager 3 - London @ Datadog
 ○22:29:42 ○ Not relevant (score: 2/10): The role is a sales position, which fundamentally mismatches the candidate's engineering focus.
22:29:43 [138/138] Technical Support Engineer 2, Premier - EMEA @ Datadog
 ○22:29:43 ○ Not relevant (score: 2/10): The candidate is not suited for this sales role due to a fundamental category mismatch.
22:29:43 2 relevant jobs exceeded the daily budget (20). Kept the top 20 by score; dropped 2 scoring 6-6/10.
 ✓22:29:43 ✓ Relevant (score: 9/10): The internship at Cadence is a strong fit for the candidate's skills and preferences, particularly in ML and AI.
 ✓22:29:45 ✓ Posted: Intern - (System Verification Group) @ Cadence
 ✓22:29:45 ✓ Relevant (score: 8/10): While the apprenticeship aligns well with the candidate's skills and preferences, the geographic fit is a significant barrier.
 ✓22:29:46 ✓ Posted: Software Development Apprenticeship, Engineering, October 2026 Start @ Google
 ✓22:29:46 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the Python Developer role in a FinTech project.
 ✓22:29:48 ✓ Posted: Python Developer (Fast API / FinTech Project) @ Resourceful Talent Group
 ✓22:29:48 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Test Automation Engineer role due to relevant skills and experience.
 ✓22:29:49 ✓ Posted: Junior Python Engineer (Test Automation) - Cork, Ireland @ Qualcomm
 ✓22:29:49 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on relevant skills and experience.
 ✓22:29:51 ✓ Posted: Data Engineer @ K&K Talents
 ✓22:29:51 ✓ Relevant (score: 7/10): While the candidate has relevant skills, the geographic fit is a significant concern, impacting overall suitability.
 ✓22:29:52 ✓ Posted: Software Engineering Graduate - 12 month Fixed Term Contract @ Valeo
 ✓22:29:52 ✓ Relevant (score: 7/10): While the candidate fits well for the R&D Trainee role, the geographic fit is a significant concern.
 ✓22:29:53 ✓ Posted: Graduate - Software Engineer - 12 month FTC @ Valeo
 ✓22:29:53 ✓ Relevant (score: 7/10): The candidate has relevant skills and experience for the Full-Stack Developer role, making them a reasonable fit.
 ✓22:29:55 ✓ Posted: Full-Stack Developer @ Arup
 ✓22:29:55 ✓ Relevant (score: 7/10 [REACH]): While the candidate has strong skills, the mid-level seniority requirement does not align with their entry-level preference.
 ✓22:29:56 ✓ Posted: Python Developer - Back End (Jun/Mid level) @ Solas IT Recruitment
 ✓22:29:56 ✓ Relevant (score: 7/10 [REACH]): While the candidate has relevant skills, the seniority requirement exceeds their current experience level.
 ✓22:29:58 ✓ Posted: Senior Data Scraping Engineer (Python) @ Mindrift
 ✓22:29:58 ✓ Relevant (score: 6/10): The role is not aligned with the candidate's target positions in data and AI engineering, leading to a low overall fit.
 ✓22:29:59 ✓ Posted: Graduate Embedded Test Engineer (2026) @ MBRYONICS
 ✓22:29:59 ✓ Relevant (score: 6/10): While the candidate fits the entry-level criteria, the role's focus on software engineering diverges from their data-centric background, leading to a low overall match.
 ✓22:30:01 ✓ Posted: Associate Software Engineer (Ruby & React) @ Zendesk
 ✓22:30:01 ✓ Relevant (score: 6/10): The role is not a strong fit due to geographic mismatch and limited direct alignment with the candidate's target roles.
 ✓22:30:02 ✓ Posted: Software AI Engineering Graduate - 12 month Fixed Term Contract @ Valeo
 ✓22:30:02 ✓ Relevant (score: 6/10): The candidate's entry-level preference does not align with the seniority requirements of the Full Stack Engineer role.
 ✓22:30:03 ✓ Posted: Full Stack Engineer @ EXL Service
 ✓22:30:03 ✓ Relevant (score: 6/10): The candidate's entry-level preference and lack of required experience make this role a poor fit.
 ✓22:30:05 ✓ Posted: Full Stack Engineer @ EXL Service
 ✓22:30:05 ✓ Relevant (score: 6/10): The candidate's experience level does not meet the minimum requirement for this role, making it a poor fit.
 ✓22:30:06 ✓ Posted: Freelance Data Scraping Engineer (Python) @ Mindrift
 ✓22:30:06 ✓ Relevant (score: 6/10): The candidate's experience level does not align with the seniority requirements of the Full-Stack AI Engineer role.
 ✓22:30:08 ✓ Posted: Python Developer @ RECRUITERS
 ✓22:30:08 ✓ Relevant (score: 6/10): The role's seniority requirement exceeds the candidate's entry-level preference, leading to a poor overall fit.
 ✓22:30:09 ✓ Posted: Junior Full Stack Developer @ RWS Group
 ✓22:30:09 ✓ Relevant (score: 6/10): The candidate's experience level does not meet the requirements for the Full-Stack AI Engineer role.
 ✓22:30:11 ✓ Posted: Full Stack Engineer (Python, React, AI) @ Barden
 ✓22:30:11 ✓ Relevant (score: 6/10): The candidate's experience level does not meet the requirements for the Full-Stack AI Engineer role.
 ✓22:30:12 ✓ Posted: Full Stack AI Engineer @ Nicoll Curtin
22:30:12 Score distribution (out of 138): 9-10: 1 · 7-8: 9 · 5-6: 12 · 3-4: 88 · 0-2: 28
22:30:12 116 of 138 jobs (84%) were gate-capped at 4/10 (role_match or skills_alignment scored 1 — the job's function is fundamentally different from your target role).
>>>22:30:12 >>> Fetching resume profiles for role-type matching...
22:30:13 No resume profiles found — using default resume for all jobs
22:30:13 >>>
Phase 2: Tailoring top 10 of 20 relevant jobs (tailoring: HIGH 8/10, max: 10)...
>>>
22:30:13 [1/10] Intern - (System Verification Group) @ Cadence
22:30:13 Score: 9/10 — The internship at Cadence is a strong fit for the candidate's skills and preferences, particularly in ML and AI.
 ✓22:31:02 ✓ Resume customized
 ✓22:31:04 ✓ PDF generated (230KB)
 ✓22:31:07 ✓ PDF uploaded: DHANUSH_ARAVIND_INTERN_SYSTEM_VERIFICATION_GROUP_CADENCE_RESUME.pdf
 ⚠22:31:08 ⚠ CV Sync Check: 0% keyword match (0/1). Missing: ml
 ✓22:31:10 ✓ Resume, cover letter, and fit summary attached to tracker
22:31:12 [2/10] Software Development Apprenticeship, Engineering, October 2026 Start @ Google
22:31:12 Score: 8/10 — While the apprenticeship aligns well with the candidate's skills and preferences, the geographic fit is a significant barrier.
 ✓22:31:57 ✓ Resume customized
 ✓22:31:59 ✓ PDF generated (230KB)
 ✓22:32:02 ✓ PDF uploaded: DHANUSH_ARAVIND_SOFTWARE_DEVELOPMENT_APPRENTICESHIP_ENGINEERING_OCTOBER_2026_START_GOOGLE_RESUME.pdf
 ✓22:32:05 ✓ Resume, cover letter, and fit summary attached to tracker
22:32:07 [3/10] Python Developer (Fast API / FinTech Project) @ Resourceful Talent Group
22:32:07 Score: 8/10 — The candidate's skills and experience align well with the Python Developer role in a FinTech project.
 ✓22:32:39 ✓ Resume customized
 ✓22:32:41 ✓ PDF generated (230KB)
 ✓22:32:44 ✓ PDF uploaded: DHANUSH_ARAVIND_PYTHON_DEVELOPER_FAST_API_FINTECH_PROJECT_RESOURCEFUL_TALENT_GROUP_RESUME.pdf
 ⚠22:32:44 ⚠ CV Sync Check: 60% keyword match (3/5). Missing: react, mysql
 ✓22:32:47 ✓ Resume, cover letter, and fit summary attached to tracker
22:32:49 [4/10] Junior Python Engineer (Test Automation) - Cork, Ireland @ Qualcomm
22:32:49 Score: 8/10 — The candidate is a strong fit for the Test Automation Engineer role due to relevant skills and experience.
 ✓22:33:24 ✓ Resume customized
 ✓22:33:26 ✓ PDF generated (230KB)
 ✓22:33:29 ✓ PDF uploaded: DHANUSH_ARAVIND_JUNIOR_PYTHON_ENGINEER_TEST_AUTOMATION_CORK_IRELAND_QUALCOMM_RESUME.pdf
 ✓22:33:30 ✓ CV Sync Check: 80% keyword match (8/10)
 ✓22:33:33 ✓ Resume, cover letter, and fit summary attached to tracker
22:33:35 [5/10] Data Engineer @ K&K Talents
22:33:35 Score: 8/10 — The candidate is a strong fit for the Data Engineer role based on relevant skills and experience.
 ✓22:34:13 ✓ Resume customized
 ✓22:34:15 ✓ PDF generated (230KB)
 ✓22:34:18 ✓ PDF uploaded: DHANUSH_ARAVIND_DATA_ENGINEER_K_K_TALENTS_RESUME.pdf
 ✓22:34:19 ✓ CV Sync Check: 71% keyword match (5/7)
 ✓22:34:22 ✓ Resume, cover letter, and fit summary attached to tracker
22:34:24 [6/10] Software Engineering Graduate - 12 month Fixed Term Contract @ Valeo
22:34:24 Score: 7/10 — While the candidate has relevant skills, the geographic fit is a significant concern, impacting overall suitability.
 ✓22:34:56 ✓ Resume customized
 ✓22:34:59 ✓ PDF generated (231KB)
 ✓22:35:02 ✓ PDF uploaded: DHANUSH_ARAVIND_SOFTWARE_ENGINEERING_GRADUATE_12_MONTH_FIXED_TERM_CONTRACT_VALEO_RESUME.pdf
 ⚠22:35:02 ⚠ CV Sync Check: 50% keyword match (1/2). Missing: linux
 ✓22:35:05 ✓ Resume, cover letter, and fit summary attached to tracker
22:35:07 [7/10] Graduate - Software Engineer - 12 month FTC @ Valeo
22:35:07 Score: 7/10 — While the candidate fits well for the R&D Trainee role, the geographic fit is a significant concern.
 ✓22:35:39 ✓ Resume customized
 ✓22:35:42 ✓ PDF generated (231KB)
 ✓22:35:45 ✓ PDF uploaded: DHANUSH_ARAVIND_GRADUATE_SOFTWARE_ENGINEER_12_MONTH_FTC_VALEO_RESUME.pdf
 ✓22:35:45 ✓ CV Sync Check: 100% keyword match (1/1)
 ✓22:35:48 ✓ Resume, cover letter, and fit summary attached to tracker
22:35:50 [8/10] Full-Stack Developer @ Arup
22:35:50 Score: 7/10 — The candidate has relevant skills and experience for the Full-Stack Developer role, making them a reasonable fit.
 ✓22:36:19 ✓ Resume customized
 ✓22:36:21 ✓ PDF generated (231KB)
 ✓22:36:24 ✓ PDF uploaded: DHANUSH_ARAVIND_FULL_STACK_DEVELOPER_ARUP_RESUME.pdf
 ✓22:36:25 ✓ CV Sync Check: 80% keyword match (8/10)
 ✓22:36:28 ✓ Resume, cover letter, and fit summary attached to tracker
22:36:30 [9/10] Python Developer - Back End (Jun/Mid level) @ Solas IT Recruitment
22:36:30 Score: 7/10 — While the candidate has strong skills, the mid-level seniority requirement does not align with their entry-level preference.
 ✓22:37:01 ✓ Resume customized
 ✓22:37:03 ✓ PDF generated (228KB)
 ✓22:37:06 ✓ PDF uploaded: DHANUSH_ARAVIND_PYTHON_DEVELOPER_BACK_END_JUN_MID_LEVEL_SOLAS_IT_RECRUITMENT_RESUME.pdf
 ✓22:37:06 ✓ CV Sync Check: 86% keyword match (6/7)
 ✓22:37:09 ✓ Resume, cover letter, and fit summary attached to tracker
22:37:11 [10/10] Senior Data Scraping Engineer (Python) @ Mindrift
22:37:11 Score: 7/10 — While the candidate has relevant skills, the seniority requirement exceeds their current experience level.
 ✓22:37:47 ✓ Resume customized
 ✓22:37:49 ✓ PDF generated (230KB)
 ✓22:37:52 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_DATA_SCRAPING_ENGINEER_PYTHON_MINDRIFT_RESUME.pdf
 ⚠22:37:52 ⚠ CV Sync Check: 67% keyword match (2/3). Missing: javascript
 ✓22:37:55 ✓ Resume, cover letter, and fit summary attached to tracker
22:37:55 Pipeline completed in 16.9 minutes
═══ Pipeline Summary ═══
>>>
Scraped: 50 jobs from all sources
Location: 138 in target regions
Relevant: 20 passed AI filter (all posted to tracker)
Tailored: 10 top-N resumes + cover letters
Applied: 10 fully processed
Skipped: 5 (duplicates)
Errors: 0
 ✓22:38:03 ✓ Skills snapshot saved
Pipeline complete