import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";

/** Indeed NL — mirrors indeed-ie.ts but targets nl.indeed.com with an Amsterdam default location. */
export async function scrapeIndeedNL(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  for (const kw of keywords.slice(0, 3)) {
    try {
      const url = `https://nl.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Amsterdam&fromage=14&sort=date`;
      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();

      const mosaicMatch = html.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*({[\s\S]*?});\s*window\.mosaic/);
      if (mosaicMatch) {
        try {
          const mosaic = JSON.parse(mosaicMatch[1]);
          const results = mosaic?.metaData?.mosaicProviderJobCardsModel?.results || [];
          for (const item of results) {
            const title = item.title || item.displayTitle || "";
            const company = item.company || item.companyBrandingAttributes?.companyName || "";
            const location = item.jobLocationCity
              ? `${item.jobLocationCity}, ${item.jobLocationState || "Netherlands"}`
              : "Amsterdam, Netherlands";
            const salary = item.salarySnippet?.text || item.estimatedSalary?.text || "";
            const jobKey = item.jobkey || item.jobId || "";
            jobs.push({
              title,
              companyName: company,
              link: `https://nl.indeed.com/viewjob?jk=${jobKey}`,
              applyUrl: item.thirdPartyApplyUrl || `https://nl.indeed.com/viewjob?jk=${jobKey}`,
              location,
              salary,
              descriptionText: item.snippet || "",
              postedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
              source: "indeed_nl",
              externalId: jobKey,
            });
          }
        } catch {}
      }

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
            link: `https://nl.indeed.com/viewjob?jk=${jobKey}`,
            location: location || "Amsterdam, Netherlands",
            source: "indeed_nl",
            externalId: jobKey,
          });
        });
      }
    } catch {}
  }
  return jobs;
}
