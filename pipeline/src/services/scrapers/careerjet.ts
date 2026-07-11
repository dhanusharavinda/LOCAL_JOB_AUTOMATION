import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import { config } from "../../config";

/**
 * CareerJet public API - free without affiliate ID (limited results).
 * With an affiliate ID, full results are returned: register at
 * https://www.careerjet.com/partners/
 *
 * Multi-country: CareerJet accepts locale_code + location per request,
 * so we pick the pair that matches the user's TARGET_COUNTRIES. Without
 * this, the scraper would always return Dublin jobs regardless of which
 * country the user selected on the landing page.
 */

interface CareerJetLocale {
  location: string;
  locale_code: string;
  site: string;
  defaultLocation: string;
}

const CAREERJET_LOCALES: Record<string, CareerJetLocale> = {
  ireland:     { location: "Dublin, Ireland",    locale_code: "en_IE", site: "https://www.careerjet.ie/",    defaultLocation: "Dublin, Ireland" },
  uk:          { location: "London, UK",         locale_code: "en_GB", site: "https://www.careerjet.co.uk/", defaultLocation: "London, UK" },
  netherlands: { location: "Amsterdam",          locale_code: "nl_NL", site: "https://www.careerjet.nl/",    defaultLocation: "Amsterdam, Netherlands" },
  india:       { location: "Bangalore, India",   locale_code: "en_IN", site: "https://www.careerjet.co.in/", defaultLocation: "Bangalore, India" },
};

export async function scrapeCareerJet(keywords: string[], affiliateId?: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const affid = affiliateId || "4a939b0eed45bb66e01f7cd200c63ca5"; // fallback public test key

  // Pick the locale matching the user's first selected country. Falls
  // back to Ireland for legacy configs that never set TARGET_COUNTRIES.
  const firstCountry = config.TARGET_COUNTRIES.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)[0] || "ireland";
  const locale = CAREERJET_LOCALES[firstCountry] || CAREERJET_LOCALES.ireland;

  for (const kw of keywords.slice(0, 3)) {
    try {
      const params = new URLSearchParams({
        affid,
        keywords: kw,
        location: locale.location,
        locale_code: locale.locale_code,
        sort: "date",
        pagesize: "20",
        user_ip: "1.2.3.4",
        url: locale.site,
        user_agent: "Mozilla/5.0",
      });
      const res = await politeGet(`https://public.api.careerjet.net/search?${params}`);
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const item of data.jobs || []) {
        jobs.push({
          title: item.title || "",
          companyName: item.company || "",
          link: item.url || "",
          location: item.locations || locale.defaultLocation,
          salary: item.salary || "",
          descriptionText: (item.description || "").slice(0, 2000),
          postedAt: item.date || undefined,
          source: "careerjet",
          externalId: item.url,
        });
      }
    } catch {}
  }
  return jobs;
}
