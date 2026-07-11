import { ScrapedJob } from "../../types";
import { politeGet, isLocationRelevant } from "./utils";
import * as cheerio from "cheerio";

/**
 * Glassdoor scraper - scrapes job listings from Glassdoor Ireland.
 * Uses HTML parsing (no API key needed). Targets glassdoor.ie with Ireland location.
 */
export async function scrapeGlassdoor(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const seen = new Set<string>();

  for (const kw of keywords.slice(0, 3)) {
    try {
      // Glassdoor Ireland search - location locked to Ireland
      const url = `https://www.glassdoor.ie/Job/ireland-${encodeURIComponent(kw.replace(/\s+/g, "-"))}-jobs-SRCH_IL.0,7_IN104_KO8,${8 + kw.replace(/\s+/g, "-").length}.htm?sortBy=date_desc`;
      const res = await politeGet(url, 20000);
      if (!res.ok) {
        // Fallback: try the simpler search URL format
        const fallbackUrl = `https://www.glassdoor.ie/Job/jobs.htm?sc.keyword=${encodeURIComponent(kw)}&locT=N&locId=104&locKeyword=Ireland&sortBy=date_desc`;
        const fallbackRes = await politeGet(fallbackUrl, 20000);
        if (!fallbackRes.ok) continue;
        const html = await fallbackRes.text();
        parseGlassdoorHTML(html, jobs, seen, kw);
        continue;
      }
      const html = await res.text();
      parseGlassdoorHTML(html, jobs, seen, kw);
    } catch (e: any) { /* logged by orchestrator withLog */ }
  }

  return jobs;
}

function parseGlassdoorHTML(html: string, jobs: ScrapedJob[], seen: Set<string>, keyword: string): void {
  const $ = cheerio.load(html);

  // Method 1: Extract from JSON-LD structured data (most reliable)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "{}");
      const items = Array.isArray(data) ? data : data["@type"] === "JobPosting" ? [data] : [];
      for (const item of items) {
        if (item["@type"] !== "JobPosting") continue;
        const title = item.title || "";
        const company = item.hiringOrganization?.name || "";
        const id = item.identifier?.value || item.url || `${title}-${company}`;
        if (!title || !company || seen.has(id)) continue;
        seen.add(id);

        const loc = extractLocation(item.jobLocation);
        if (!isLocationRelevant(loc, item.description || "")) continue;

        jobs.push({
          title,
          companyName: company,
          link: item.url || "",
          applyUrl: item.url || "",
          location: loc || "Ireland",
          salary: extractSalary(item.baseSalary),
          descriptionText: (item.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
          postedAt: item.datePosted || undefined,
          employmentType: Array.isArray(item.employmentType) ? item.employmentType.join(", ") : item.employmentType || "",
          source: "glassdoor",
          externalId: String(id),
        });
      }
    } catch (e: any) { /* logged by orchestrator withLog */ }
  });

  // Method 2: Parse HTML job cards directly (fallback)
  if (jobs.length === 0) {
    $('[data-test="jobListing"], .JobsList_jobListItem__wjTHv, li[data-jobid], .react-job-listing').each((_, el) => {
      try {
        const title = $(el).find('[data-test="job-title"], .JobCard_jobTitle__GLyJ1, a.jobTitle').text().trim();
        const company = $(el).find('[data-test="emp-name"], .EmployerProfile_compactEmployerName__9MGcV, .employerName').text().trim()
          .replace(/[\d.]+$/, "").trim(); // Remove trailing rating number
        const location = $(el).find('[data-test="emp-location"], .JobCard_location__rCz3x, .location').text().trim();
        const linkEl = $(el).find('a[href*="/job-listing/"], a[href*="/partner/"], a.jobTitle').first();
        let link = linkEl.attr("href") || "";
        if (link && !link.startsWith("http")) link = `https://www.glassdoor.ie${link}`;
        const salary = $(el).find('[data-test="detailSalary"], .JobCard_salaryEstimate__QpbTW, .salary-estimate').text().trim();

        if (!title) return;
        const id = link || `${title}-${company}`;
        if (seen.has(id)) return;
        seen.add(id);

        jobs.push({
          title,
          companyName: company || "Company",
          link,
          location: location || "Ireland",
          salary: salary || "",
          source: "glassdoor",
          externalId: id,
        });
      } catch (e: any) { /* logged by orchestrator withLog */ }
    });
  }
}

function extractLocation(jobLocation: any): string {
  if (!jobLocation) return "";
  if (typeof jobLocation === "string") return jobLocation;
  if (Array.isArray(jobLocation)) {
    return jobLocation.map((l) => extractLocation(l)).filter(Boolean).join(", ");
  }
  const parts = [
    jobLocation.address?.addressLocality,
    jobLocation.address?.addressRegion,
    jobLocation.address?.addressCountry,
  ].filter(Boolean);
  return parts.join(", ");
}

function extractSalary(baseSalary: any): string {
  if (!baseSalary) return "";
  if (typeof baseSalary === "string") return baseSalary;
  const value = baseSalary.value;
  if (!value) return "";
  const currency = baseSalary.currency || "EUR";
  if (value.minValue && value.maxValue) {
    return `${currency} ${value.minValue}–${value.maxValue}`;
  }
  if (value.value) return `${currency} ${value.value}`;
  return "";
}
