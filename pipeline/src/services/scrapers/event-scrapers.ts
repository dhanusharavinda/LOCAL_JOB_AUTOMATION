import * as cheerio from "cheerio";
import { log } from "../../logger";

interface EventResult {
  title: string;
  organizer: string;
  location: string;
  eventDate: string;
  event_url: string;
  description: string;
  eventType: string;
}

// Generic career / networking keywords that apply across every domain.
// Used as a safety-net filter so we don't silently drop obviously-relevant
// events when the user's own keywords are too narrow to match event titles.
const CAREER_KEYWORDS = /\b(career fair|job fair|hiring|recruitment|graduate|intern|networking|workshop|conference|meetup|training|bootcamp|expo)\b/i;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Per-country Meetup.com region codes + top cities to query. Adding a
 * country is a one-liner here — no scraper duplication needed. City
 * names are used verbatim in both the Meetup search URL (case-sensitive)
 * and as the fallback location string when JSON-LD doesn't expose one.
 */
const COUNTRY_CITIES: Record<string, { meetupGeo: string; cities: string[]; countryLabel: string }> = {
  ireland:     { meetupGeo: "ie", cities: ["Dublin", "Cork", "Galway"],                         countryLabel: "Ireland" },
  uk:          { meetupGeo: "gb", cities: ["London", "Manchester", "Edinburgh", "Bristol"],     countryLabel: "United Kingdom" },
  netherlands: { meetupGeo: "nl", cities: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],   countryLabel: "Netherlands" },
  india:       { meetupGeo: "in", cities: ["Bangalore", "Mumbai", "Hyderabad", "Delhi", "Pune"], countryLabel: "India" },
};

/**
 * Build a relevance regex from the user's actual search keywords plus
 * always-on career words. Previously this was a hardcoded `TECH_KEYWORDS`
 * list that silently dropped every non-tech event (nurses, consultants,
 * lawyers, etc. got zero matches). Now the user's own keywords drive
 * the filter — a consultant sees consulting events, a nurse sees nursing
 * events, and both still see generic career fairs.
 */
function buildRelevanceRegex(userKeywords: string[]): RegExp {
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = userKeywords
    .flatMap((kw) => kw.split(/[\s,]+/))
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3) // skip "AI" / "ML" noise — CAREER_KEYWORDS covers those
    .slice(0, 20);
  if (tokens.length === 0) return CAREER_KEYWORDS;
  const kwPart = tokens.map(escapeRe).join("|");
  // Combine user's keywords with the generic career-event words so niche
  // searches still catch "career fair" / "hiring event" / "recruitment".
  return new RegExp(`\\b(${kwPart}|career fair|job fair|hiring|recruitment|graduate|intern|networking|workshop|conference|meetup|training|bootcamp|expo)\\b`, "i");
}

/**
 * Derive Meetup search topics from the user's keywords instead of a
 * hardcoded tech list. A user searching for "management consultant"
 * sees "management consultant" + their variants as the Meetup query,
 * not "data engineering" + "software developer".
 */
function meetupSearchTopics(userKeywords: string[]): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const kw of userKeywords) {
    const t = kw.trim();
    if (!t) continue;
    const lc = t.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    topics.push(t);
    if (topics.length >= 5) break;
  }
  // Add one generic career term so a keyword list of all very-specific
  // technical titles still surfaces the big annual career fairs.
  if (!topics.some((t) => /career|job fair|hiring/i.test(t))) {
    topics.push("career fair");
  }
  return topics;
}

function classifyEventType(title: string, desc: string): string {
  const text = `${title} ${desc}`.toLowerCase();
  if (/career\s*fair|job\s*fair|hiring\s*event|recruitment\s*fair|jobs?\s*expo/i.test(text)) return "career_fair";
  if (/workshop|hands.?on|bootcamp|training/i.test(text)) return "workshop";
  if (/conference|summit|forum/i.test(text)) return "conference";
  if (/meetup|meet.?up|social|mixer|drinks/i.test(text)) return "meetup";
  return "networking";
}

// ── JobsExpo.ie (Ireland only — run only when Ireland is in TARGET_COUNTRIES) ──
export async function scrapeJobsExpo(): Promise<EventResult[]> {
  const events: EventResult[] = [];
  try {
    for (const url of ["https://www.jobsexpo.ie/", "https://www.jobsexpo.ie/upcoming-events/"]) {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      const seen = new Set<string>();

      $(".ct-section, section, [class*='event'], [class*='expo']").each((_, section) => {
        const headlines = $(section).find(".ct-headline, h1, h2, h3").map((_, el) => $(el).text().trim()).get();
        const textBlocks = $(section).find(".ct-text-block, p").map((_, el) => $(el).text().trim()).get();
        const allText = [...headlines, ...textBlocks].join(" ");

        for (const headline of headlines) {
          if (!/job.?s?\s*expo/i.test(headline)) continue;
          if (seen.has(headline.toLowerCase())) continue;
          seen.add(headline.toLowerCase());

          const dateMatch = allText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i);
          let eventDate = "";
          if (dateMatch) {
            try {
              const d = new Date(dateMatch[1].replace(/(st|nd|rd|th)/i, ""));
              if (!isNaN(d.getTime())) eventDate = d.toISOString().split("T")[0];
            } catch { /* skip */ }
          }

          const locMatch = headline.match(/expo\s+(cork|dublin|galway|limerick|waterford)/i);
          const location = locMatch ? `${locMatch[1]}, Ireland` : "Ireland";

          const links = $(section).find("a[href]").map((_, el) => $(el).attr("href") || "").get();
          const regLink = links.find((l) => /register|ticket|eventbrite|book/i.test(l)) || `https://www.jobsexpo.ie/upcoming-events/`;

          events.push({
            title: headline,
            organizer: "Jobs Expo Ireland",
            location,
            eventDate,
            event_url: regLink,
            description: allText.slice(0, 300),
            eventType: "career_fair",
          });
        }
      });
    }
    log.info(`  JobsExpo: ${events.length} events found`);
  } catch (err: any) {
    log.warn(`  JobsExpo scrape failed: ${err.message}`);
  }
  return events;
}

// ── TechMeetups.com (country-aware) ─────────────────────────────────────────
/**
 * TechMeetups publishes tech job fairs globally. We filter the listing
 * by the user's selected countries' cities so a user on India doesn't
 * see Dublin events and vice versa.
 */
export async function scrapeTechMeetups(countries: string[], _userKeywords: string[] = []): Promise<EventResult[]> {
  // TechMeetups is, as the brand name suggests, a tech-only event board.
  // We still run it for tech-heavy roles, but silently return [] for
  // users whose keywords are clearly non-tech so their kanban isn't
  // polluted with irrelevant events.
  const looksTech = _userKeywords.some((k) => /\b(engineer|developer|data|software|tech|cloud|devops|ai|ml|python|javascript|cyber|security|product|designer|qa|analyst)\b/i.test(k));
  if (_userKeywords.length > 0 && !looksTech) {
    log.info("  TechMeetups: user keywords aren't tech-oriented, skipping");
    return [];
  }
  const events: EventResult[] = [];

  // Build the per-run city whitelist from the registry. No hardcoded
  // Ireland bias.
  const cityList: string[] = [];
  const countryForCity: Record<string, string> = {};
  for (const code of countries) {
    const cfg = COUNTRY_CITIES[code];
    if (!cfg) continue;
    for (const city of cfg.cities) {
      const lc = city.toLowerCase();
      cityList.push(lc);
      countryForCity[lc] = cfg.countryLabel;
    }
  }
  if (cityList.length === 0) {
    log.info("  TechMeetups: no cities derived from TARGET_COUNTRIES, skipping");
    return events;
  }

  try {
    const res = await fetch("https://techmeetups.com/events/", { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    $('a[href*="techmeetups.com/event/"]').each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (!href || !text) return;

      const lowerHref = href.toLowerCase();
      const matchedCity = cityList.find((c) => lowerHref.includes(c));
      if (!matchedCity) return;

      events.push({
        title: `${text} Tech Job Fair`,
        organizer: "TechMeetups",
        location: `${text}, ${countryForCity[matchedCity] || ""}`.replace(/,\s*$/, ""),
        eventDate: "",
        event_url: href,
        description: "Tech job fair organized by TechMeetups",
        eventType: "career_fair",
      });
    });

    // Polite detail-page fetch to enrich dates + descriptions (top 5 only).
    for (const event of events.slice(0, 5)) {
      try {
        const detailRes = await fetch(event.event_url, { headers: { "User-Agent": UA } });
        if (!detailRes.ok) continue;
        const detailHtml = await detailRes.text();
        const detail$ = cheerio.load(detailHtml);

        const dateAttr = detail$("abbr.dtstart").attr("title") || "";
        if (dateAttr && /^\d{4}-\d{2}-\d{2}$/.test(dateAttr)) {
          event.eventDate = dateAttr;
        }
        const desc = detail$(".tribe-events-single-event-description, .entry-content").text().trim();
        if (desc.length > 20) {
          event.description = desc.slice(0, 300);
        }
      } catch { /* skip detail fetch errors */ }
    }

    log.info(`  TechMeetups: ${events.length} events found (cities: ${Array.from(new Set(cityList)).join(", ")})`);
  } catch (err: any) {
    log.warn(`  TechMeetups scrape failed: ${err.message}`);
  }
  return events;
}

// ── Meetup.com (country-aware) ──────────────────────────────────────────────
/**
 * Replaces the old Ireland-only `scrapeMeetupDublin`. Builds Meetup
 * search URLs per (country × city × topic) from the shared
 * COUNTRY_CITIES table, so enabling a new country = one table entry.
 */
export async function scrapeMeetupByCountry(countries: string[], userKeywords: string[] = []): Promise<EventResult[]> {
  const events: EventResult[] = [];
  const seen = new Set<string>();
  // Topics come from the user's keywords — "management consultant" or
  // "registered nurse" drives Meetup queries for the right community
  // instead of the old hardcoded "data engineering / software developer"
  // list that biased every account toward tech.
  const searchTopics = meetupSearchTopics(userKeywords);
  const relevanceRegex = buildRelevanceRegex(userKeywords);

  const searchUrls: Array<{ url: string; city: string; countryLabel: string }> = [];
  for (const code of countries) {
    const cfg = COUNTRY_CITIES[code];
    if (!cfg) continue;
    for (const city of cfg.cities) {
      for (const topic of searchTopics) {
        searchUrls.push({
          url: `https://www.meetup.com/find/?location=${cfg.meetupGeo}--${encodeURIComponent(city)}&source=EVENTS&keywords=${encodeURIComponent(topic)}`,
          city,
          countryLabel: cfg.countryLabel,
        });
      }
    }
  }

  if (searchUrls.length === 0) {
    log.info("  Meetup: no countries resolved, skipping");
    return events;
  }

  // Cap total scrape volume so we don't hit Meetup too hard — 3 topics ×
  // top 2 cities per country is a reasonable sweet spot.
  const capped = searchUrls.slice(0, countries.length * 6);

  for (const { url: searchUrl, city, countryLabel } of capped) {
    try {
      const res = await fetch(searchUrl, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const html = await res.text();

      const $ = cheerio.load(html);
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || "");
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            if (item["@type"] !== "Event") continue;
            const name = item.name || "";
            const eventUrl = item.url || "";
            if (!name || !eventUrl || seen.has(eventUrl)) continue;

            const desc = item.description || "";
            if (!relevanceRegex.test(name) && !relevanceRegex.test(desc)) continue;

            seen.add(eventUrl);

            let eventDate = "";
            if (item.startDate) {
              try {
                const d = new Date(item.startDate);
                if (!isNaN(d.getTime())) eventDate = d.toISOString().split("T")[0];
              } catch { /* skip */ }
            }

            const loc = item.location?.name || item.location?.address?.addressLocality || `${city}, ${countryLabel}`;

            events.push({
              title: name,
              organizer: item.organizer?.name || "Meetup",
              location: typeof loc === "string" ? loc : `${city}, ${countryLabel}`,
              eventDate,
              event_url: eventUrl,
              description: desc.slice(0, 300),
              eventType: classifyEventType(name, desc),
            });
          }
        } catch { /* skip invalid JSON-LD */ }
      });

      // Apollo-state fallback (same as before, country-aware fallback
      // location now uses the actual city/country pair we're scraping).
      const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({.+?});\s*<\/script>/s);
      if (apolloMatch) {
        try {
          const apollo = JSON.parse(apolloMatch[1]);
          for (const key of Object.keys(apollo)) {
            if (!key.startsWith("Event:")) continue;
            const evt = apollo[key];
            if (!evt.title || !evt.eventUrl) continue;
            const eventUrl = `https://www.meetup.com${evt.eventUrl}`;
            if (seen.has(eventUrl)) continue;

            const desc = evt.description || "";
            if (!relevanceRegex.test(evt.title) && !relevanceRegex.test(desc)) continue;

            seen.add(eventUrl);

            let eventDate = "";
            if (evt.dateTime) {
              try {
                const d = new Date(evt.dateTime);
                if (!isNaN(d.getTime())) eventDate = d.toISOString().split("T")[0];
              } catch { /* skip */ }
            }

            events.push({
              title: evt.title,
              organizer: "Meetup",
              location: `${city}, ${countryLabel}`,
              eventDate,
              event_url: eventUrl,
              description: desc.slice(0, 300),
              eventType: classifyEventType(evt.title, desc),
            });
          }
        } catch { /* skip Apollo parsing errors */ }
      }
    } catch (err: any) {
      log.warn(`  Meetup scrape failed for ${searchUrl}: ${err.message}`);
    }
  }

  log.info(`  Meetup (${countries.join(",")}): ${events.length} tech events found`);
  return events;
}

// ── Combined scraper — country-aware entry point ─────────────────────────────
/**
 * Fan out to each country-specific event source based on the user's
 * TARGET_COUNTRIES. JobsExpo only runs for Ireland (it's an Irish
 * brand). TechMeetups + Meetup cover every country in COUNTRY_CITIES.
 */
export async function scrapeAllExtraEvents(countries: string[], userKeywords: string[] = []): Promise<EventResult[]> {
  const resolved = countries.filter((c) => COUNTRY_CITIES[c]);
  if (resolved.length === 0) {
    log.info("  Extra event sources: no supported country in TARGET_COUNTRIES, skipping");
    return [];
  }

  const tasks: Array<Promise<EventResult[]>> = [];
  // JobsExpo is Ireland-only — only queue it when Ireland is selected.
  if (resolved.includes("ireland")) tasks.push(scrapeJobsExpo());
  tasks.push(scrapeTechMeetups(resolved, userKeywords));
  tasks.push(scrapeMeetupByCountry(resolved, userKeywords));

  const results = await Promise.all(tasks);
  const all = results.flat();

  // Deduplicate by event_url
  const seen = new Set<string>();
  const unique = all.filter((e) => {
    if (seen.has(e.event_url)) return false;
    seen.add(e.event_url);
    return true;
  });

  log.info(`  Extra event sources for ${resolved.join(",")}: ${unique.length} total`);
  return unique;
}
