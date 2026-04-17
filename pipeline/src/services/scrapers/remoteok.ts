import { ScrapedJob } from "../../types";
import { politeGet, isLocationRelevant, isRecentJob } from "./utils";

/** RemoteOK free public API — https://remoteok.com/api */
export async function scrapeRemoteOK(keywords: string[]): Promise<ScrapedJob[]> {
  try {
    const res = await politeGet("https://remoteok.com/api");
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    const jobs: ScrapedJob[] = [];

    for (const item of data) {
      if (!item.position || !item.company) continue;
      const postedIso = item.date ? new Date(item.date * 1000).toISOString() : undefined;
      if (!isRecentJob(postedIso)) continue;
      const desc = item.description || "";
      const location = item.location || "";
      if (!isLocationRelevant(location, desc)) continue;
      jobs.push({
        title: item.position,
        companyName: item.company,
        link: `https://remoteok.com/remote-jobs/${item.slug || item.id}`,
        applyUrl: item.apply_url || item.url,
        location,
        salary: item.salary || (item.salary_min && item.salary_max ? `$${item.salary_min}–$${item.salary_max}` : item.salary_min ? `$${item.salary_min}+` : ""),
        descriptionText: desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        postedAt: item.date ? new Date(item.date * 1000).toISOString() : undefined,
        tags: item.tags || [],
        source: "remoteok",
        externalId: String(item.id || item.slug),
      });
    }
    return jobs;
  } catch { return []; }
}
