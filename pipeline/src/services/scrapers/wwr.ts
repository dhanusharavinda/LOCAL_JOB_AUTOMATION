import { ScrapedJob } from "../../types";
import { politeGet, isLocationRelevant, isRecentJob } from "./utils";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false });

/** We Work Remotely RSS feed */
export async function scrapeWWR(keywords: string[]): Promise<ScrapedJob[]> {
  const feeds = [
    "https://weworkremotely.com/remote-jobs.rss",
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-data-science-jobs.rss",
  ];
  const jobs: ScrapedJob[] = [];

  for (const url of feeds) {
    try {
      const res = await politeGet(url);
      if (!res.ok) continue;
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const items: any[] = parsed?.rss?.channel?.item || [];

      for (const item of items) {
        const title = item.title || "";
        const desc = (item.description || "").replace(/<[^>]+>/g, " ").trim();
        const region = item.region || "Remote";
        const postedIso = item.pubDate ? new Date(item.pubDate).toISOString() : undefined;
        if (!isRecentJob(postedIso)) continue;
        const kwMatch = keywords.some((kw) => title.toLowerCase().includes(kw.toLowerCase()));
        if (!kwMatch) continue;
        if (!isLocationRelevant(region, desc)) continue;
        const link = item.link || item.url || "";
        jobs.push({
          title,
          companyName: (item["dc:company"] || item.company || "").replace(/<[^>]+>/g, "").trim(),
          link,
          location: region,
          descriptionText: desc.slice(0, 3000),
          postedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
          source: "weworkremotely",
          externalId: link,
        });
      }
    } catch {}
  }
  return jobs;
}
