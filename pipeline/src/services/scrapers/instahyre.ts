/**
 * Instahyre scraper - popular India tech hiring platform.
 * Scrapes from their public job listings page.
 */

import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";

export async function scrapeInstahyre(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  for (const kw of keywords.slice(0, 5)) {
    try {
      const url = `https://www.instahyre.com/search-jobs/?designation=${encodeURIComponent(kw)}&location=&experience=0-5`;

      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();

      // Try extracting from JSON-LD or embedded data
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      if (jsonLdMatch) {
        for (const match of jsonLdMatch) {
          try {
            const json = JSON.parse(match.replace(/<\/?script[^>]*>/g, ""));
            if (json["@type"] === "JobPosting" || (Array.isArray(json) && json[0]?.["@type"] === "JobPosting")) {
              const postings = Array.isArray(json) ? json : [json];
              for (const posting of postings) {
                const title = posting.title || "";
                const company = posting.hiringOrganization?.name || "";
                const location = posting.jobLocation?.address?.addressLocality ||
                                posting.jobLocation?.name || "India";
                const link = posting.url || "";
                if (!title) continue;
                jobs.push({
                  title,
                  companyName: company || "Company",
                  link,
                  applyUrl: link,
                  location,
                  descriptionText: posting.description?.replace(/<[^>]*>/g, "").slice(0, 500) || "",
                  postedAt: posting.datePosted || "",
                  source: "instahyre",
                  tags: ["instahyre", "india"],
                });
              }
            }
          } catch {}
        }
      }

      // Fallback: HTML scraping
      if (jobs.length === 0) {
        const $ = cheerio.load(html);
        $(".job-card, .opportunity-card, [class*='jobCard'], [class*='job-listing']").each((_, el) => {
          const title = $(el).find("h3, .job-title, [class*='designation']").first().text().trim();
          const company = $(el).find(".company-name, [class*='company']").first().text().trim();
          const location = $(el).find(".location, [class*='location']").first().text().trim();
          const link = $(el).find("a").first().attr("href") || "";

          if (!title) return;
          jobs.push({
            title,
            companyName: company || "Company",
            link: link.startsWith("http") ? link : `https://www.instahyre.com${link}`,
            location: location || "India",
            source: "instahyre",
            tags: ["instahyre", "india"],
          });
        });
      }
    } catch {}
  }
  return jobs;
}
