import { ScrapedJob } from "../../types";
import { politeGet, isLocationRelevant, isRecentJob } from "./utils";

/** Arbeitnow free API - https://www.arbeitnow.com/api/job-board-api */
export async function scrapeArbeitnow(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  try {
    // Arbeitnow supports ?remote=true, ?location=, and ?tags[]=
    // Query both Ireland-specific and remote jobs
    const geos = ["ireland", "uk", "germany", "netherlands", ""];
    for (const kw of keywords.slice(0, 3)) {
      for (const geo of geos) {
        const params = new URLSearchParams({ ...(geo ? { location: geo } : { remote: "true" }), "tags[]": kw });
        const res = await politeGet(`https://www.arbeitnow.com/api/job-board-api?${params}`);
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const item of data.data || []) {
        const title = item.title || "";
        const desc = (item.description || "").replace(/<[^>]+>/g, " ").trim();
        const location = item.location || "";
        const kwLower = kw.toLowerCase();
        if (!isRecentJob(item.created_at)) continue;
        if (!title.toLowerCase().includes(kwLower) && !desc.toLowerCase().includes(kwLower)) continue;
        if (!isLocationRelevant(location, desc)) continue;
        jobs.push({
          title,
          companyName: item.company_name || "",
          link: item.url || `https://www.arbeitnow.com/jobs/${item.slug}`,
          location,
          descriptionText: desc.slice(0, 3000),
          postedAt: item.created_at || undefined,
          tags: item.tags || [],
          employmentType: item.job_types?.[0] || "",
          source: "arbeitnow",
          externalId: item.slug,
        });
      }
      }
    }
  } catch {}
  return jobs;
}
