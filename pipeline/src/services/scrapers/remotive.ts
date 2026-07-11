import { ScrapedJob } from "../../types";
import { politeGet, isLocationRelevant, isRecentJob } from "./utils";

/** Remotive.com free API - https://remotive.com/api/remote-jobs */
export async function scrapeRemotive(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const categories = ["data", "software-dev", "devops-sysadmin", "machine-learning"];

  for (const cat of categories) {
    try {
      const res = await politeGet(`https://remotive.com/api/remote-jobs?category=${cat}&limit=100`);
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const item of data.jobs || []) {
        const title = (item.title || "").toLowerCase();
        const desc = (item.description || "").replace(/<[^>]+>/g, " ").trim();
        const location = item.candidate_required_location || "";
        if (!isRecentJob(item.publication_date)) continue;
        const kwMatch = keywords.some((kw) => title.includes(kw.toLowerCase()));
        if (!kwMatch) continue;
        // Early reject: skip jobs explicitly restricted to US/North America only
        const locLower = location.toLowerCase();
        if (/\b(us only|usa only|north america only|canada only|india only)\b/i.test(locLower)) continue;
        if (!isLocationRelevant(location, desc)) continue;
        jobs.push({
          title: item.title,
          companyName: item.company_name || "",
          link: item.url || "",
          location,
          salary: item.salary || "",
          descriptionText: desc.slice(0, 3000),
          postedAt: item.publication_date || undefined,
          tags: item.tags || [],
          source: "remotive",
          externalId: String(item.id),
        });
      }
    } catch {}
  }
  return jobs;
}
