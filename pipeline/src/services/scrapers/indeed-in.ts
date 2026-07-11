/**
 * Indeed India scraper - indeed.co.in
 * Same approach as Indeed IE but targeting India domain.
 */

import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";

export async function scrapeIndeedIndia(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  // Scrape more keywords (up to 5) and 2 pages per keyword
  for (const kw of keywords.slice(0, 5)) {
    for (const start of [0, 10]) {
    try {
      const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(kw)}&fromage=14&sort=date&start=${start}`;
      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();

      // Extract mosaic-provider-jobcards JSON (same approach as Indeed IE)
      const mosaicMatch = html.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*({[\s\S]*?});\s*window\.mosaic/);
      if (mosaicMatch) {
        try {
          const mosaic = JSON.parse(mosaicMatch[1]);
          const results = mosaic?.metaData?.mosaicProviderJobCardsModel?.results || [];
          for (const item of results) {
            const title = item.title || item.displayTitle || "";
            const company = item.company || item.companyBrandingAttributes?.companyName || "";
            const location = item.jobLocationCity
              ? `${item.jobLocationCity}, ${item.jobLocationState || "India"}`
              : "India";
            const salary = item.salarySnippet?.text || item.estimatedSalary?.text || "";
            const jobKey = item.jobkey || item.jobId || "";
            if (!title) continue;
            jobs.push({
              title,
              companyName: company || "Company",
              link: `https://in.indeed.com/viewjob?jk=${jobKey}`,
              applyUrl: item.thirdPartyApplyUrl || `https://in.indeed.com/viewjob?jk=${jobKey}`,
              location,
              salary,
              descriptionText: item.snippet || "",
              postedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
              source: "indeed_in",
              externalId: jobKey,
              tags: ["indeed", "india"],
            });
          }
        } catch {}
      }

      // Fallback: HTML scraping
      if (jobs.length === 0) {
        const $ = cheerio.load(html);
        $(".job_seen_beacon, .tapItem, [data-jk]").each((_, el) => {
          const title = $(el).find("h2.jobTitle span, [class*='jobTitle']").text().trim();
          const company = $(el).find("[data-testid='company-name'], .companyName").text().trim();
          const location = $(el).find("[data-testid='text-location'], .companyLocation").text().trim();
          const jobKey = $(el).attr("data-jk") || $(el).find("a").first().attr("data-jk") || "";
          if (!title) return;
          jobs.push({
            title,
            companyName: company || "Company",
            link: `https://in.indeed.com/viewjob?jk=${jobKey}`,
            location: location || "India",
            source: "indeed_in",
            externalId: jobKey,
            tags: ["indeed", "india"],
          });
        });
      }
    } catch {}
    } // end page loop
  }
  return jobs;
}
