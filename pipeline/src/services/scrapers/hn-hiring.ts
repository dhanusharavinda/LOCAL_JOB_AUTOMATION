import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import { config } from "../../config";
import { COUNTRY_REGISTRY } from "../../countries";

/**
 * HN Who's Hiring — scrapes the latest monthly thread via Algolia API.
 *
 * Country-aware: the Algolia query and the post-filter regex are both
 * derived from the user's current TARGET_COUNTRIES so a user looking for
 * India jobs doesn't get Dublin-only HN comments. The per-country
 * location regex comes from COUNTRY_REGISTRY.locationRegions so new
 * countries are picked up automatically.
 */
export async function scrapeHNHiring(keywords: string[]): Promise<ScrapedJob[]> {
  try {
    // Build country-specific location terms from the registry so there's
    // no per-scraper hardcoded city list.
    const activeCountries = config.TARGET_COUNTRIES
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const locationTerms = activeCountries
      .flatMap((code) => COUNTRY_REGISTRY[code]?.locationRegions ?? [])
      .concat(["remote", "worldwide", "global"]);
    // Deduplicate + cap to keep the query manageable. Pick short tokens
    // first since they're the most common on HN comment text (e.g.
    // "london" hits more than "united kingdom").
    const uniqueLocations = Array.from(new Set(locationTerms))
      .filter((t) => t.length <= 20)
      .slice(0, 10);
    const locMatchRegex = uniqueLocations.length > 0
      ? new RegExp("\\b(" + uniqueLocations.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i")
      : /.*/;

    // Get the latest "Who is hiring" post
    const threadRes = await politeGet(
      "https://hn.algolia.com/api/v1/search?tags=ask_hn&query=who+is+hiring&hitsPerPage=1"
    );
    if (!threadRes.ok) return [];
    const threadData: any = await threadRes.json();
    const threadId = threadData.hits?.[0]?.objectID;
    if (!threadId) return [];

    // Query combines the user's keywords with the top few location tokens
    // so Algolia pre-filters; downstream regex confirms.
    const kwQuery = [...keywords.slice(0, 3), ...uniqueLocations.slice(0, 2)].join(" ");
    const commentsRes = await politeGet(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${threadId}&query=${encodeURIComponent(kwQuery)}&hitsPerPage=50`
    );
    if (!commentsRes.ok) return [];
    const commentsData: any = await commentsRes.json();

    const jobs: ScrapedJob[] = [];
    for (const hit of commentsData.hits || []) {
      const text: string = hit.comment_text || "";
      if (!text) continue;
      const lower = text.toLowerCase();
      const kwMatch = keywords.some((kw) => lower.includes(kw.toLowerCase()));
      const locMatch = locMatchRegex.test(lower);
      if (!kwMatch || !locMatch) continue;

      // Try to extract company | role | location from first line of HN comment.
      // If the title can't be parsed, fall back to the user's first keyword
      // (so nurse users get "Registered Nurse", consultants get "Consultant",
      // etc.) — NEVER to a hardcoded "Software Engineer".
      const firstLine = text.replace(/<[^>]+>/g, "").split("\n")[0].trim();
      const parts = firstLine.split(/[|,·]/);
      const company = parts[0]?.trim() || "Company (HN)";
      const title = parts[1]?.trim() || keywords[0] || "Job posting";
      const location = parts[2]?.trim() || "";

      jobs.push({
        title,
        companyName: company,
        link: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        location,
        descriptionText: text.replace(/<[^>]+>/g, " ").trim().slice(0, 2000),
        postedAt: hit.created_at || undefined,
        source: "hn_hiring",
        externalId: hit.objectID,
      });
    }
    return jobs;
  } catch { return []; }
}
