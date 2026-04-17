/**
 * Country Registry — defines scrapers, LinkedIn geoId, location terms per country.
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

export const COUNTRY_REGISTRY: Record<string, CountryConfig> = {
  ireland: {
    code: "ireland",
    label: "Ireland",
    linkedinGeoId: "104738515",
    locationRegions: [
      "ireland", "dublin", "cork", "galway", "limerick", "waterford", "belfast",
      "republic of ireland", "kilkenny", "wexford", "sligo", "drogheda", "dundalk",
      "athlone", "ennis", "tralee", "killarney", "letterkenny", "carlow", "maynooth",
      "swords", "malahide", "shannon", "northern ireland", "derry", "lisburn",
      "united kingdom", "uk", "england", "scotland", "wales",
      "london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol",
      "leeds", "cambridge", "oxford", "liverpool",
      "europe", "eu", "emea", "netherlands", "germany", "france", "spain", "italy",
      "portugal", "belgium", "austria", "switzerland", "sweden", "denmark",
      "norway", "finland", "poland", "czech", "amsterdam", "berlin", "munich",
      "paris", "barcelona", "madrid", "lisbon", "brussels", "vienna", "zurich",
      "stockholm", "copenhagen",
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
    locationRegions: [
      "united kingdom", "uk", "england", "scotland", "wales", "northern ireland",
      "london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol",
      "leeds", "cambridge", "oxford", "liverpool", "newcastle", "sheffield",
      "nottingham", "cardiff", "belfast", "aberdeen", "brighton", "reading",
      "coventry", "leicester", "southampton", "portsmouth",
      // Shared EU / remote terms so remote-from-UK jobs surface too
      "europe", "eu", "emea", "remote", "hybrid", "worldwide", "global",
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
    locationRegions: [
      "netherlands", "holland", "the netherlands",
      "amsterdam", "rotterdam", "the hague", "den haag", "utrecht", "eindhoven",
      "groningen", "tilburg", "almere", "breda", "nijmegen", "haarlem", "arnhem",
      "enschede", "leiden", "delft", "maastricht",
      "europe", "eu", "emea", "remote", "hybrid", "worldwide", "global",
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
      "india", "bangalore", "bengaluru", "hyderabad", "mumbai", "pune",
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

/** Get LinkedIn geoId — uses first selected country's geoId */
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
