import { LinkedInJob } from "../types";
import { config } from "../config";
import { log } from "../logger";

/**
 * Location filter — configurable via LOCATION_REGIONS env var.
 *
 * Set LOCATION_REGIONS in pipeline/.env to a comma-separated list of region keys:
 *   LOCATION_REGIONS=ireland,uk,eu          (default — Ireland + UK + EU)
 *   LOCATION_REGIONS=us,canada              (North America)
 *   LOCATION_REGIONS=all                    (skip location filter entirely)
 *   LOCATION_REGIONS=custom:london,manchester,remote   (custom city list)
 *
 * For SaaS: each user's location prefs come from their settings.
 */

// ── Ireland (all counties & major cities) ────────────────────────────────────
const IRELAND_LOCATIONS = [
  "ireland", "dublin", "cork", "galway", "limerick", "waterford", "belfast",
  "republic of ireland", "éire", "eire",
  "kilkenny", "wexford", "sligo", "drogheda", "dundalk", "athlone", "ennis",
  "tralee", "killarney", "letterkenny", "carlow", "tullamore", "mullingar",
  "naas", "navan", "newbridge", "portlaoise", "roscommon", "longford",
  "cavan", "monaghan", "clonmel", "tipperary", "wicklow", "arklow", "bray",
  "maynooth", "celbridge", "leixlip", "swords", "malahide", "dún laoghaire",
  "shannon", "louth", "meath", "kildare", "offaly", "westmeath", "laois",
  "donegal", "mayo", "clare", "kerry", "leitrim",
  // Northern Ireland
  "northern ireland", "derry", "lisburn", "newry", "bangor", "armagh",
  // County Dublin areas
  "county dublin", "south dublin", "north dublin", "fingal", "dun laoghaire-rathdown",
];

// ── UK ───────────────────────────────────────────────────────────────────────
const UK_LOCATIONS = [
  "united kingdom", "uk", "england", "scotland", "wales",
  "london", "manchester", "birmingham", "edinburgh", "glasgow",
  "bristol", "leeds", "cambridge", "oxford", "liverpool", "sheffield",
  "nottingham", "newcastle", "cardiff", "belfast", "brighton", "reading",
  "bath", "exeter", "york", "southampton", "leicester", "aberdeen",
];

// ── Netherlands ──────────────────────────────────────────────────────────────
const NETHERLANDS_LOCATIONS = [
  "netherlands", "holland", "the netherlands", "nederland",
  "amsterdam", "rotterdam", "the hague", "den haag", "utrecht", "eindhoven",
  "groningen", "tilburg", "almere", "breda", "nijmegen", "haarlem", "arnhem",
  "enschede", "leiden", "delft", "maastricht",
];

// ── EU countries & major cities (excluding NL — it has its own region) ──────
const EU_LOCATIONS = [
  "europe", "eu", "emea",
  "germany", "france", "spain", "italy",
  "portugal", "belgium", "austria", "switzerland", "sweden", "denmark",
  "norway", "finland", "poland", "czech", "luxembourg", "romania",
  "hungary", "croatia", "greece", "bulgaria", "slovakia", "slovenia",
  "estonia", "latvia", "lithuania",
  "berlin", "munich", "frankfurt", "hamburg",
  "paris", "lyon", "barcelona", "madrid", "lisbon", "porto",
  "brussels", "vienna", "zurich", "geneva", "stockholm", "copenhagen",
  "oslo", "helsinki", "warsaw", "prague", "budapest", "bucharest",
  "milan", "rome", "athens",
];

// ── US ──────────────────────────────────────────────────────────────────────
const US_LOCATIONS = [
  "united states", "usa", "u.s.", "america",
  "new york", "san francisco", "los angeles", "chicago", "seattle",
  "austin", "boston", "denver", "atlanta", "miami", "dallas", "houston",
  "portland", "phoenix", "san diego", "san jose", "silicon valley",
  "california", "texas", "florida", "washington dc", "virginia",
  "north carolina", "colorado", "massachusetts", "georgia", "illinois",
  "minnesota", "oregon", "maryland", "connecticut", "utah", "tennessee",
  "missouri", "wisconsin", "new jersey", "arizona", "ohio", "michigan",
  "pennsylvania",
];

// ── Canada ───────────────────────────────────────────────────────────────────
const CANADA_LOCATIONS = [
  "canada", "toronto", "vancouver", "montreal", "ottawa", "calgary",
  "edmonton", "winnipeg", "quebec", "ontario", "british columbia", "alberta",
];

// ── India ────────────────────────────────────────────────────────────────────
const INDIA_LOCATIONS = [
  "india", "bangalore", "bengaluru", "hyderabad", "mumbai", "pune",
  "chennai", "delhi", "noida", "gurgaon", "gurugram", "kolkata",
];

// ── New Zealand ──────────────────────────────────────────────────────────────
const NEWZEALAND_LOCATIONS = [
  "new zealand", "nz", "auckland", "wellington", "christchurch",
  "hamilton", "tauranga", "dunedin", "palmerston north", "napier",
  "hastings", "rotorua", "nelson", "whangarei", "queenstown",
];

// ── APAC ─────────────────────────────────────────────────────────────────────
const APAC_LOCATIONS = [
  "singapore", "hong kong", "japan", "tokyo", "australia", "sydney",
  "melbourne", "brisbane", ...NEWZEALAND_LOCATIONS,
  "south korea", "seoul", "taiwan", "taipei",
  "china", "beijing", "shanghai", "shenzhen",
  "philippines", "manila", "vietnam", "hanoi", "indonesia", "jakarta",
  "thailand", "bangkok", "malaysia", "kuala lumpur",
];

// ── Region map ───────────────────────────────────────────────────────────────
const REGION_MAP: Record<string, string[]> = {
  ireland: IRELAND_LOCATIONS,
  uk: UK_LOCATIONS,
  netherlands: NETHERLANDS_LOCATIONS,
  eu: EU_LOCATIONS,
  us: US_LOCATIONS,
  canada: CANADA_LOCATIONS,
  india: INDIA_LOCATIONS,
  newzealand: NEWZEALAND_LOCATIONS,
  apac: APAC_LOCATIONS,
};

/**
 * Derive a LOCATION_REGIONS default from TARGET_COUNTRIES. When the user
 * hasn't explicitly set LOCATION_REGIONS, we previously hardcoded
 * "ireland,uk,eu" — which silently discarded all non-EU matches even
 * when the user had switched to India, UK, or Netherlands. The new
 * default mirrors the country list so the filter respects their
 * selection out of the box.
 */
function defaultRegionsForCountries(): string {
  const countries = (config.TARGET_COUNTRIES || "ireland")
    .split(",")
    .map((c: string) => c.trim().toLowerCase())
    .filter(Boolean);
  if (countries.length === 0) return "ireland";

  // Strict single-country mapping. Previously Ireland fanned out to
  // "ireland,uk,eu" which leaked UK and Netherlands jobs into an
  // Ireland-targeted run. Now each country maps to only itself —
  // remote jobs still pass via the isRemote branch in filterByLocation.
  const perCountry: Record<string, string[]> = {
    ireland:     ["ireland"],
    uk:          ["uk"],
    netherlands: ["netherlands"],
    india:       ["india"],
  };
  const regions = new Set<string>();
  for (const code of countries) {
    for (const r of perCountry[code] || [code]) regions.add(r);
  }
  return Array.from(regions).join(",");
}

/**
 * Resolve the effective regions string. TARGET_COUNTRIES is authoritative —
 * we only honour a persisted LOCATION_REGIONS when the user explicitly opted
 * into an override ("all" or "custom:..."). Otherwise, the regions are
 * derived strictly from the selected countries, so old stale values like
 * "ireland,uk,eu" can't silently widen the filter after we made the country
 * mapping strict.
 */
function resolveRegions(): string {
  const raw = ((config as any).LOCATION_REGIONS || "").toString().trim().toLowerCase();
  if (raw === "all" || raw.startsWith("custom:")) return raw;
  return defaultRegionsForCountries();
}

/**
 * Build the allowed locations list from the resolved regions string.
 */
function buildAllowedLocations(): string[] | null {
  const regions = resolveRegions();
  if (regions === "all") return null; // null = skip filter entirely

  const parts = regions.split(",").map((r: string) => r.trim().toLowerCase());
  const allowed: string[] = [];

  for (const part of parts) {
    if (part.startsWith("custom:")) {
      // custom:london,manchester,remote → add those cities directly
      const cities = part.replace("custom:", "").split(",").map((c: string) => c.trim().toLowerCase());
      allowed.push(...cities);
    } else if (REGION_MAP[part]) {
      allowed.push(...REGION_MAP[part]);
    }
  }

  // Also always allow "remote" keywords
  allowed.push("remote", "hybrid", "worldwide", "global", "anywhere");

  return allowed;
}

// All allowed locations — computed once
const ALLOWED_LOCATIONS = buildAllowedLocations();

/**
 * Country-specific terms for the SELECTED region(s). Excludes the generic
 * "remote"/"hybrid"/"worldwide" tokens — those don't signal a country.
 * Used to decide whether a job's location explicitly names the selected
 * country (accept) versus just being tagged remote (handled separately).
 */
function buildSelectedCountryTerms(): string[] {
  const regions = resolveRegions().split(",").map((r: string) => r.trim().toLowerCase());
  const terms: string[] = [];
  for (const key of regions) {
    if (key.startsWith("custom:")) {
      terms.push(...key.replace("custom:", "").split(",").map((c) => c.trim().toLowerCase()));
    } else if (REGION_MAP[key]) {
      terms.push(...REGION_MAP[key]);
    }
  }
  return terms;
}

/**
 * Country-specific terms for OTHER regions (not selected). If a job's
 * location contains any of these, we reject it even if it's also tagged
 * remote — "Amsterdam (Remote)" means the company is hiring from the
 * Netherlands, not wherever the candidate is.
 */
function buildOtherCountryTerms(): string[] {
  const regions = resolveRegions().split(",").map((r: string) => r.trim().toLowerCase());
  const selected = new Set(regions);
  const terms: string[] = [];
  for (const [key, list] of Object.entries(REGION_MAP)) {
    if (!selected.has(key)) terms.push(...list);
  }
  return terms;
}

const SELECTED_COUNTRY_TERMS = buildSelectedCountryTerms();
const OTHER_COUNTRY_TERMS = buildOtherCountryTerms();
const GENERIC_REMOTE_TERMS = ["remote", "hybrid", "worldwide", "global", "anywhere", "work from home", "wfh"];

/**
 * Build the hard-rejected locations list — regions NOT in the user's allowed set.
 * If user allows "us", US cities won't be rejected. If they allow "eu", EU stays.
 */
function buildHardRejected(): string[] {
  const regions = ((config as any).LOCATION_REGIONS || "ireland,uk,eu").split(",").map((r: string) => r.trim().toLowerCase());
  if (regions.includes("all")) return []; // no rejection when all regions allowed

  const rejected: string[] = [];
  const allRegionKeys = Object.keys(REGION_MAP);

  for (const key of allRegionKeys) {
    if (!regions.includes(key)) {
      rejected.push(...REGION_MAP[key]);
    }
  }

  // Always reject these regardless (unless explicitly in allowed via custom:)
  const extraRejects = [
    "mexico", "brazil", "argentina", "colombia", "chile",
    "pakistan", "karachi", "lahore", "islamabad",
    "dubai", "abu dhabi", "saudi arabia", "qatar",
    "south africa", "cape town", "johannesburg", "nigeria", "lagos",
    "kenya", "nairobi", "egypt", "cairo",
  ];
  rejected.push(...extraRejects);

  // US state abbreviations (only rejected if US not in allowed regions)
  if (!regions.includes("us")) {
    rejected.push(
      ", ny", ", ca", ", tx", ", fl", ", wa", ", il", ", ma", ", co",
      ", ga", ", nc", ", va", ", pa", ", oh", ", mi", ", nj", ", az",
      ", mn", ", or", ", md", ", ct", ", ut", ", tn", ", mo", ", wi",
    );
  }

  return rejected;
}

const HARD_REJECTED = buildHardRejected();

// Patterns that indicate the remote job restricts to non-EU regions
const REMOTE_EXCLUDED_PATTERNS = /\b(us[- ]only|usa[- ]only|north america only|canada only|india only|apac only|us[- ]based|usa[- ]based|must be (based |located )?(in )?(the )?us|united states only)\b/i;

// Patterns that indicate remote job is open to EU/worldwide
const REMOTE_INCLUSIVE_PATTERNS = /\b(worldwide|global|anywhere|emea|europe|eu[- ]based|eu[- ]friendly|eu[- ]timezone|gmt|cet|utc[+-]?[01]|open to all|work from anywhere)\b/i;

/**
 * Normalise the location field — Apify may return a string, an object, or an array.
 */
function normaliseLocation(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw.toLowerCase();
  if (typeof raw === "object") {
    return JSON.stringify(raw).toLowerCase();
  }
  return String(raw).toLowerCase();
}

/**
 * Location filter — priorities Ireland/Dublin first, then UK/EU, then open remote.
 *
 * Logic (in order):
 * 1. Hard reject if location explicitly mentions US/India/APAC (unless also has EU)
 * 2. Accept if location mentions Ireland/UK/EU
 * 3. Remote/hybrid jobs:
 *    a. Accept if description mentions Ireland/UK/EU
 *    b. Accept if description says "worldwide"/"global"/"EMEA"/"EU timezone"
 *    c. Accept if location is JUST "Remote"/"Hybrid" with no region restriction
 *       (these get tagged as "Remote" so user can sort them to the bottom)
 *    d. Reject if description explicitly restricts to US/India/APAC
 * 4. Everything else → DROP
 */
export function filterByLocation(jobs: LinkedInJob[]): LinkedInJob[] {
  // If LOCATION_REGIONS=all, skip filtering entirely
  if (ALLOWED_LOCATIONS === null) {
    log.info("  Location filter: LOCATION_REGIONS=all — skipping filter, keeping all jobs");
    return jobs;
  }

  // Guard against silent 0-jobs runs caused by a malformed TARGET_COUNTRIES.
  // If SELECTED_COUNTRY_TERMS came out empty (because the country isn't in
  // REGION_MAP), the filter would reject every single job without telling
  // the user why. Surface the misconfiguration loudly instead.
  if (SELECTED_COUNTRY_TERMS.length === 0) {
    log.warn(
      `  Location filter: no recognised country terms for TARGET_COUNTRIES="${config.TARGET_COUNTRIES}". ` +
      "Every job will be dropped. Pick a supported country (Ireland, UK, Netherlands, India, New Zealand) or set LOCATION_REGIONS=all to disable filtering."
    );
  }

  const passed: LinkedInJob[] = [];
  let droppedCount = 0;

  if (jobs.length > 0) {
    const sampleLocs = jobs.slice(0, 5).map((j) => (j as any).location);
    log.info(`  [debug] Sample location values: ${JSON.stringify(sampleLocs)}`);
  }

  for (const job of jobs) {
    const raw = job as any;

    // Build location string from all possible fields
    const loc = [
      normaliseLocation(raw.location),
      normaliseLocation(raw.jobLocation),
      normaliseLocation(raw.locationName),
      normaliseLocation(raw.locationText),
      normaliseLocation(raw.place),
    ].join(" ");

    const descFull = (job.descriptionText || "").toLowerCase();
    const descSnippet = descFull.slice(0, 2000);
    const empType = (Array.isArray(raw.employmentType) ? raw.employmentType.join(" ") : String(raw.employmentType || "")).toLowerCase();

    // Three-way country check — precedence matters:
    //   1. Does the location name the SELECTED country? → ACCEPT
    //   2. Does it name a DIFFERENT country (even tagged remote)? → REJECT
    //   3. Is it a bare "Remote" with no country clue? → ACCEPT
    //   4. Nothing matches? → REJECT
    const selectedInLoc = SELECTED_COUNTRY_TERMS.some((t) => loc.includes(t));
    const otherInLoc = OTHER_COUNTRY_TERMS.some((t) => loc.includes(t));
    const isBareRemote = GENERIC_REMOTE_TERMS.some((t) => `${loc} ${empType}`.includes(t));

    // Step 1: Selected country named explicitly → ACCEPT (wins over everything,
    // handles cross-region edge cases like "Belfast, Northern Ireland, UK")
    if (selectedInLoc) {
      passed.push(job);
      continue;
    }

    // Step 2: A different country is named → REJECT, even if the job is
    // also tagged remote. "Amsterdam (Remote)" means hiring from the
    // Netherlands — the user picked a different country.
    if (otherInLoc) {
      droppedCount++;
      if (droppedCount <= 15) {
        log.info(`  [dropped] "${job.title}" @ "${job.companyName}" — location names a non-selected country: "${raw.location}"`);
      }
      continue;
    }

    // Step 3: Bare "Remote" / "Worldwide" with no country.
    // Only accepted when the user explicitly opted into INCLUDE_REMOTE —
    // otherwise they picked a specific country and don't want listings
    // with no country tie.
    if (isBareRemote) {
      if (!config.INCLUDE_REMOTE) {
        droppedCount++;
        if (droppedCount <= 15) {
          log.info(`  [dropped] "${job.title}" @ "${job.companyName}" — bare remote (INCLUDE_REMOTE is off): "${raw.location}"`);
        }
        continue;
      }
      if (REMOTE_EXCLUDED_PATTERNS.test(descSnippet)) {
        droppedCount++;
        if (droppedCount <= 15) {
          log.info(`  [dropped] "${job.title}" @ "${job.companyName}" — bare remote but description restricts hiring region: "${raw.location}"`);
        }
        continue;
      }
      passed.push(job);
      continue;
    }

    // Step 4: Nothing matched → drop
    droppedCount++;
    if (droppedCount <= 15) {
      log.info(`  [dropped] "${job.title}" @ "${job.companyName}" — no country match: "${raw.location}"`);
    }
  }

  if (droppedCount > 0) {
    // Replaced the old "outside Ireland/UK/EU" hardcoded string — it
    // misled users on UK/India/NZ runs into thinking the filter was
    // wrong. Surface the actual selected regions so the message tracks
    // the user's choice.
    const selectedSummary = resolveRegions().split(",").map((r) => r.trim()).filter(Boolean).join(", ") || "(none)";
    log.info(`  ${droppedCount} total jobs dropped (outside ${selectedSummary} or restricted remote)`);
  }

  return passed;
}
