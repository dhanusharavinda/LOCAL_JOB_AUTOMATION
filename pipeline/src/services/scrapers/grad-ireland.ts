import { ScrapedJob } from "../../types";
import { politeGet } from "./utils";
import * as cheerio from "cheerio";
import { log } from "../../logger";

/** GradIreland — graduate jobs Ireland + career events */
export async function scrapeGradIreland(keywords: string[]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  for (const kw of keywords.slice(0, 2)) {
    try {
      const url = `https://gradireland.com/jobs?keywords=${encodeURIComponent(kw)}&location=dublin`;
      const res = await politeGet(url);
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      $(".job-listing-item, [class*='job-card'], article.node--type-job").each((_, el) => {
        const title = $(el).find("h3, h2, [class*='title']").first().text().trim();
        const company = $(el).find("[class*='company'], [class*='employer'], [class*='org']").first().text().trim();
        const location = $(el).find("[class*='location']").first().text().trim() || "Ireland";
        const href = $(el).find("a").first().attr("href") || "";
        const link = href.startsWith("http") ? href : `https://gradireland.com${href}`;
        const deadline = $(el).find("[class*='deadline'], [class*='closing']").first().text().trim();
        if (!title) return;
        jobs.push({
          title,
          companyName: company || "Company",
          link,
          location,
          postedAt: deadline || undefined,
          source: "gradireland",
          externalId: link,
        });
      });
    } catch (err: any) {
      log.warn(`GradIreland job scrape failed for keyword: ${err.message}`);
    }
  }
  return jobs;
}

interface EventResult {
  title: string;
  organizer: string;
  location: string;
  eventDate: string;
  event_url: string;
  description: string;
  eventType: string;
}

/**
 * Generic career / networking keywords. Used as a fallback when the
 * user hasn't supplied any keywords, and as an always-on supplement
 * alongside the user's keywords so big annual career fairs always get
 * through even when the user's search is very narrow.
 */
const CAREER_KEYWORDS_FALLBACK = /\b(career fair|job fair|hiring|recruitment|graduate|intern|networking|workshop|conference|meetup|training|bootcamp|expo)\b/i;

/**
 * Build a relevance regex from the user's own search keywords. Was
 * previously a hardcoded TECH_KEYWORDS list that silently dropped every
 * non-tech event (nurses, consultants, lawyers saw zero events). Now
 * events match if their title/description contains any of the user's
 * keywords OR any always-on career-event term.
 */
function buildEventRelevanceRegex(userKeywords: string[]): RegExp {
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = userKeywords
    .flatMap((kw) => kw.split(/[\s,]+/))
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3)
    .slice(0, 20);
  if (tokens.length === 0) return CAREER_KEYWORDS_FALLBACK;
  const kwPart = tokens.map(escapeRe).join("|");
  return new RegExp(`\\b(${kwPart}|career fair|job fair|hiring|recruitment|graduate|intern|networking|workshop|conference|meetup|training|bootcamp|expo)\\b`, "i");
}

/** Check if an event is relevant to the user's domain by title/description. */
function isRelevant(title: string, description: string, regex: RegExp): boolean {
  return regex.test(title) || regex.test(description);
}

/** Try to normalize a date string to ISO format (YYYY-MM-DD) */
function normalizeDate(raw: string): string {
  if (!raw) return "";
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.split("T")[0];
  // Try parsing natural dates like "Sat, Mar 22, 2026" or "March 22 2026"
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2020) return d.toISOString().split("T")[0];
  } catch {}
  // Try extracting date patterns from messy strings like "Sat, Mar 22 · 10:00 AM"
  const match = raw.match(/(\w{3,9})\s+(\d{1,2}),?\s*(\d{4})?/);
  if (match) {
    const year = match[3] || new Date().getFullYear();
    try {
      const d = new Date(`${match[1]} ${match[2]}, ${year}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    } catch {}
  }
  return "";
}

/** Classify event type from title/description */
function classifyEventType(title: string, desc: string): string {
  const text = `${title} ${desc}`.toLowerCase();
  if (/career\s*fair|job\s*fair|hiring\s*event|recruitment/i.test(text)) return "career_fair";
  if (/workshop|hands.?on|bootcamp|training/i.test(text)) return "workshop";
  if (/conference|summit|forum/i.test(text)) return "conference";
  if (/meetup|meet.?up|social|mixer|drinks/i.test(text)) return "meetup";
  return "networking";
}

/**
 * Scrape career events from Eventbrite Ireland, filtered by the user's
 * actual search keywords. Previously hardcoded to tech/data/AI/startup
 * category URLs, which silently returned zero results for anyone outside
 * software. Now uses Eventbrite's full-text search (`?q=<keyword>`)
 * so a "management consultant" user finds consulting events, a nurse
 * finds nursing CPD events, and so on.
 */
async function scrapeEventbriteDublin(userKeywords: string[]): Promise<EventResult[]> {
  const events: EventResult[] = [];
  const relevanceRegex = buildEventRelevanceRegex(userKeywords);

  // Build search URLs from the user's top keywords × major Irish cities.
  // Fall back to a generic "career fair" query when no keywords are set
  // so the scraper still returns big annual events for brand-new accounts.
  const topKeywords = userKeywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 4);
  const queries = topKeywords.length > 0 ? topKeywords : ["career fair"];
  const cities = ["dublin", "cork", "galway"];
  const SEARCH_URLS: string[] = [];
  for (const q of queries) {
    for (const city of cities) {
      SEARCH_URLS.push(`https://www.eventbrite.ie/d/ireland--${city}/all-events/?q=${encodeURIComponent(q)}`);
    }
  }

  for (const searchUrl of SEARCH_URLS) {
    try {
      const res = await politeGet(searchUrl, 20000);
      if (!res.ok) continue;
      const html = await res.text();

      // Try to extract __SERVER_DATA__ JSON first (most reliable)
      const serverDataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({.*?});?\s*<\/script>/s);
      if (serverDataMatch) {
        try {
          const serverData = JSON.parse(serverDataMatch[1]);
          const results = serverData?.search_data?.events?.results || [];
          for (const ev of results) {
            if (!ev.name) continue;
            const summary = ev.summary || ev.description?.text || "";
            if (!isRelevant(ev.name, summary, relevanceRegex)) continue;

            // Try multiple date fields — Eventbrite varies across versions
            const startDate = ev.start_date || ev.start_display || ev.startDate
              || ev.start?.local || ev.start?.utc || ev.tickets_by?.date
              || ev.date?.start || ev.when || "";
            // Normalize date to ISO format
            const normalizedDate = normalizeDate(startDate);
            const venueName = ev.primary_venue?.name || ev.primary_venue?.address?.city || ev.venue?.name || "Dublin";
            const venueCity = ev.primary_venue?.address?.city || ev.venue?.city || "Dublin";
            const location = venueName !== venueCity ? `${venueName}, ${venueCity}` : venueCity;
            events.push({
              title: ev.name,
              organizer: ev.primary_organizer?.name || ev.organizer?.name || "Eventbrite",
              location,
              eventDate: normalizedDate,
              event_url: ev.url || `https://www.eventbrite.ie/e/${ev.id}`,
              description: summary.slice(0, 500),
              eventType: classifyEventType(ev.name, summary),
            });
          }
          continue; // Got JSON data, skip HTML fallback for this URL
        } catch {
          // JSON parse failed, fall through to HTML scraping
        }
      }

      // Fallback: HTML scraping
      const $ = cheerio.load(html);
      $("[class*='event-card'], [data-testid*='event'], [class*='search-event-card'], section[class*='event']").each((_, el) => {
        const title = $(el).find("h2, h3, [class*='title'], [class*='Typography_heading']").first().text().trim();
        // Extract date from datetime attr, aria-label, or text
        const timeEl = $(el).find("time, [datetime], [class*='date'], p[class*='Typography'][class*='body']");
        const rawDate = timeEl.attr("datetime") || timeEl.first().text().trim();
        const loc = $(el).find("[class*='location'], [class*='venue'], [class*='LocationText']").first().text().trim() || "Dublin";
        const href = $(el).find("a[href*='eventbrite']").first().attr("href") || $(el).find("a").first().attr("href") || "";
        const event_url = href.startsWith("http") ? href : `https://www.eventbrite.ie${href}`;
        if (!title || !isRelevant(title, "", relevanceRegex)) return;
        events.push({
          title,
          organizer: "Eventbrite",
          location: loc,
          eventDate: normalizeDate(rawDate),
          event_url,
          description: "",
          eventType: classifyEventType(title, ""),
        });
      });
    } catch (err: any) {
      log.warn(`Eventbrite scrape failed for URL: ${err.message}`);
    }
  }

  return events;
}

/** Scrape career events — tries Eventbrite (GradIreland events page no longer exists).
 *  Accepts the user's SEARCH_KEYWORDS so events are filtered by the user's
 *  actual role / domain instead of a hardcoded tech keyword list. Passing
 *  no keywords falls back to generic career-fair / networking terms. */
export async function scrapeGradIrelandEvents(userKeywords: string[] = []): Promise<EventResult[]> {
  let allEvents: EventResult[] = [];

  // Primary source: Eventbrite Ireland, queried by the user's own keywords
  try {
    const ebEvents = await scrapeEventbriteDublin(userKeywords);
    allEvents.push(...ebEvents);
    if (ebEvents.length > 0) {
      log.info(`  Eventbrite: ${ebEvents.length} events found for keywords [${userKeywords.slice(0, 3).join(", ")}]`);
    }
  } catch (err: any) {
    log.warn(`Eventbrite scrape failed: ${err.message}`);
  }

  // Secondary source: GradIreland (may return 0 if page structure changed)
  try {
    const res = await politeGet("https://gradireland.com/events");
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      $("[class*='event'], .views-row, article.node--type-event").each((_, el) => {
        const title = $(el).find("h3, h2, [class*='title']").first().text().trim();
        const date = $(el).find("[class*='date'], time").first().text().trim();
        const location = $(el).find("[class*='location']").first().text().trim() || "Ireland";
        const href = $(el).find("a").first().attr("href") || "";
        const event_url = href.startsWith("http") ? href : `https://gradireland.com${href}`;
        const desc = $(el).find("[class*='body'], [class*='summary'], p").first().text().trim();
        if (!title) return;
        allEvents.push({ title, organizer: "GradIreland", location, eventDate: date, event_url, description: desc, eventType: "career_fair" });
      });
    }
  } catch (err: any) {
    log.warn(`GradIreland events scrape failed: ${err.message}`);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped: EventResult[] = [];
  for (const ev of allEvents) {
    if (!seen.has(ev.event_url)) {
      seen.add(ev.event_url);
      deduped.push(ev);
    }
  }

  return deduped;
}
