import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";

/** IrishJobs.ie HTML scraper (StepStone platform) */
export async function scrapeIrishJobs(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  for (const kw of keywords.slice(0, 3)) {
    try {
      const url = `https://www.irishjobs.ie/jobs?query=${encodeURIComponent(kw)}&location=Dublin`;
      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      // StepStone uses data-* attributes for job data
      $("[data-testid='job-item'], article.res-jobboxwrapper, [class*='jobcard'], [class*='JobCard']").each((_, el) => {
        const title = $(el).find("h2 a, h3 a, [data-testid='job-title'], [class*='title']").first().text().trim();
        const company = $(el).find("[data-testid='job-company'], [class*='company'], [class*='employer']").first().text().trim();
        const location = $(el).find("[data-testid='job-location'], [class*='location']").first().text().trim();
        const linkEl = $(el).find("a").first();
        const href = linkEl.attr("href") || "";
        const link = href.startsWith("http") ? href : `https://www.irishjobs.ie${href}`;
        const salary = $(el).find("[class*='salary']").first().text().trim();
        if (!title) return;
        jobs.push({
          title,
          companyName: company || "Company",
          link,
          location: location || "Ireland",
          salary,
          source: "irishjobs",
          externalId: link,
        });
      });
    } catch {}
  }
  return jobs;
}
