import { ScrapedJob } from "../../types";
import { politeGet, isRecentJob, isLocationRelevant } from "./utils";

/** Jobicy free API - has Ireland geo filter https://jobicy.com/api/v2/remote-jobs */
export async function scrapeJobicy(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const kwList = keywords.slice(0, 3); // API supports tag filtering

  for (const kw of kwList) {
    try {
      // Only fetch Ireland/EU geos - no global fallback to avoid US/India jobs
      for (const geo of ["ireland", "uk", "europe"]) {
        const params = new URLSearchParams({ count: "50", geo, tag: kw });
        const res = await politeGet(`https://jobicy.com/api/v2/remote-jobs?${params}`);
        if (!res.ok) continue;
        const data: any = await res.json();
        for (const item of data.jobs || []) {
          if (!isRecentJob(item.pubDate)) continue;
          const location = item.jobGeo || "";
          const desc = (item.jobDescription || "").replace(/<[^>]+>/g, " ").trim();
          if (!isLocationRelevant(location, desc)) continue;
          jobs.push({
            title: item.jobTitle || "",
            companyName: item.companyName || "",
            link: item.url || "",
            location,
            salary: item.annualSalaryMin
              ? `$${item.annualSalaryMin}–$${item.annualSalaryMax}`
              : (item.salary || ""),
            descriptionText: desc,
            postedAt: item.pubDate || undefined,
            employmentType: item.jobType || "",
            source: "jobicy",
            externalId: String(item.id),
          });
        }
      }
    } catch {}
  }
  return jobs;
}
