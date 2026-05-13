started
>>>Initializing pipeline...
╔══════════════════════════════════════════╗
║ Job Automation Pipeline ║
╚══════════════════════════════════════════╝
09:00:01 ✓ Configuration validated
09:00:01 >>> Expanding role keywords to catch synonymous titles...
09:00:05 Keyword expansion: "ai engineer, python developer, data engineer, ai analyst, data analyst, graduate, Junior Data, ml engineer" → 17 titles (ai engineer, python developer, data engineer, ai analyst, data analyst, graduate...)
09:00:05 >>> Scraping source (target 50 relevant → requesting 125 raw, 2.5× over-scrape)...
09:00:05 Starting source source scraper...
09:00:05 Search URL: [search url]
09:00:05 Requesting 125 jobs from source
09:00:06 Actor run started (ID: Hgj0TJPF29678kmLb)
09:00:17 Scraping in progress... (10s elapsed, status: RUNNING)
09:00:28 Scraping in progress... (20s elapsed, status: RUNNING)
09:00:39 Scraping in progress... (30s elapsed, status: RUNNING)
09:00:50 Scraping in progress... (40s elapsed, status: RUNNING)
09:01:01 Scraping in progress... (50s elapsed, status: RUNNING)
09:01:12 Scraping in progress... (60s elapsed, status: RUNNING)
09:01:23 Scraping in progress... (70s elapsed, status: SUCCEEDED)
09:01:23 ✓ Scraping complete, fetching results...
09:01:24 [debug] First item location-related keys: ["location","workplaceTypes","country"]
09:01:24 [debug] First item location value: "Dublin 4, County Dublin, Ireland"
09:01:24 ✓ source: 70 jobs
09:01:24 >>> Scraping other job boards...
09:01:24 >>> Scraping source for keywords: ai engineer, python developer, data engineer, ai analyst, data analyst...
09:01:24 Target countries: ireland
09:01:24 source: fanning out across 3 keyword(s) @ 21 jobs each
09:01:24 Starting source source[ai engineer] scraper (valig~source-jobs-scraper)...
09:01:24 Starting source source[python developer] scraper (valig~source-jobs-scraper)...
09:01:24 Starting source source[data engineer] scraper (valig~source-jobs-scraper)...
09:01:24 Truefetch: fanning out across 3 keyword(s) @ 21 jobs each
09:01:24 Starting source Truefetch[ai engineer] scraper (truefetch~best-job-listing)...
09:01:24 Starting source Truefetch[python developer] scraper (truefetch~best-job-listing)...
09:01:24 Starting source Truefetch[data engineer] scraper (truefetch~best-job-listing)...
09:01:24 Aggregator enabled (multi-source)
09:01:24 source skipped (india not in TARGET_COUNTRIES)
09:01:24 source[ai engineer] run started (ID: o8BdVUO3oZ12jSGQl)
09:01:25 Truefetch[ai engineer] run started (ID: B8hH6cpaidvkMy8TV)
09:01:25 source[data engineer] run started (ID: XPTZQLm6Xbnyz5tFc)
09:01:25 source[python developer] run started (ID: RGqImLDwHcQ7jgVyq)
09:01:25 Truefetch[data engineer] run started (ID: DGZGOnDu5soAzyHev)
09:01:25 Truefetch[python developer] run started (ID: 2NT90QUYMfOx5ggdS)
09:01:35 source[ai engineer] scraping... (10s elapsed, status: SUCCEEDED)
09:01:36 Truefetch[ai engineer] scraping... (10s elapsed, status: RUNNING)
09:01:36 source[data engineer] scraping... (10s elapsed, status: SUCCEEDED)
09:01:36 source[python developer] scraping... (10s elapsed, status: SUCCEEDED)
09:01:36 Truefetch[data engineer] scraping... (10s elapsed, status: RUNNING)
09:01:36 Truefetch[python developer] scraping... (10s elapsed, status: RUNNING)
09:01:36 ✓ source[data engineer]: 21 raw items
09:01:36 ✓ source[python developer]: 21 raw items
09:01:36 ✓ source[ai engineer]: 21 raw items
09:01:36 source: 45 unique jobs after inline dedup
09:01:47 Truefetch[ai engineer] scraping... (20s elapsed, status: RUNNING)
09:01:47 Truefetch[data engineer] scraping... (20s elapsed, status: RUNNING)
09:01:47 Truefetch[python developer] scraping... (20s elapsed, status: RUNNING)
09:01:57 Truefetch[ai engineer] scraping... (30s elapsed, status: RUNNING)
09:01:57 Truefetch[data engineer] scraping... (30s elapsed, status: RUNNING)
09:01:58 Truefetch[python developer] scraping... (30s elapsed, status: RUNNING)
09:02:08 Truefetch[ai engineer] scraping... (40s elapsed, status: RUNNING)
09:02:08 Truefetch[data engineer] scraping... (40s elapsed, status: RUNNING)
09:02:08 Truefetch[python developer] scraping... (40s elapsed, status: RUNNING)
09:02:19 Truefetch[ai engineer] scraping... (50s elapsed, status: RUNNING)
09:02:19 Truefetch[data engineer] scraping... (50s elapsed, status: RUNNING)
09:02:19 Truefetch[python developer] scraping... (50s elapsed, status: RUNNING)
09:02:30 Truefetch[ai engineer] scraping... (60s elapsed, status: RUNNING)
09:02:30 Truefetch[data engineer] scraping... (60s elapsed, status: RUNNING)
09:02:30 Truefetch[python developer] scraping... (60s elapsed, status: RUNNING)
09:02:41 Truefetch[data engineer] scraping... (70s elapsed, status: RUNNING)
09:02:41 Truefetch[ai engineer] scraping... (70s elapsed, status: RUNNING)
09:02:41 Truefetch[python developer] scraping... (70s elapsed, status: RUNNING)
09:02:52 Truefetch[data engineer] scraping... (80s elapsed, status: RUNNING)
09:02:52 Truefetch[ai engineer] scraping... (80s elapsed, status: RUNNING)
09:02:52 Truefetch[python developer] scraping... (80s elapsed, status: RUNNING)
09:03:03 Truefetch[ai engineer] scraping... (90s elapsed, status: RUNNING)
09:03:03 Truefetch[data engineer] scraping... (90s elapsed, status: RUNNING)
09:03:03 Truefetch[python developer] scraping... (90s elapsed, status: RUNNING)
09:03:14 Truefetch[data engineer] scraping... (100s elapsed, status: RUNNING)
09:03:14 Truefetch[ai engineer] scraping... (100s elapsed, status: RUNNING)
09:03:14 Truefetch[python developer] scraping... (100s elapsed, status: SUCCEEDED)
09:03:15 ✓ Truefetch[python developer]: 30 raw items
09:03:25 Truefetch[data engineer] scraping... (110s elapsed, status: SUCCEEDED)
09:03:25 Truefetch[ai engineer] scraping... (110s elapsed, status: RUNNING)
09:03:26 ✓ Truefetch[data engineer]: 63 raw items
09:03:36 Truefetch[ai engineer] scraping... (120s elapsed, status: RUNNING)
09:03:47 Truefetch[ai engineer] scraping... (130s elapsed, status: RUNNING)
09:03:57 Truefetch[ai engineer] scraping... (140s elapsed, status: RUNNING)
09:04:08 Truefetch[ai engineer] scraping... (150s elapsed, status: SUCCEEDED)
09:04:09 ✓ Truefetch[ai engineer]: 63 raw items
09:04:09 Truefetch: 128 unique jobs after inline dedup
09:04:09 source: 45 jobs
09:04:09 Aggregator: 128 jobs
09:04:09 ✓ Other-board scrapers: 173 raw → 171 unique jobs
09:04:09 ✓ Other boards: 171 unique jobs (post-dedup within source group)
09:04:09 >>> Scanning company careers portals...
09:04:10 [PortalScanner] Scanning 20 target company portals...
09:04:10 [PortalScanner] Adobe: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:10 ⚠ [PortalScanner] Airbnb: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "airbnb" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:11 ✓ [PortalScanner] Airbnb: 235 relevant jobs found
09:04:13 [PortalScanner] Amazon: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:13 [PortalScanner] Apple: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:13 ⚠ [PortalScanner] Atlassian: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "atlassian" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:13 [PortalScanner] Atlassian: 0 matching jobs
09:04:15 ⚠ [PortalScanner] Cloudflare: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "cloudflare" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:15 ✓ [PortalScanner] Cloudflare: 196 relevant jobs found
09:04:17 ⚠ [PortalScanner] Datadog: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "datadog" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:17 ✓ [PortalScanner] Datadog: 412 relevant jobs found
09:04:19 ⚠ [PortalScanner] Figma: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "figma" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:19 ✓ [PortalScanner] Figma: 157 relevant jobs found
09:04:21 [PortalScanner] Google: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:21 ⚠ [PortalScanner] HubSpot: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "hubspot" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:21 [PortalScanner] HubSpot: 0 matching jobs
09:04:23 ⚠ [PortalScanner] Linear: careers_url "[search url]" doesn't look like a ashby ATS endpoint. Guessing slug = "linear" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:23 [PortalScanner] Linear: 0 matching jobs
09:04:25 [PortalScanner] Meta: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:25 [PortalScanner] Microsoft: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:25 ⚠ [PortalScanner] Netflix: careers_url "[search url]" doesn't look like a lever ATS endpoint. Guessing slug = "netflix" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:25 [PortalScanner] Netflix: 0 matching jobs
09:04:27 ⚠ [PortalScanner] Notion: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "notion" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:27 [PortalScanner] Notion: 0 matching jobs
09:04:29 [PortalScanner] Salesforce: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:29 ⚠ [PortalScanner] Shopify: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "shopify" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:29 [PortalScanner] Shopify: 0 matching jobs
09:04:31 ⚠ [PortalScanner] Spotify: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "spotify" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:31 [PortalScanner] Spotify: 0 matching jobs
09:04:33 [PortalScanner] Stripe: ats_type="custom" — no public API, skipped. (It's still useful as a source focus filter.) If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.
09:04:33 ⚠ [PortalScanner] Vercel: careers_url "[search url]" doesn't look like a greenhouse ATS endpoint. Guessing slug = "vercel" from company name. If this is wrong, update the careers_url to e.g. [search url]<real-slug>.
09:04:33 ✓ [PortalScanner] Vercel: 80 relevant jobs found
09:04:35 ✓ Company Careers: 1080 jobs
09:04:35 Scrape source breakdown:
09:04:35 source 44 jobs
09:04:35 Aggregator 127 jobs
09:04:35 Company Careers 1080 jobs
09:04:35 unknown 70 jobs
09:04:35 Total raw 1321 jobs (before dedup across sources)
09:04:35 ✓ Merged total: 827 fresh jobs (1301 raw, 474 older than 14 days dropped)
09:04:35 >>> Checking for duplicates against tracker (kanban dashboard)...
>>>09:04:35 >>> Checking for duplicates against tracker (kanban dashboard)...
09:04:37 ○ ↩ "AI Research Engineer/Scientist (OpenVINO, NNCF)" @ Intel Corporation (already in kanban, matched by url)
09:04:37 ○ ↩ "Test Automation Engineer" @ Acuity Inc. (already in kanban, matched by url)
09:04:37 ✓ 825 new jobs (2 duplicates filtered against kanban before AI scoring)
09:04:37 ⚠ Job archive failed: HTTP 413 {"error":"Request body too large."}
09:04:38 JobsExpo: 14 events found
09:04:47 Meetup (ireland): 25 tech events found
09:04:52 TechMeetups: 5 events found (cities: dublin, cork, galway)
09:04:52 Extra event sources for ireland: 29 total
09:05:13 Eventbrite: 472 events found for keywords [ai engineer, python developer, data engineer]
09:05:39 ✓ Career events for ireland: 67 scraped, 14 new
09:05:39 >>> Filtering by location (per TARGET_COUNTRIES / LOCATION_REGIONS)...
>>>09:05:39 >>> Filtering by location (per TARGET_COUNTRIES / LOCATION_REGIONS)...
09:05:39 [debug] Sample location values: ["Dublin 4, County Dublin, Ireland","County Dublin, Ireland","Dublin, County Dublin, Ireland","Dublin, County Dublin, Ireland","Galway, County Galway, Ireland"]
09:05:39 [dropped] "Ascentic Ignition | Engineering Internship Program" @ "Ascentic" — no country match: "LK, IE"
09:05:39 [dropped] "Artificial Intelligence Engineer" @ "Fruition Group Ireland" — no country match: ""
09:05:39 [dropped] "AI Research Engineer - Reinforcement Learning" @ "Jobgether" — no country match: ""
09:05:39 [dropped] "Senior AI Engineer" @ "TechHeads - USA" — no country match: ""
09:05:39 [dropped] "Software Engineer (AI)" @ "Tines" — no country match: ""
09:05:39 [dropped] "DevOps Engineer (Automation Systems) - Freelance AI Trainer" @ "Mindrift" — no country match: ""
09:05:39 [dropped] "ML Infrastructure Engineer" @ "Jobgether" — no country match: ""
09:05:39 [dropped] "Python Software Engineer (Mid to Senior) – Backend Focus" @ "Solas IT Recruitment" — no country match: ""
09:05:39 [dropped] "Senior Software Engineer" @ "GxP Recruitment" — no country match: ""
09:05:39 [dropped] "Low-Code Automation Engineer - Freelance AI Trainer" @ "Mindrift" — no country match: ""
09:05:39 [dropped] "Staff Machine Learning Engineer - Recommendations, Quora (Remote)" @ "Quora" — no country match: ""
09:05:39 [dropped] "Senior Software Engineer (Salesforce)" @ "Jobgether" — no country match: ""
09:05:39 [dropped] "Full Stack Engineer" @ "Fruition Group Ireland" — no country match: ""
09:05:39 [dropped] "Senior FullStack eCommerce Developer" @ "Stelfox Tech Recruitment" — no country match: ""
09:05:39 [dropped] "Backend Engineer, Node.js/TypeScript" @ "Jobgether" — no country match: ""
09:05:39 554 total jobs dropped (outside ireland or restricted remote)
09:05:39 ✓ 271 jobs in target locations (filtered out 554)
09:05:39 >>> Fetching uploaded resume from tracker...
>>>09:05:39 >>> Fetching uploaded resume from tracker...
09:05:40 ✓ Resume loaded (3887 chars)
09:05:40 ✓ PDF generation: using local server (no warm-up needed)
09:05:40 >>> Phase 1: Scoring 271 jobs (target: 50 relevant after filter, threshold: >= 5, concurrency: 8)...
>>>09:05:40 >>> Phase 1: Scoring 271 jobs (target: 50 relevant after filter, threshold: >= 5, concurrency: 8)...
09:05:45 [1/271] Principal Engineer @ Hadfield Green
09:05:45 ○ Not relevant (score: 4/10): The candidate is not a fit due to significant mismatches in role, skills, and experience level.
09:05:45 [2/271] Data Labelling Analyst @ RECRUITERS
09:05:46 [3/271] Senior Data Scientist / AI Consultant – Security & Risk Analytics @ Solas IT Recruitment
09:05:46 [4/271] Senior Machine Learning Engineer/Researcher (Multimodal) @ Morgan McKinley
09:05:46 ○ Not relevant (score: 4/10): The candidate's experience and seniority do not align with the requirements for this senior role.
09:05:46 [5/271] PowerBI Data Engineer @ Fruition Group Ireland
09:05:46 [6/271] PhD position in Quantum AI for Digital Transformation @ UCD School of Computer Science
09:05:46 [7/271] Vice President, Data Scientist @ BNY
09:05:46 ○ Not relevant (score: 4/10): The candidate's entry-level status and lack of required experience make them a poor fit for this senior role.
09:05:50 [8/271] Senior Python Developer @ Cpl Technology Contractor Solutions
09:05:50 [9/271] Data Labelling Analyst – Integrity Harms @ RECRUITERS
09:05:50 [10/271] Junior Technical Analyst @ Grant Thornton Ireland
09:05:51 [11/271] Data Architect – Azure @ Methodius IT Recruitment
09:05:51 [12/271] Product Engineer @ Attio
09:05:51 [13/271] Senior Software Engineer @ GxP Recruitment
09:05:51 ○ Not relevant (score: 4/10): The candidate's experience and skills do not align with the seniority and requirements of the role.
09:05:51 [14/271] Foundry R&D Software Engineer II @ Mastercard
09:05:51 [15/271] Technical Solutions Engineer @ Protex AI
09:05:55 [16/271] Engineering Team Lead - AI Start Up @ MCS Group | Your Specialist Recruitment Consultancy
09:05:55 ○ Not relevant (score: 4/10): The candidate's profile does not align with the leadership and experience requirements of the role.
09:05:56 [17/271] Senior Data Engineer @ Archer Recruitment
09:05:56 ○ Not relevant (score: 4/10): The candidate's experience level does not match the seniority required for this role.
09:05:56 [18/271] Software Engineer - Go @ Paddle
09:05:56 [19/271] Environmental Engineering - AI Data Trainer @ Alignerr
09:05:56 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the environmental engineering focus of the role.
09:05:56 [20/271] Staff Forward Deployed Engineer @ Intercom
09:05:56 [21/271] Systems Development Engineer, Amazon Foundational Security Services @ Amazon
09:05:57 [22/271] Backend Engineer/API, Payments and Risk @ Stripe
09:05:57 [23/271] Software Engineer, Payments and Risk @ Stripe
09:06:00 [24/271] Engineering Lead @ Accenture UK & Ireland
09:06:00 ○ Not relevant (score: 4/10): The candidate's experience and role preference do not align with the requirements of the Engineering Lead position.
09:06:00 [25/271] Engineering Manager - Amplify C.S @ Klaviyo
09:06:00 ○ Not relevant (score: 4/10): The candidate's profile does not match the leadership requirements of the Engineering Manager role.
09:06:01 [26/271] Software Engineer - SONiC @ Arista Networks
09:06:01 [27/271] Software Engineer - Developer Experience @ Paddle
09:06:01 [28/271] Remote Senior Software Engineer – LLM Evaluation (US-based) @ Turing
09:06:01 [29/271] Senior Data Engineer @ Rithum
09:06:02 [30/271] Software Development Engineer @ AMD
09:06:02 [31/271] Senior Software Engineer - AI Focus @ Kneat Solutions
09:06:02 ○ Not relevant (score: 4/10): The candidate's entry-level preference and experience do not align with the seniority required for this role.
09:06:05 [32/271] AI Data Specialist - Irish Gaelic @ RWS Group
09:06:05 [33/271] Staff AI /ML Robotics Engineer - Environmental Perception @ Analog Devices
09:06:05 ○ Not relevant (score: 4/10): The candidate's experience and skills do not align with the advanced requirements of the role.
09:06:06 [34/271] AI Research Engineer - Reinforcement Learning @ Jobgether
09:06:06 [35/271] Databricks SQL Python Senior Analytical Engineer @ Atrium (EMEA)
09:06:06 [36/271] Senior AI Engineer @ Cpl Technology - Tech Recruitment Experts
09:06:07 [37/271] Founding Engineer, n8n Labs @ n8n
09:06:10 [38/271] Senior Data Engineer @ Amach
09:06:10 [39/271] Lead Software Engineer @ nineDots.io
09:06:11 [40/271] Computer Engineering @ Alignerr
09:06:11 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the advanced requirements of the role.
09:06:11 [41/271] Senior Machine Learning Engineer @ MCS Group | Your Specialist Recruitment Consultancy
09:06:11 [42/271] Remote Software Developer @ Turing
09:06:12 [43/271] Python Developer @ Harvey Nash
09:06:12 [44/271] Automation Engineer II, Falcon Complete (Remote) @ CrowdStrike
09:06:12 [45/271] Junior Software Engineer @ Quest Software
09:06:15 [46/271] Senior AI Engineer @ TechHeads - USA
09:06:15 [47/271] Senior Software Engineer (Python) @ Telnyx
09:06:16 [48/271] Artificial Intelligence Engineer @ Fruition Group Ireland
09:06:16 [49/271] 🚨Artificial Intelligence Architect - Fintech up to €140k🚨 @ We Source Talent
09:06:17 [50/271] Python Software Engineer (Mid to Senior) – Backend Focus @ Solas IT Recruitment
09:06:18 [51/271] Senior Software Engineer - AI Fintech foundation (Ireland) @ Hopper
09:06:18 [52/271] Software Engineer, Reporting & Insights @ Muck Rack
09:06:19 [53/271] Full Stack Engineer @ Mason Alexander
09:06:20 [54/271] Staff Machine Learning Engineer - Recommendations, Quora (Remote) @ Quora
09:06:21 [55/271] Artificial Intelligence Engineer @ Morgan McKinley
09:06:21 [56/271] AI Python Engineer Contract Dublin 6-18 Months @ Adecco
09:06:21 [57/271] Software Engineer (AI) @ Tines
09:06:22 [58/271] Workforce Planning & Business Analyst @ Ryanair - Europe's Favourite Airline
09:06:23 [59/271] Software Engineer @ nineDots.io
09:06:24 [60/271] Graduate Veterinary Nurse - Small Animal @ IVC Evidensia
09:06:24 ○ Not relevant (score: 4/10): The candidate's skills and experience are not relevant to the veterinary nursing role.
09:06:25 [61/271] School Meals Worker (Distributor) - Griffith Barracks Multi D School 20012S @ The Lunch Bag
09:06:25 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for this role.
09:06:25 [62/271] Architectural Technician @ AtkinsRéalis
09:06:25 ○ Not relevant (score: 4/10): The candidate's background and skills do not align with the requirements for the Architectural Technician role.
09:06:26 [63/271] Success Factors Analyst @ Mercury
09:06:26 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the SAP SuccessFactors Analyst role.
09:06:26 [64/271] Assistant / Graduate Quantity Surveyor – Rail @ AtkinsRéalis
09:06:26 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not match the requirements for a Quantity Surveyor position.
09:06:27 [65/271] Commercial Sales and Planning Graduate @ Dawn Meats
09:06:27 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the commercial sales and planning position.
09:06:27 [66/271] Health Policy & Management @ Alignerr
09:06:27 ○ Not relevant (score: 4/10): The candidate's qualifications do not align with the advanced public health requirements of the role.
09:06:28 [67/271] Traffic Engineer (Transportation Designer Engineer III) @ Maryland Department of Transportation
09:06:28 ○ Not relevant (score: 4/10): The candidate's background and target roles are not aligned with the traffic engineering position.
09:06:29 [68/271] Graduate Veterinary Nurse - Small Animal @ IVC Evidensia UK
09:06:29 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the veterinary nursing position.
09:06:30 [69/271] ML Infrastructure Engineer @ Jobgether
09:06:30 [70/271] Hardware Solutions Engineer @ Amax Engineering
09:06:30 ○ Not relevant (score: 3/10): The candidate's skills and experience do not align with the hardware-focused requirements of this role.
09:06:31 [71/271] Senior Product Designer (UX/UI) @ Learnosity
09:06:31 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the Product Designer role.
09:06:32 [72/271] Commissioning Engineer @ SER (Staffing) Limited
09:06:32 ○ Not relevant (score: 4/10): The candidate's background and skills do not align with the requirements of the commissioning engineer role.
09:06:32 [73/271] Ascentic Ignition | Engineering Internship Program @ Ascentic
09:06:32 [74/271] Lead AI Automation Engineer @ M-KOPA
09:06:33 [75/271] Network Dev Engineer II, ONE Access Engineering (LAN) @ Amazon Ireland Support Services Limited
09:06:33 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the network engineering focus of the role.
09:06:34 [76/271] Staff Software Engineer - Client Apps @ Dolby
09:06:34 ○ Not relevant (score: 4/10): The candidate's profile does not align with the seniority and specific skills required for this role.
09:06:36 [77/271] Principal Engineer – Galway, Ireland (Hybrid ) @ Hadfield Green
09:06:36 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the advanced requirements of the role.
09:06:37 [78/271] IT Operations Engineer @ Distilled
09:06:37 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the IT Operations Engineer role, leading to a low overall fit.
09:06:37 [79/271] Sr. Technical Writer, Selling Partner Developer Services @ Amazon Ireland Support Services Limited - A94
09:06:37 ○ Not relevant (score: 4/10): The candidate's background and skills do not align with the technical writing requirements of the role.
09:06:37 [80/271] TECHNOLOGY ARCHITECT L1(CONTRACT) @ Wipro Limited
09:06:38 [81/271] Senior Software Engineer-Typescript @ Liberty Information Technology
09:06:39 [82/271] Engineering Lead @ Accenture
09:06:39 ○ Not relevant (score: 4/10): The candidate's profile does not align with the seniority and role requirements of the Engineering Lead position.
09:06:40 [83/271] Senior Advisor, Data Science - Machine Learning Engineer @ Dell Technologies
09:06:42 [84/271] Senior Platform Engineer @ Sitecore
09:06:42 ○ Not relevant (score: 4/10): The candidate's profile does not match the requirements for the senior platform engineer role.
09:06:42 [85/271] Senior Process Development Engineer @ Boston Scientific
09:06:42 ○ Not relevant (score: 4/10): The candidate is not a fit for this highly specialized engineering role in medical devices.
09:06:42 [86/271] Solutions Marketing Manager (PostgreSQL) @ Percona
09:06:42 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of a product marketing role.
09:06:43 [87/271] Senior Software Engineer-Typescript @ Liberty IT
09:06:44 [88/271] Senior Manager Data Architecture and AI @ Aptiv plc
09:06:44 ○ Not relevant (score: 4/10): The candidate's experience and role preference do not align with the seniority and requirements of the position.
09:06:45 [89/271] Foundry R&D Software Engineer II @ Mastercard
09:06:46 [90/271] Hardware Solutions Engineer @ AMAX
09:06:46 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the hardware-focused role requirements.
09:06:47 [91/271] Staff Software Engineer, Global Network Technology @ Google
09:06:47 ○ Not relevant (score: 4/10): The candidate is not a fit for this senior-level engineering role due to significant gaps in experience and role alignment.
09:06:47 [92/271] Director, Community Marketing @ Bentley Systems
09:06:47 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of a senior community marketing role.
09:06:47 [93/271] SAP Developer - Remote @ BLP Digital AG
09:06:47 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for the SAP Developer role.
09:06:48 [94/271] Process Engineer @ J&J
09:06:48 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements of the Project Engineer position.
09:06:49 [95/271] Systems Development Engineer, Amazon Foundational Security Services @ Amazon Development Centre Ireland Limited
09:06:50 [96/271] Network Development Engineer, GCNA Deployment, AWS Networking @ Amazon Web Services
09:06:50 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of a Network Engineer role.
09:06:50 [97/271] Senior Electrical Project Engineer – Building Services & Data Centre Projects @ Breagh Recruitment
09:06:50 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the electrical engineering role.
09:06:51 [98/271] Electrical Project Engineer @ Keldin Engineering
09:06:51 ○ Not relevant (score: 4/10): The candidate's background and target roles do not align with the requirements of the electrical engineering position.
09:06:54 [99/271] Mechanical Quality Engineer @ Fohntech Group
09:06:54 ○ Not relevant (score: 3/10): The candidate is not a fit for this mechanical engineering role due to a lack of relevant experience and skills.
09:06:54 [100/271] Quality Engineer @ Sanmina Corporation
09:06:54 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements of the Quality Engineer position.
09:06:56 [101/271] Mechanical Quality Engineer @ Fohntech Group
09:06:56 ○ Not relevant (score: 3/10): The candidate's profile does not align with the mechanical engineering and quality assurance requirements of this role.
09:06:56 [102/271] Mechanical Quality Engineer @ Fohntech Group
09:06:56 ○ Not relevant (score: 3/10): The candidate's profile does not match the requirements of the Mechanical Quality Engineer role.
09:06:57 [103/271] Senior Systems Engineer - West Dublin (DT18656) @ ICDS Recruitment Consultants
09:06:57 ○ Not relevant (score: 4/10): The candidate is not a fit for this senior systems engineering role due to significant experience and role mismatches.
09:06:57 [104/271] OEM Apprentice @ Tanco Autowrap Ltd
09:06:57 ○ Not relevant (score: 4/10): The candidate's skills and experience do not match the requirements of the OEM engineering role.
09:06:57 [105/271] Water Process Design Engineer - Water & Wastewater Infrastructure Projects @ Breagh Recruitment
09:06:57 ○ Not relevant (score: 4/10): The candidate is not a fit for this role due to a complete mismatch in field and seniority level.
09:06:59 [106/271] Site Engineer @ Brightpath Recruitment
09:06:59 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for a Site Engineer role.
09:06:59 [107/271] Senior Electrical Engineer – Water Treatment & Critical Infrastructure Projects @ Breagh Recruitment
09:06:59 ○ Not relevant (score: 4/10): The candidate's profile does not align with the requirements for the Senior Electrical Engineer position.
09:07:00 [108/271] Experienced Power System Engineer @ Premium Power Ltd.
09:07:00 ○ Not relevant (score: 4/10): The candidate's background and preferences do not align with the requirements of the power systems engineering role.
09:07:01 [109/271] Intermediate Electrical Engineer - M&E Design Consultancy - Dublin @ SSA Recruitment Ireland
09:07:01 ○ Not relevant (score: 4/10): The candidate's background and target roles are not aligned with the electrical engineering position.
09:07:02 [110/271] Junior Electrical Engineer - M&E Consultancy - Dublin @ SSA Recruitment Ireland
09:07:02 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the electrical engineering role.
09:07:02 [111/271] Project Coordinator @ Staffline Recruitment Ireland
09:07:02 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements of a Project Coordinator position.
09:07:02 [112/271] Construction and Development Operations Manager @ Building Futures
09:07:02 ○ Not relevant (score: 4/10): The candidate's background and preferences do not align with the requirements of the construction operations manager role.
09:07:04 [113/271] Full Stack Developer @ RWS Group
09:07:04 [114/271] Senior Site Reliability Engineer @ Mastercard
09:07:04 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the Senior Site Reliability Engineer role.
09:07:04 [115/271] Graduate Electrical Engineer @ Premium Power Ltd.
09:07:04 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements for a Power Systems Engineer.
09:07:05 [116/271] Foundry R&D Software Engineer II @ Mastercard
09:07:06 [117/271] Senior Software Engineer-Typescript @ Liberty Information Technology
09:07:07 [118/271] IT Operations Engineer @ Distilled
09:07:07 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the IT Operations Engineer position.
09:07:07 [119/271] Senior Software Engineer, P2020 @ Google
09:07:07 ○ Not relevant (score: 4/10): The candidate's experience and skills do not align with the extensive requirements of the role.
09:07:08 [120/271] TECHNOLOGY ARCHITECT L1(CONTRACT) @ Wipro Ireland
09:07:09 [121/271] Senior Platform Engineer @ Sitecore
09:07:09 ○ Not relevant (score: 4/10): The candidate's profile does not match the senior platform engineering role requirements.
09:07:09 [122/271] Ascentic Ignition | Engineering Internship Program @ Ascentic
09:07:09 [123/271] Solutions Marketing Manager (PostgreSQL) @ Percona
09:07:09 ○ Not relevant (score: 4/10): The candidate's profile does not align with the product marketing role, which requires different skills and experience.
09:07:12 [124/271] SAP Developer - Remote @ BLP Digital AG
09:07:12 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for the SAP Developer role.
09:07:12 [125/271] Lead AI Automation Engineer @ m-kopa
09:07:13 [126/271] Director, Community Marketing @ Bentley Systems
09:07:13 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the community marketing focus of this role.
09:07:13 [127/271] Senior Advisor, Data Science - Machine Learning Engineer @ Dell Technologies
09:07:14 [128/271] Systems Development Engineer, Amazon Foundational Security Services @ Amazon.com
09:07:14 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the security engineering focus of this position.
09:07:15 [129/271] Software Engineer Associate @ Acuity Inc.
09:07:16 [130/271] Staff Software Engineer, Global Network Technology @ Google
09:07:16 ○ Not relevant (score: 4/10): The candidate does not meet the experience requirements for this senior role.
09:07:17 [131/271] Product Security Engineer - Vulnerability Management Research and Automation - Cork, Ireland @ Qualcomm
09:07:17 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements of a Product Security Engineer.
09:07:17 [132/271] Software Engineer III, Google Compute Engine, Fleet Management @ Google
09:07:18 [133/271] Full Stack Developer @ ES Talent Management
09:07:18 [134/271] Lead Technical Writer @ Analog Devices
09:07:18 ○ Not relevant (score: 4/10): The candidate's profile is not aligned with the technical writing role and its requirements.
09:07:19 [135/271] Senior Backend Software Engineer @ Horizon Quantum Computing
09:07:19 [136/271] Graduate Embedded Test Engineer (2026) @ MBRYONICS
09:07:19 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the embedded testing position.
09:07:21 [137/271] Senior Process Engineer @ Dexcom
09:07:21 ○ Not relevant (score: 4/10): The candidate's skills and experience do not match the requirements for the Senior Process Engineer role.
09:07:21 [138/271] QA Engineer @ Mercury Engineering
09:07:21 ○ Not relevant (score: 3/10): The candidate's skills and target roles are not aligned with the requirements of the QA mechanical inspector position.
09:07:23 [139/271] Senior Reliability Engineer @ IKO Industries
09:07:23 ○ Not relevant (score: 3/10): The candidate's skills and experience do not align with the requirements for the reliability engineering role.
09:07:23 [140/271] QA Automation Engineer @ PlayStation
09:07:23 ○ Not relevant (score: 4/10): The candidate's experience and skills do not match the requirements for the QA Automation Engineer role.
09:07:23 [141/271] Principal RF Design Engineer @ Analog Devices
09:07:23 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the highly specialized RFIC design role requirements.
09:07:23 [142/271] Senior RFIC Design Engineer @ Analog Devices
09:07:23 ○ Not relevant (score: 4/10): The candidate's profile does not align with the requirements for the RFIC Design Engineer role.
09:07:24 [143/271] Senior Software Developer (Front End) @ SOTI Inc.
09:07:24 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the senior front-end developer role.
09:07:26 [144/271] Senior Network Security Engineer @ InterSystems Corporation
09:07:26 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the network security engineering role requirements.
09:07:26 [145/271] Mixed-Signal Design Engineer @ Analog Devices
09:07:26 ○ Not relevant (score: 4/10): The candidate's background and skills do not align with the requirements for the Mixed Signal Design Engineer role.
09:07:27 [146/271] Security Automation Engineer @ InterSystems Corporation
09:07:27 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the Security Automation Engineer role.
09:07:27 [147/271] Senior Site Reliability Engineer @ Mastercard
09:07:27 ○ Not relevant (score: 4/10): The candidate's skills and experience do not match the requirements for the Senior Site Reliability Engineer role.
09:07:28 [148/271] Technical Support Engineer @ HiddenLayer
09:07:28 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the technical support focus of the role.
09:07:28 [149/271] Senior Software Engineer-Typescript @ Liberty Information Technology
09:07:28 [150/271] Foundry R&D Software Engineer II @ Mastercard
09:07:29 [151/271] IT Operations Engineer @ Distilled
09:07:29 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the IT operations role, leading to a low overall fit.
09:07:31 [152/271] Senior Software Engineer, P2020 @ Google
09:07:31 ○ Not relevant (score: 4/10): The candidate's experience and role preference do not align with the seniority and requirements of this position.
09:07:32 [153/271] TECHNOLOGY ARCHITECT L1(CONTRACT) @ Wipro Ireland
09:07:33 [154/271] Director, Community Marketing @ Bentley Systems
09:07:33 ○ Not relevant (score: 4/10): The candidate's profile does not match the community marketing focus of the role.
09:07:33 [155/271] Hardware Solutions Engineer @ Amax Engineering
09:07:33 ○ Not relevant (score: 3/10): The candidate's skills and experience do not match the hardware-focused requirements of the role.
09:07:33 [156/271] SAP Developer - Remote @ BLP Digital AG
09:07:33 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the SAP Developer role.
09:07:33 [157/271] Solutions Marketing Manager (PostgreSQL) @ Percona
09:07:33 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of a product marketing role.
09:07:34 [158/271] Lead AI Automation Engineer @ m-kopa
09:07:34 [159/271] Senior Platform Engineer @ Sitecore
09:07:34 ○ Not relevant (score: 4/10): The candidate's profile does not align with the senior platform engineering role at Sitecore.
09:07:35 [160/271] Senior Advisor, Data Science - Machine Learning Engineer @ Dell Technologies
09:07:36 [161/271] Senior Advisor, Data Science - Machine Learning Engineer @ Dell Technologies
09:07:37 [162/271] Senior Advisor, Data Science - Machine Learning Engineer @ Dell Technologies
09:07:37 [163/271] Systems Development Engineer, Amazon Foundational Security Services @ Amazon.com
09:07:38 [164/271] QA Engineer @ Mercury Engineering
09:07:38 ○ Not relevant (score: 4/10): The candidate's profile does not align with the requirements of the QA mechanical inspector role.
09:07:38 [165/271] Senior Product Designer (UX/UI) @ Learnosity
09:07:38 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the Senior Product Designer role.
09:07:39 [166/271] QA Automation Engineer @ PlayStation
09:07:39 ○ Not relevant (score: 4/10): The candidate's profile does not align with the requirements for the QA Automation Engineer role.
09:07:39 [167/271] Senior Software Developer (Front End) @ SOTI Inc.
09:07:39 ○ Not relevant (score: 4/10): The candidate's profile does not align with the seniority and specific skills required for this role.
09:07:41 [168/271] Senior Reliability Engineer @ IKO Industries
09:07:41 ○ Not relevant (score: 3/10): The candidate's skills and experience do not align with the requirements for the reliability engineering role.
09:07:41 [169/271] Staff Software Engineer, Global Network Technology @ Google
09:07:41 ○ Not relevant (score: 4/10): The candidate is not a fit for the Staff Software Engineer role due to significant mismatches in experience and skills.
09:07:42 [170/271] Principal RF Design Engineer @ Analog Devices
09:07:42 ○ Not relevant (score: 4/10): The candidate's background and experience do not align with the highly specialized RFIC design engineering role.
09:07:42 [171/271] Senior RFIC Design Engineer @ Analog Devices
09:07:42 ○ Not relevant (score: 4/10): The candidate's background and skills do not align with the RFIC Design Engineer role requirements.
09:07:43 [172/271] Senior Network Security Engineer @ InterSystems Corporation
09:07:43 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for the network security engineer role.
09:07:44 [173/271] Security Automation Engineer @ InterSystems Corporation
09:07:44 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements for the Security Automation Engineer role.
09:07:45 [174/271] Senior Manager Data Architecture and AI @ Aptiv
09:07:45 ○ Not relevant (score: 4/10): The candidate's experience and role preference do not align with the seniority and responsibilities of this position.
09:07:45 [175/271] Mixed-Signal Design Engineer @ Analog Devices
09:07:45 ○ Not relevant (score: 4/10): The candidate's skills and target roles do not align with the requirements of the Mixed Signal Design Engineer position.
09:07:46 [176/271] Junior Python Developer @ Citi
09:07:48 [177/271] Full-Stack Developer @ Panda Game Manufacturing Limited
09:07:48 ○ Not relevant (score: 4/10): The candidate's profile does not align with the requirements for the Full Stack Developer position.
09:07:48 [178/271] Lead AI Automation Engineer @ M-KOPA
09:07:49 [179/271] Staff Engineer, Embedded AI Software Engineer @ Analog Devices
09:07:49 [180/271] Senior Cloud Software Engineer @ Analog Devices
09:07:49 [181/271] Senior Manager Data Architecture and AI @ Aptiv
09:07:49 ○ Not relevant (score: 4/10): The candidate's experience and role preference do not align with the seniority and requirements of this position.
09:07:50 [182/271] Senior Manager Data Architecture and AI @ Aptiv
09:07:50 ○ Not relevant (score: 4/10): The candidate's entry-level preference does not align with the seniority required for this role.
09:07:53 [183/271] FullStack Engineer 38786 @ Trust In SODA
09:07:53 [184/271] Senior Full Stack Developer @ Berkley Group
09:07:53 [185/271] Azure Full Stack Software Engineer @ FRS Recruitment
09:07:53 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the requirements of the full stack engineer role.
09:07:53 [186/271] Founding Full-Stack Engineer @ Grand
09:07:53 [187/271] Full Stack Engineer @ Cpl
09:07:54 [188/271] Backend Engineer, Senior (Rust) @ Affinidi
09:07:54 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the senior-level requirements of the role.
09:07:54 [189/271] Fullstack Developer @ Holafly
09:07:55 [190/271] Senior Backend Engineer (Rust) (m/f/d) @ Affinidi
09:07:55 ○ Not relevant (score: 4/10): The candidate's skills and experience do not align with the seniority or technical requirements of the role.
09:07:57 [191/271] Senior Software Engineer @ Fruition Group Ireland
09:07:57 ○ Not relevant (score: 4/10): The candidate's experience and target roles do not align with the requirements of a Senior Software Engineer.
09:07:57 [192/271] Data Analyst - Trust & Safety @ RECRUITERS
09:07:57 [193/271] Senior Frontend Engineer, Reliability Experience @ Airbnb
09:07:59 [194/271] Senior Software Engineer @ nineDots.io
09:08:00 [195/271] Supply Acquisition Lead, EMEA @ Airbnb
09:08:00 [196/271] Field Solutions Engineer @ Cloudflare
09:08:00 [197/271] Director, Developer Partner Strategy @ Cloudflare
09:08:00 [198/271] Director, Developer GTM @ Cloudflare
09:08:01 [199/271] Forward Deployed Engineer @ Cloudflare
09:08:02 [200/271] Named Account Executive @ Cloudflare
09:08:03 [201/271] Forward Deployed Engineer, Hebrew speaker @ Cloudflare
09:08:05 [202/271] Senior Account Executive, LATAM @ Cloudflare
09:08:05 [203/271] Senior Account Executive, Start-ups (Bay Area) @ Cloudflare
09:08:05 [204/271] Sales Manager, RIG (iGaming & Web3) @ Cloudflare
09:08:06 [205/271] Senior Account Executive, Start-ups (Bay Area) @ Cloudflare
09:08:07 [206/271] Senior Account Executive, Mid-Market ( NYC) @ Cloudflare
09:08:07 [207/271] Senior Account Executive, Start-ups (NYC) @ Cloudflare
09:08:08 [208/271] Senior Commercial Account Executive, Israel @ Cloudflare
09:08:09 [209/271] Senior Director, Developer Product Marketing @ Cloudflare
09:08:10 [210/271] Senior Engineering Manager - Workers KV @ Cloudflare
09:08:11 [211/271] Senior Forward Deployed Engineer @ Cloudflare
09:08:11 [212/271] Senior Enterprise Account Executive - Brazil @ Cloudflare
09:08:13 [213/271] Senior Forward Deployed Engineer @ Cloudflare
09:08:13 [214/271] Senior Forward Deployed Engineer @ Cloudflare
09:08:13 [215/271] Senior Majors Account Executive, New Jersey (Pharma) @ Cloudflare
09:08:14 [216/271] Senior Forward Deployed Engineer @ Cloudflare
09:08:15 [217/271] Senior Majors Account Executive - San Francisco, Bay Area @ Cloudflare
09:08:17 [218/271] Senior Named Account Executive, CIS Region @ Cloudflare
09:08:17 [219/271] Senior Manager, Solutions Architecture, AI & Developer Platform @ Cloudflare
09:08:18 [220/271] Senior Named Account Executive @ Cloudflare
09:08:18 [221/271] Senior Named Account Executive, Israel - Digital Natives @ Cloudflare
09:08:19 [222/271] Senior Named Account Executive, FedCiv @ Cloudflare
09:08:19 [223/271] Senior Named Account Executive, Gaming & iGaming @ Cloudflare
09:08:19 [224/271] Senior Named Account Executive, Digital Natives @ Cloudflare
09:08:22 [225/271] Senior Named Account Executive (NY) @ Cloudflare
09:08:23 [226/271] Senior Software Engineer, Storage Infrastructure @ Cloudflare
09:08:24 [227/271] Senior Solutions Architect @ Cloudflare
09:08:24 [228/271] Senior Partner Strategy Manager, Developer Platform @ Cloudflare
09:08:24 [229/271] Senior Solutions Architect, Hebrew speaker @ Cloudflare
09:08:25 [230/271] Senior Solutions Engineer - Digital Native Enterprise - West @ Cloudflare
09:08:25 [231/271] Senior Solutions Engineer, Enterprise Accounts - Miami @ Cloudflare
09:08:25 [232/271] Senior Solutions Engineer, Enterprise Accounts - Charlotte or Raleigh, NC @ Cloudflare
09:08:28 [233/271] Senior Solutions Engineer - Russian Speaking @ Cloudflare
09:08:29 [234/271] Senior Solutions Engineer, Majors, San Francisco @ Cloudflare
09:08:29 [235/271] Senior Territory Account Executive - North China @ Cloudflare
09:08:30 [236/271] Solutions Architect, AI/Cloudflare Developer Platform @ Cloudflare
09:08:30 [237/271] Solutions Architect, AI/Cloudflare Developer Platform @ Cloudflare
09:08:30 [238/271] Solutions Engineer, Central & Eastern Europe - Czech Speaking @ Cloudflare
09:08:32 [239/271] Senior Territory Account Executive, Egypt @ Cloudflare
09:08:33 [240/271] Sr. Account Executive, Start-ups (Austin or Chicago) @ Cloudflare
09:08:34 [241/271] Senior Territory Account Executive (Phoenix, SLC or Denver) @ Cloudflare
09:08:34 [242/271] Commercial Account Executive (DACH) @ Datadog
09:08:34 [243/271] Commercial Sales Engineer @ Datadog
09:08:34 [244/271] Commercial Account Executive UKI/Nordics @ Datadog
09:08:35 [245/271] Commercial Sales Engineer (Italian Speaking) @ Datadog
09:08:37 [246/271] Commercial Account Executive (France) @ Datadog
09:08:37 [247/271] Customer Success Associate - Dublin @ Datadog
09:08:38 [248/271] Customer Success Associate (French Speaking) @ Datadog
09:08:38 [249/271] Engineering Manager - Security Incident Response (EMEA) @ Datadog
09:08:39 [250/271] Enterprise Sales Engineer - Mexico @ Datadog
09:08:40 [251/271] Commercial Sales Engineer (Turkish-speaking) @ Datadog
09:08:40 [252/271] Front Desk Associate - Dublin @ Datadog
09:08:42 [253/271] Mid-Market Account Executive (DACH) @ Datadog
09:08:43 [254/271] Open Source Program Developer @ Datadog
09:08:43 [255/271] Partner Manager - Commercial Cloud Alliances (South EMEA) @ Datadog
09:08:44 [256/271] Manager, Mid-Market Sales (Nordics, CEE, Baltics) @ Datadog
09:08:44 [257/271] GTM Strategy/Operations Associate - Dublin @ Datadog
09:08:45 [258/271] Sales Development Representative (Benelux) @ Datadog
09:08:48 [259/271] Partner Solutions Architect (LATAM) @ Datadog
09:08:48 [260/271] Sales Development Representative (UKI) @ Datadog
09:08:48 [261/271] Enterprise Sales Executive @ Datadog
09:08:48 [262/271] Sales Development Representative (DACH) @ Datadog
09:08:50 [263/271] Senior Product Solutions Architect - Logs @ Datadog
09:08:50 [264/271] Sales Development Representative (Nordics) - Dublin @ Datadog
09:08:50 [265/271] Senior Partner Manager - Alliances (Chile) @ Datadog
09:08:50 [266/271] Senior Partner Manager - Channels @ Datadog
09:08:52 [267/271] Technical Account Manager 3 - London @ Datadog
09:08:53 [268/271] Staff AI Engineer - Notebooks @ Datadog
09:08:53 [269/271] Technical Account Manager 2 - EMEA @ Datadog
09:08:54 [270/271] Strategic Account Executive @ Datadog
09:08:55 [271/271] Technical Support Engineer 2, Premier - EMEA @ Datadog
09:08:55 114 relevant jobs exceeded the daily budget (50). Kept the top 50 by score; dropped 114 scoring 5-8/10.
09:08:55 ✓ Relevant (score: 9/10): The candidate is an excellent fit for the internship due to their relevant skills and alignment with the role's focus on learning and adaptability.
09:08:56 ✓ Posted: Ascentic Ignition | Engineering Internship Program @ Ascentic
09:08:56 ✓ Relevant (score: 9/10): The candidate is an excellent fit for the internship program due to their relevant skills and alignment with the role's requirements.
09:08:57 ✓ Posted: Ascentic Ignition | Engineering Internship Program @ Ascentic
09:08:57 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the role's requirements, making them a strong fit.
09:08:59 ✓ Posted: Lead Software Engineer @ nineDots.io
09:08:59 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the role, making them a strong fit for the position.
09:09:00 ✓ Posted: Software Engineer (AI) @ Tines
09:09:00 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the requirements of the AI engineering role, making them a strong fit.
09:09:02 ✓ Posted: Software Engineer @ nineDots.io
09:09:02 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:03 ✓ Posted: Senior Frontend Engineer, Reliability Experience @ Airbnb
09:09:03 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:09:04 ✓ Posted: Supply Acquisition Lead, EMEA @ Airbnb
09:09:04 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:09:06 ✓ Posted: Field Solutions Engineer @ Cloudflare
09:09:06 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on skills and experience.
09:09:07 ✓ Posted: Director, Developer Partner Strategy @ Cloudflare
09:09:07 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to aligned skills and experience.
09:09:09 ✓ Posted: Director, Developer GTM @ Cloudflare
09:09:09 ✓ Relevant (score: 8/10): The candidate is a strong fit for the role based on skills, location, and alignment with job requirements.
09:09:10 ✓ Posted: Forward Deployed Engineer @ Cloudflare
09:09:10 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:09:11 ✓ Posted: Named Account Executive @ Cloudflare
09:09:11 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role due to their relevant skills and experience.
09:09:13 ✓ Posted: Forward Deployed Engineer, Hebrew speaker @ Cloudflare
09:09:13 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:09:14 ✓ Posted: Senior Account Executive, LATAM @ Cloudflare
09:09:14 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:15 ✓ Posted: Senior Account Executive, Start-ups (Bay Area) @ Cloudflare
09:09:15 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on their skills and experience.
09:09:17 ✓ Posted: Sales Manager, RIG (iGaming & Web3) @ Cloudflare
09:09:17 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:09:18 ✓ Posted: Senior Account Executive, Start-ups (Bay Area) @ Cloudflare
09:09:18 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:09:20 ✓ Posted: Senior Account Executive, Mid-Market ( NYC) @ Cloudflare
09:09:20 ✓ Relevant (score: 8/10): The candidate is a strong match for the Data Engineer role due to relevant skills and experience.
09:09:21 ✓ Posted: Senior Account Executive, Start-ups (NYC) @ Cloudflare
09:09:21 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:22 ✓ Posted: Senior Commercial Account Executive, Israel @ Cloudflare
09:09:22 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the job requirements and company profile.
09:09:24 ✓ Posted: Senior Director, Developer Product Marketing @ Cloudflare
09:09:24 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:09:25 ✓ Posted: Senior Engineering Manager - Workers KV @ Cloudflare
09:09:25 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:27 ✓ Posted: Senior Forward Deployed Engineer @ Cloudflare
09:09:27 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role due to their relevant skills and experience.
09:09:28 ✓ Posted: Senior Enterprise Account Executive - Brazil @ Cloudflare
09:09:28 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role due to relevant skills and experience.
09:09:29 ✓ Posted: Senior Forward Deployed Engineer @ Cloudflare
09:09:29 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:09:31 ✓ Posted: Senior Forward Deployed Engineer @ Cloudflare
09:09:31 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on skills and experience.
09:09:32 ✓ Posted: Senior Majors Account Executive, New Jersey (Pharma) @ Cloudflare
09:09:32 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the job requirements, making them a strong fit.
09:09:33 ✓ Posted: Senior Forward Deployed Engineer @ Cloudflare
09:09:33 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role with relevant skills and experience.
09:09:35 ✓ Posted: Senior Majors Account Executive - San Francisco, Bay Area @ Cloudflare
09:09:35 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:36 ✓ Posted: Senior Named Account Executive, CIS Region @ Cloudflare
09:09:36 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:09:38 ✓ Posted: Senior Manager, Solutions Architecture, AI & Developer Platform @ Cloudflare
09:09:38 ✓ Relevant (score: 8/10): The candidate is a strong match for the Data Engineer role with relevant skills and experience.
09:09:39 ✓ Posted: Senior Named Account Executive @ Cloudflare
09:09:39 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the job requirements, making them a strong fit.
09:09:40 ✓ Posted: Senior Named Account Executive, Israel - Digital Natives @ Cloudflare
09:09:40 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on skills and experience.
09:09:42 ✓ Posted: Senior Named Account Executive, FedCiv @ Cloudflare
09:09:42 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:43 ✓ Posted: Senior Named Account Executive, Gaming & iGaming @ Cloudflare
09:09:43 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role with relevant skills and experience.
09:09:45 ✓ Posted: Senior Named Account Executive, Digital Natives @ Cloudflare
09:09:45 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:09:46 ✓ Posted: Senior Named Account Executive (NY) @ Cloudflare
09:09:46 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on skills and experience.
09:09:47 ✓ Posted: Senior Software Engineer, Storage Infrastructure @ Cloudflare
09:09:47 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role based on skills and experience.
09:09:49 ✓ Posted: Senior Solutions Architect @ Cloudflare
09:09:49 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the data engineering role, making them a strong fit.
09:09:50 ✓ Posted: Senior Partner Strategy Manager, Developer Platform @ Cloudflare
09:09:50 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the AI Engineer role, making them a strong fit.
09:09:51 ✓ Posted: Senior Solutions Architect, Hebrew speaker @ Cloudflare
09:09:51 ✓ Relevant (score: 8/10): The candidate's skills and experience align well with the job requirements, making them a strong fit.
09:09:53 ✓ Posted: Senior Solutions Engineer - Digital Native Enterprise - West @ Cloudflare
09:09:53 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:09:54 ✓ Posted: Senior Solutions Engineer, Enterprise Accounts - Miami @ Cloudflare
09:09:54 ✓ Relevant (score: 8/10): The candidate has a strong alignment with the job requirements and is well-suited for the role.
09:09:56 ✓ Posted: Senior Solutions Engineer, Enterprise Accounts - Charlotte or Raleigh, NC @ Cloudflare
09:09:56 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role due to their relevant skills and educational background.
09:09:57 ✓ Posted: Senior Solutions Engineer - Russian Speaking @ Cloudflare
09:09:57 ✓ Relevant (score: 8/10): The candidate is a strong fit for the AI Engineer role due to relevant skills and experience.
09:09:58 ✓ Posted: Senior Solutions Engineer, Majors, San Francisco @ Cloudflare
09:09:58 ✓ Relevant (score: 8/10): The candidate has a strong alignment with the job requirements and is well-suited for the role.
09:10:00 ✓ Posted: Senior Territory Account Executive - North China @ Cloudflare
09:10:00 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:10:01 ✓ Posted: Solutions Architect, AI/Cloudflare Developer Platform @ Cloudflare
09:10:01 ✓ Relevant (score: 8/10): The candidate is a strong fit for the role due to relevant skills and experience in data engineering and AI.
09:10:03 ✓ Posted: Solutions Architect, AI/Cloudflare Developer Platform @ Cloudflare
09:10:03 ✓ Relevant (score: 8/10): The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:10:04 ✓ Posted: Solutions Engineer, Central & Eastern Europe - Czech Speaking @ Cloudflare
09:10:04 Score distribution (out of 271): 9-10: 2 · 7-8: 107 · 5-6: 55 · 3-4: 107 · 0-2: 0
09:10:04 107 of 271 jobs (39%) were gate-capped at 4/10 (role_match or skills_alignment scored 1 — the job's function is fundamentally different from your target role).
09:10:04 >>> Fetching resume profiles for role-type matching...
09:10:05 No resume profiles found — using default resume for all jobs
09:10:05 >>>
Phase 2: Tailoring top 20 of 50 relevant jobs (tailoring: HIGH 9/10, max: 20)...
>>>Phase 2: Tailoring top 20 of 50 relevant jobs (tailoring: HIGH 9/10, max: 20)...
09:10:05 [1/20] Ascentic Ignition | Engineering Internship Program @ Ascentic
09:10:05 Score: 9/10 — The candidate is an excellent fit for the internship due to their relevant skills and alignment with the role's focus on learning and adaptability.
09:11:05 ✓ Resume customized
09:11:07 ✓ PDF generated (230KB)
09:11:10 ✓ PDF uploaded: DHANUSH_ARAVIND_ASCENTIC_IGNITION_ENGINEERING_INTERNSHIP_PROGRAM_ASCENTIC_RESUME.pdf
09:11:10 ✓ CV Sync Check: 100% keyword match (1/1)
09:11:13 ✓ Resume, cover letter, and fit summary attached to tracker
09:11:15 [2/20] Ascentic Ignition | Engineering Internship Program @ Ascentic
09:11:15 Score: 9/10 — The candidate is an excellent fit for the internship program due to their relevant skills and alignment with the role's requirements.
09:12:18 ✓ Resume customized
09:12:20 ✓ PDF generated (230KB)
09:12:23 ✓ PDF uploaded: DHANUSH_ARAVIND_ASCENTIC_IGNITION_ENGINEERING_INTERNSHIP_PROGRAM_ASCENTIC_RESUME.pdf
09:12:23 ✓ CV Sync Check: 100% keyword match (1/1)
09:12:26 ✓ Resume, cover letter, and fit summary attached to tracker
09:12:28 [3/20] Lead Software Engineer @ nineDots.io
09:12:28 Score: 8/10 — The candidate's skills and experience align well with the role's requirements, making them a strong fit.
09:13:26 ✓ Resume customized
09:13:29 ✓ PDF generated (230KB)
09:13:32 ✓ PDF uploaded: DHANUSH_ARAVIND_LEAD_SOFTWARE_ENGINEER_NINEDOTS_IO_RESUME.pdf
09:13:32 ✓ CV Sync Check: 100% keyword match (5/5)
09:13:35 ✓ Resume, cover letter, and fit summary attached to tracker
09:13:37 [4/20] Software Engineer (AI) @ Tines
09:13:37 Score: 8/10 — The candidate's skills and experience align well with the role, making them a strong fit for the position.
09:13:55 ✓ Resume customized
09:13:57 ✓ PDF generated (230KB)
09:14:00 ✓ PDF uploaded: DHANUSH_ARAVIND_SOFTWARE_ENGINEER_AI_TINES_RESUME.pdf
09:14:00 ✓ CV Sync Check: 71% keyword match (5/7)
09:14:03 ✓ Resume, cover letter, and fit summary attached to tracker
09:14:05 [5/20] Software Engineer @ nineDots.io
09:14:05 Score: 8/10 — The candidate's skills and experience align well with the requirements of the AI engineering role, making them a strong fit.
09:15:03 ✓ Resume customized
09:15:05 ✓ PDF generated (229KB)
09:15:08 ✓ PDF uploaded: DHANUSH_ARAVIND_SOFTWARE_ENGINEER_NINEDOTS_IO_RESUME.pdf
09:15:08 ⚠ CV Sync Check: 60% keyword match (3/5). Missing: typescript, react
09:15:11 ✓ Resume, cover letter, and fit summary attached to tracker
09:15:13 [6/20] Senior Frontend Engineer, Reliability Experience @ Airbnb
09:15:13 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:16:09 ✓ Resume customized
09:16:10 ✓ PDF generated (230KB)
09:16:13 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_FRONTEND_ENGINEER_RELIABILITY_EXPERIENCE_AIRBNB_RESUME.pdf
09:16:16 ✓ Resume, cover letter, and fit summary attached to tracker
09:16:18 [7/20] Supply Acquisition Lead, EMEA @ Airbnb
09:16:18 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:16:57 ✓ Resume customized
09:17:00 ✓ PDF generated (230KB)
09:17:03 ✓ PDF uploaded: DHANUSH_ARAVIND_SUPPLY_ACQUISITION_LEAD_EMEA_AIRBNB_RESUME.pdf
09:17:06 ✓ Resume, cover letter, and fit summary attached to tracker
09:17:08 [8/20] Field Solutions Engineer @ Cloudflare
09:17:08 Score: 8/10 — The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:17:47 ✓ Resume customized
09:17:49 ✓ PDF generated (230KB)
09:17:52 ✓ PDF uploaded: DHANUSH_ARAVIND_FIELD_SOLUTIONS_ENGINEER_CLOUDFLARE_RESUME.pdf
09:17:55 ✓ Resume, cover letter, and fit summary attached to tracker
09:17:57 [9/20] Director, Developer Partner Strategy @ Cloudflare
09:17:57 Score: 8/10 — The candidate is a strong fit for the Data Engineer role based on skills and experience.
09:18:29 ✓ Resume customized
09:18:32 ✓ PDF generated (230KB)
09:18:35 ✓ PDF uploaded: DHANUSH_ARAVIND_DIRECTOR_DEVELOPER_PARTNER_STRATEGY_CLOUDFLARE_RESUME.pdf
09:18:38 ✓ Resume, cover letter, and fit summary attached to tracker
09:18:40 [10/20] Director, Developer GTM @ Cloudflare
09:18:40 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to aligned skills and experience.
09:19:10 ✓ Resume customized
09:19:12 ✓ PDF generated (230KB)
09:19:15 ✓ PDF uploaded: DHANUSH_ARAVIND_DIRECTOR_DEVELOPER_GTM_CLOUDFLARE_RESUME.pdf
09:19:18 ✓ Resume, cover letter, and fit summary attached to tracker
09:19:20 [11/20] Forward Deployed Engineer @ Cloudflare
09:19:20 Score: 8/10 — The candidate is a strong fit for the role based on skills, location, and alignment with job requirements.
09:19:55 ✓ Resume customized
09:19:57 ✓ PDF generated (230KB)
09:20:00 ✓ PDF uploaded: DHANUSH_ARAVIND_FORWARD_DEPLOYED_ENGINEER_CLOUDFLARE_RESUME.pdf
09:20:03 ✓ Resume, cover letter, and fit summary attached to tracker
09:20:05 [12/20] Named Account Executive @ Cloudflare
09:20:05 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:20:58 ✓ Resume customized
09:21:01 ✓ PDF generated (230KB)
09:21:03 ✓ PDF uploaded: DHANUSH_ARAVIND_NAMED_ACCOUNT_EXECUTIVE_CLOUDFLARE_RESUME.pdf
09:21:06 ✓ Resume, cover letter, and fit summary attached to tracker
09:21:08 [13/20] Forward Deployed Engineer, Hebrew speaker @ Cloudflare
09:21:08 Score: 8/10 — The candidate is a strong fit for the AI Engineer role due to their relevant skills and experience.
09:21:54 ✓ Resume customized
09:21:57 ✓ PDF generated (229KB)
09:21:59 ✓ PDF uploaded: DHANUSH_ARAVIND_FORWARD_DEPLOYED_ENGINEER_HEBREW_SPEAKER_CLOUDFLARE_RESUME.pdf
09:22:02 ✓ Resume, cover letter, and fit summary attached to tracker
09:22:04 [14/20] Senior Account Executive, LATAM @ Cloudflare
09:22:04 Score: 8/10 — The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:22:35 ✓ Resume customized
09:22:38 ✓ PDF generated (229KB)
09:22:41 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_ACCOUNT_EXECUTIVE_LATAM_CLOUDFLARE_RESUME.pdf
09:22:43 ✓ Resume, cover letter, and fit summary attached to tracker
09:22:45 [15/20] Senior Account Executive, Start-ups (Bay Area) @ Cloudflare
09:22:45 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:23:26 ✓ Resume customized
09:23:29 ✓ PDF generated (230KB)
09:23:32 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_ACCOUNT_EXECUTIVE_START_UPS_BAY_AREA_CLOUDFLARE_RESUME.pdf
09:23:35 ✓ Resume, cover letter, and fit summary attached to tracker
09:23:37 [16/20] Sales Manager, RIG (iGaming & Web3) @ Cloudflare
09:23:37 Score: 8/10 — The candidate is a strong fit for the Data Engineer role based on their skills and experience.
09:24:08 ✓ Resume customized
09:24:11 ✓ PDF generated (230KB)
09:24:14 ✓ PDF uploaded: DHANUSH_ARAVIND_SALES_MANAGER_RIG_IGAMING_WEB3_CLOUDFLARE_RESUME.pdf
09:24:16 ✓ Resume, cover letter, and fit summary attached to tracker
09:24:18 [17/20] Senior Account Executive, Start-ups (Bay Area) @ Cloudflare
09:24:18 Score: 8/10 — The candidate is a strong fit for the AI Engineer role based on skills and experience.
09:24:48 ✓ Resume customized
09:24:50 ✓ PDF generated (229KB)
09:24:53 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_ACCOUNT_EXECUTIVE_START_UPS_BAY_AREA_CLOUDFLARE_RESUME.pdf
09:24:56 ✓ Resume, cover letter, and fit summary attached to tracker
09:24:58 [18/20] Senior Account Executive, Mid-Market ( NYC) @ Cloudflare
09:24:58 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to their relevant skills and experience.
09:25:35 ✓ Resume customized
09:25:38 ✓ PDF generated (230KB)
09:25:40 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_ACCOUNT_EXECUTIVE_MID_MARKET_NYC_CLOUDFLARE_RESUME.pdf
09:25:43 ✓ Resume, cover letter, and fit summary attached to tracker
09:25:45 [19/20] Senior Account Executive, Start-ups (NYC) @ Cloudflare
09:25:45 Score: 8/10 — The candidate is a strong match for the Data Engineer role due to relevant skills and experience.
09:26:23 ✓ Resume customized
09:26:25 ✓ PDF generated (230KB)
09:26:28 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_ACCOUNT_EXECUTIVE_START_UPS_NYC_CLOUDFLARE_RESUME.pdf
09:26:31 ✓ Resume, cover letter, and fit summary attached to tracker
09:26:33 [20/20] Senior Commercial Account Executive, Israel @ Cloudflare
09:26:33 Score: 8/10 — The candidate is a strong fit for the Data Engineer role due to relevant skills and experience.
09:27:09 ✓ Resume customized
09:27:12 ✓ PDF generated (230KB)
09:27:15 ✓ PDF uploaded: DHANUSH_ARAVIND_SENIOR_COMMERCIAL_ACCOUNT_EXECUTIVE_ISRAEL_CLOUDFLARE_RESUME.pdf
09:27:18 ✓ Resume, cover letter, and fit summary attached to tracker
09:27:18 Pipeline completed in 27.3 minutes
═══ Pipeline Summary ═══
>>>═══ Pipeline Summary ═══
Scraped: 70 jobs from all sources
Location: 271 in target regions
Relevant: 50 passed AI filter (all posted to tracker)
Tailored: 20 top-N resumes + cover letters
Applied: 20 fully processed
Skipped: 2 (duplicates)
Errors: 0
09:27:26 ✓ Skills snapshot saved
Pipeline complete