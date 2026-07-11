import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";

/** Jobs.ie HTML scraper - Irish job board */
export async function scrapeJobsIe(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  for (const kw of keywords.slice(0, 3)) {
    try {
      const slug = kw.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const url = `https://www.jobs.ie/jobs/${encodeURIComponent(slug)}-jobs/in-ireland/`;
      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      $("article.job, .job-card, [class*='JobCard'], [class*='job-item']").each((_, el) => {
        const title = $(el).find("h2, h3, [class*='title'], [class*='Title']").first().text().trim();
        const company = $(el).find("[class*='company'], [class*='Company'], [class*='employer']").first().text().trim();
        const location = $(el).find("[class*='location'], [class*='Location']").first().text().trim();
        const link = $(el).find("a").first().attr("href") || "";
        const salary = $(el).find("[class*='salary'], [class*='Salary']").first().text().trim();
        const posted = $(el).find("[class*='date'], [class*='Date'], time").first().attr("datetime") || "";
        if (!title || !company) return;
        const fullLink = link.startsWith("http") ? link : `https://www.jobs.ie${link}`;
        jobs.push({
          title, companyName: company, link: fullLink, location,
          salary, postedAt: posted || undefined,
          source: "jobs.ie", externalId: fullLink,
        });
      });
    } catch {}
  }
  return jobs;
}
