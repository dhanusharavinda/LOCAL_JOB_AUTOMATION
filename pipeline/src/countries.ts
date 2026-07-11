/**
 * Country Registry - defines scrapers, LinkedIn geoId, location terms per country.
 * When adding a new country, add an entry here and implement its scrapers.
 */

export interface CountryConfig {
  code: string;           // short code used in TARGET_COUNTRIES
  label: string;          // display name
  linkedinGeoId: string;  // LinkedIn geoId for search URL
  locationRegions: string[]; // location terms for filtering (city names, regions)
  /** Scraper keys that are specific to this country (run ONLY when this country is selected) */
  scrapers: string[];
  /** Scrapers to auto-enable when this country is selected */
  defaultEnabled: string[];
}

// Bare-remote handling lives in the filter (services/location-filter.ts
// uses GENERIC_REMOTE_TERMS + the user's INCLUDE_REMOTE flag to decide
// whether tagless "Remote" jobs pass). DO NOT add "remote"/"hybrid"/
// "worldwide" into country locationRegions here - that would short-
// circuit the INCLUDE_REMOTE check and let bare-remote jobs through
// even when the user explicitly turned it off.

export const COUNTRY_REGISTRY: Record<string, CountryConfig> = {
  ireland: {
    code: "ireland",
    label: "Ireland",
    linkedinGeoId: "104738515",
    // STRICT: Ireland-only locations. Previously this list also leaked
    // UK + every major EU country/city, which meant "select Ireland"
    // surfaced jobs from Berlin, Paris, London, etc. That defeats the
    // point of a country picker. Northern Ireland (Belfast, Derry,
    // Lisburn) stays in because it's geographically Ireland even if
    // politically UK. Use the UK option to target Britain.
    locationRegions: [
      "ireland", "republic of ireland", "northern ireland", "éire", "eire",
      "dublin", "cork", "galway", "limerick", "waterford", "belfast",
      "kilkenny", "wexford", "sligo", "drogheda", "dundalk",
      "athlone", "ennis", "tralee", "killarney", "letterkenny", "carlow", "maynooth",
      "swords", "malahide", "shannon", "derry", "lisburn",
      "louth", "meath", "kildare", "donegal", "mayo", "clare", "kerry",
      "tipperary", "wicklow", "wexford", "longford", "cavan", "monaghan",
    ],
    scrapers: [
      "SCRAPE_JOBSIE", "SCRAPE_IRISHJOBS", "SCRAPE_INDEED_IE", "SCRAPE_GRADIRELAND",
    ],
    defaultEnabled: [
      "SCRAPE_REMOTEOK", "SCRAPE_JOBICY", "SCRAPE_ARBEITNOW", "SCRAPE_REMOTIVE",
      "SCRAPE_HN", "SCRAPE_WWR", "SCRAPE_DEVTO", "SCRAPE_CAREERJET",
      "SCRAPE_JOBSIE", "SCRAPE_IRISHJOBS", "SCRAPE_INDEED_IE", "SCRAPE_GRADIRELAND",
    ],
  },

  uk: {
    code: "uk",
    label: "United Kingdom",
    // LinkedIn's canonical UK geoId. If you ever see worldwide results in
    // the run logs despite selecting UK, it usually means this value drifted
    // and needs re-verifying via LinkedIn's search URL typeahead.
    linkedinGeoId: "101165590",
    // STRICT UK only. Previously included europe / eu / emea which let
    // continental-Europe jobs (and Ireland-tagged-Europe jobs) leak in
    // when the user explicitly picked UK. If you want EU jobs, that's a
    // future "Europe" option, not the UK one.
    locationRegions: [
      "united kingdom", "uk", "u.k.", "great britain", "britain",
      "england", "scotland", "wales", "northern ireland",
      "london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol",
      "leeds", "cambridge", "oxford", "liverpool", "newcastle", "sheffield",
      "nottingham", "cardiff", "belfast", "aberdeen", "brighton", "reading",
      "coventry", "leicester", "southampton", "portsmouth", "milton keynes",
      "luton", "bath", "york", "norwich", "exeter", "plymouth", "swansea",
      "hull", "preston", "stoke", "wolverhampton", "derby", "sunderland",
    ],
    scrapers: ["SCRAPE_INDEED_UK"],
    defaultEnabled: [
      "SCRAPE_REMOTEOK", "SCRAPE_JOBICY", "SCRAPE_ARBEITNOW", "SCRAPE_REMOTIVE",
      "SCRAPE_HN", "SCRAPE_WWR", "SCRAPE_DEVTO", "SCRAPE_CAREERJET",
      "SCRAPE_INDEED_UK",
    ],
  },

  netherlands: {
    code: "netherlands",
    label: "Netherlands",
    linkedinGeoId: "102890719",
    // STRICT Netherlands only. EU/Europe terms removed.
    locationRegions: [
      "netherlands", "holland", "the netherlands", "nederland",
      "amsterdam", "rotterdam", "the hague", "den haag", "utrecht", "eindhoven",
      "groningen", "tilburg", "almere", "breda", "nijmegen", "haarlem", "arnhem",
      "enschede", "leiden", "delft", "maastricht", "apeldoorn", "amersfoort",
      "zwolle", "dordrecht", "alkmaar", "leeuwarden",
    ],
    scrapers: ["SCRAPE_INDEED_NL"],
    defaultEnabled: [
      "SCRAPE_REMOTEOK", "SCRAPE_JOBICY", "SCRAPE_ARBEITNOW", "SCRAPE_REMOTIVE",
      "SCRAPE_HN", "SCRAPE_WWR", "SCRAPE_DEVTO", "SCRAPE_CAREERJET",
      "SCRAPE_INDEED_NL",
    ],
  },

  india: {
    code: "india",
    label: "India",
    linkedinGeoId: "102713980",
    locationRegions: [
      "india", "bharat",
      "bangalore", "bengaluru", "hyderabad", "mumbai", "pune",
      "chennai", "delhi", "new delhi", "noida", "gurgaon", "gurugram", "kolkata",
      "ahmedabad", "jaipur", "lucknow", "kochi", "thiruvananthapuram", "coimbatore",
      "chandigarh", "indore", "bhopal", "nagpur", "visakhapatnam", "mysore",
      "mangalore", "trivandrum", "goa", "surat", "vadodara", "rajkot",
      "karnataka", "maharashtra", "tamil nadu", "telangana", "kerala",
      "andhra pradesh", "west bengal", "uttar pradesh", "gujarat", "rajasthan",
      "madhya pradesh", "haryana", "punjab",
    ],
    scrapers: [
      "SCRAPE_NAUKRI", "SCRAPE_INSTAHYRE", "SCRAPE_INDEED_IN",
    ],
    defaultEnabled: [
      "SCRAPE_REMOTEOK", "SCRAPE_JOBICY", "SCRAPE_REMOTIVE",
      "SCRAPE_HN", "SCRAPE_DEVTO",
      "SCRAPE_NAUKRI", "SCRAPE_INSTAHYRE", "SCRAPE_INDEED_IN",
    ],
  },
  newzealand: {
    code: "newzealand",
    label: "New Zealand",
    linkedinGeoId: "105490917",
    locationRegions: [
      "new zealand", "nz", "aotearoa",
      "auckland", "wellington", "christchurch", "hamilton", "tauranga",
      "dunedin", "palmerston north", "napier", "nelson", "rotorua",
      "new plymouth", "whangarei", "invercargill", "queenstown",
    ],
    scrapers: ["SCRAPE_INDEED_NZ"],
    defaultEnabled: [
      "SCRAPE_REMOTEOK", "SCRAPE_JOBICY", "SCRAPE_REMOTIVE",
      "SCRAPE_HN", "SCRAPE_WWR", "SCRAPE_DEVTO", "SCRAPE_CAREERJET",
      "SCRAPE_INDEED_NZ",
    ],
  },
};

/** Global scrapers that run regardless of country selection */
export const GLOBAL_SCRAPERS = [
  "SCRAPE_REMOTEOK", "SCRAPE_JOBICY", "SCRAPE_ARBEITNOW", "SCRAPE_REMOTIVE",
  "SCRAPE_HN", "SCRAPE_WWR", "SCRAPE_DEVTO", "SCRAPE_CAREERJET", "SCRAPE_GLASSDOOR",
];

/** Get combined location regions for selected countries */
export function getLocationRegions(countryCodes: string[]): string[] {
  const regions: string[] = [];
  for (const code of countryCodes) {
    const country = COUNTRY_REGISTRY[code.toLowerCase()];
    if (country) regions.push(...country.locationRegions);
  }
  // Always include remote terms
  regions.push("remote", "hybrid", "worldwide", "global", "anywhere");
  return [...new Set(regions)];
}

/** Get LinkedIn geoId - uses first selected country's geoId */
export function getLinkedInGeoId(countryCodes: string[]): string {
  for (const code of countryCodes) {
    const country = COUNTRY_REGISTRY[code.toLowerCase()];
    if (country) return country.linkedinGeoId;
  }
  return "92000000"; // worldwide fallback
}

/** Check if a scraper should run for the given country selection */
export function shouldRunScraper(scraperKey: string, countryCodes: string[]): boolean {
  // Global scrapers run for any country
  if (GLOBAL_SCRAPERS.includes(scraperKey)) return true;
  // Country-specific scrapers run only when their country is selected
  for (const code of countryCodes) {
    const country = COUNTRY_REGISTRY[code.toLowerCase()];
    if (country?.scrapers.includes(scraperKey)) return true;
  }
  return false;
}
