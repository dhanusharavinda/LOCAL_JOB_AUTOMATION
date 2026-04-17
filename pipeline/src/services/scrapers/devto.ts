import { ScrapedJob } from "../../types";
import { politeGet, isLocationRelevant, isRecentJob } from "./utils";

/** dev.to job listings API — https://dev.to/api/listings?category=jobs */
export async function scrapeDevTo(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  try {
    for (const kw of keywords.slice(0, 3)) {
      const res = await politeGet(
        `https://dev.to/api/listings?category=jobs&per_page=50&tag=${encodeURIComponent(kw)}`
      );
      if (!res.ok) continue;
      const data = (await res.json()) as any[];
      for (const item of data) {
        const title = item.title || "";
        const body = item.body_markdown || "";
        const locationHint = item.location || item.tag_list?.join(" ") || "";
        if (!isRecentJob(item.created_at)) continue;
        if (!isLocationRelevant(locationHint, body)) continue;
        jobs.push({
          title,
          companyName: item.user?.name || item.organization?.name || "Company",
          link: `https://dev.to${item.path || ""}`,
          descriptionText: body.slice(0, 3000),
          postedAt: item.created_at || undefined,
          tags: item.tag_list || [],
          source: "devto",
          externalId: String(item.id),
        });
      }
    }
  } catch {}
  return jobs;
}
