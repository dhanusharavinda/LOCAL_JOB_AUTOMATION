/**
 * Naukri.com scraper — India's largest job board.
 * Uses their public search API endpoint.
 */

import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";

export async function scrapeNaukri(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  // Scrape more keywords (up to 5) and multiple pages per keyword for volume
  for (const kw of keywords.slice(0, 5)) {
    for (const page of [1, 2, 3]) {
    try {
      // Naukri search URL — paginated
      const slug = kw.toLowerCase().replace(/\s+/g, "-");
      const url = `https://www.naukri.com/${slug}-jobs-${page}?k=${encodeURIComponent(kw)}&experience=0&jobAge=15`;

      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();

      // Try to extract from embedded JSON data (Naukri uses SSR with __NEXT_DATA__ or similar)
      const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const jobList = data?.props?.pageProps?.initialState?.searchResult?.jobListing ||
                          data?.props?.pageProps?.response?.jobDetails || [];

          for (const item of (Array.isArray(jobList) ? jobList : [])) {
            const title = item.title || item.jobTitle || "";
            const company = item.companyName || item.company || "";
            const location = item.placeholders?.find?.((p: any) => p.type === "location")?.label ||
                            item.location || item.ambiguityInfo?.location || "";
            const salary = item.placeholders?.find?.((p: any) => p.type === "salary")?.label ||
                          item.salary || "";
            const link = item.jdURL ? `https://www.naukri.com${item.jdURL}` :
                        item.jobId ? `https://www.naukri.com/job-listings-${item.jobId}` : "";

            if (!title || !company) continue;
            jobs.push({
              title,
              companyName: company,
              link,
              applyUrl: link,
              location: location || "India",
              salary,
              descriptionText: item.jobDescription || item.snippet || "",
              postedAt: item.createdDate || item.footerPlaceholderLabel || "",
              source: "naukri",
              tags: ["naukri", "india"],
            });
          }
        } catch {}
      }

      // Fallback: HTML scraping
      if (jobs.length === 0) {
        const $ = cheerio.load(html);
        $(".srp-jobtuple-wrapper, .jobTuple, [data-job-id], .cust-job-tuple").each((_, el) => {
          const title = $(el).find(".title, .jobTitle, a.title").text().trim();
          const company = $(el).find(".comp-name, .companyInfo .subTitle, .company-name").text().trim();
          const location = $(el).find(".loc, .locWdth, .location").text().trim();
          const salary = $(el).find(".sal, .salary").text().trim();
          const link = $(el).find("a.title, a[href*='job-listings']").attr("href") || "";

          if (!title) return;
          jobs.push({
            title,
            companyName: company || "Company",
            link: link.startsWith("http") ? link : `https://www.naukri.com${link}`,
            location: location || "India",
            salary,
            source: "naukri",
            tags: ["naukri", "india"],
          });
        });
      }
    } catch {}
    } // end page loop
  }
  return jobs;
}
