import { useEffect, useMemo, useState } from "react";
import { CareerEvent } from "../types";
import { fetchEvents, fetchSettings } from "../api";

interface Props {
  onClose: () => void;
}

/** Country options for the events location filter. */
const COUNTRY_OPTIONS: Record<string, string> = {
  ireland:     "Ireland",
  uk:          "United Kingdom",
  netherlands: "Netherlands",
  india:       "India",
  newzealand:  "New Zealand",
};

/**
 * Country → regex used to decide whether an event belongs to that country.
 * Matches the country name plus its major cities so events tagged just
 * "Dublin" or "London" still land under the right country bucket.
 * Keep these in sync with the dashboard's country filter in App.tsx so
 * the two surfaces agree on what "UK jobs" / "India jobs" actually means.
 */
const COUNTRY_PATTERNS: Record<string, RegExp> = {
  ireland: /\b(ireland|dublin|cork|galway|limerick|waterford|belfast|kilkenny|wexford|sligo|drogheda|maynooth|éire|eire|shannon|louth|meath|kildare|donegal|mayo|clare|kerry|tipperary|wicklow)\b/i,
  uk: /\buk\b|\bu\.k\.\b|united kingdom|england|london|manchester|edinburgh|glasgow|scotland|wales|birmingham|bristol|leeds|cambridge|oxford|liverpool|sheffield|nottingham|belfast/i,
  netherlands: /\b(netherlands|amsterdam|rotterdam|the hague|utrecht|eindhoven|groningen|nl)\b/i,
  india: /\b(india|bangalore|bengaluru|mumbai|delhi|ncr|noida|gurgaon|gurugram|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|chandigarh)\b/i,
  newzealand: /\b(new zealand|auckland|wellington|christchurch|hamilton|tauranga|nz)\b/i,
};

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return "Date TBD";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "career_fair", label: "Career Fair" },
  { value: "conference", label: "Conference" },
  { value: "meetup", label: "Meetup" },
  { value: "workshop", label: "Workshop" },
  { value: "networking", label: "Networking" },
];

type ViewMode = "list" | "calendar";

export default function CareerEventsModal({ onClose }: Props) {
  const [events, setEvents] = useState<CareerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState<"deadline" | "relevancy" | "newest">("deadline");
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Active country from user settings - drives the city filter dropdown
  // + modal title + export filename. Falls back to "ireland" if settings
  // fails to load, matching the server-side default.
  const [activeCountry, setActiveCountry] = useState<string>("ireland");

  useEffect(() => {
    fetchSettings()
      .then((s: any) => {
        const raw = (s?.config?.TARGET_COUNTRIES || "ireland").split(",").map((c: string) => c.trim().toLowerCase()).filter(Boolean);
        if (raw[0]) setActiveCountry(raw[0]);
      })
      .catch(() => {});
  }, []);

  const countryLabel = COUNTRY_OPTIONS[activeCountry] || "All regions";

  useEffect(() => {
    setLoading(true);
    setError(null);
    const filters: { type?: string } = {};
    if (typeFilter) filters.type = typeFilter;
    fetchEvents(!showAll, filters)
      .then(setEvents)
      .catch(() => setError("Failed to load events"))
      .finally(() => setLoading(false));
  }, [showAll, typeFilter]);

  const RELEVANCY_WEIGHT: Record<string, number> = {
    career_fair: 5, workshop: 4, conference: 3, meetup: 2, networking: 1,
  };

  // Filter events by the active country BEFORE sorting / grouping. We do
  // this client-side because the server's /api/events endpoint accepts a
  // single LIKE substring, which can't express "Ireland includes Dublin
  // + Cork + Belfast but not other -land countries". A regex per country
  // gives us precise boundaries without touching the server.
  const countryFilteredEvents = useMemo(() => {
    const pattern = COUNTRY_PATTERNS[activeCountry];
    if (!pattern) return events;
    return events.filter((ev) => {
      if (!ev.location) return false;
      return pattern.test(ev.location);
    });
  }, [events, activeCountry]);

  const sortedEvents = useMemo(() => {
    const sorted = [...countryFilteredEvents];
    if (sortBy === "deadline") {
      sorted.sort((a, b) => {
        const aDate = a.event_date ? new Date(a.event_date).getTime() : Infinity;
        const bDate = b.event_date ? new Date(b.event_date).getTime() : Infinity;
        return aDate - bDate;
      });
    } else if (sortBy === "newest") {
      sorted.sort((a, b) => {
        const aScraped = a.scraped_at ? new Date(a.scraped_at).getTime() : 0;
        const bScraped = b.scraped_at ? new Date(b.scraped_at).getTime() : 0;
        return bScraped - aScraped; // newest scraped first
      });
    } else {
      sorted.sort((a, b) => {
        const aWeight = RELEVANCY_WEIGHT[a.event_type] ?? 0;
        const bWeight = RELEVANCY_WEIGHT[b.event_type] ?? 0;
        if (bWeight !== aWeight) return bWeight - aWeight;
        const aDate = a.event_date ? new Date(a.event_date).getTime() : Infinity;
        const bDate = b.event_date ? new Date(b.event_date).getTime() : Infinity;
        return aDate - bDate;
      });
    }
    return sorted;
  }, [countryFilteredEvents, sortBy]);

  // Build a map of date → events for the calendar - use the country-
  // filtered list so the calendar highlights and counts only reflect
  // events in the user's selected country.
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CareerEvent[]>();
    for (const ev of countryFilteredEvents) {
      if (!ev.event_date) continue;
      const key = ev.event_date.slice(0, 10); // YYYY-MM-DD
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [countryFilteredEvents]);

  // Events for selected date
  const selectedDateEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];

  // Calendar grid generation
  const calendarDays = useMemo(() => {
    const { year, month } = calMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday start

    const days: Array<{ date: Date; key: string; inMonth: boolean }> = [];

    // Pad from previous month
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, key: toDateKey(d), inMonth: false });
    }

    // Current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      days.push({ date: d, key: toDateKey(d), inMonth: true });
    }

    // Pad to fill last row
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(year, month + 1, i);
        days.push({ date: d, key: toDateKey(d), inMonth: false });
      }
    }

    return days;
  }, [calMonth]);

  const todayKey = toDateKey(new Date());
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function isNewlyScraped(scrapedAt: string | null): boolean {
    if (!scrapedAt) return false;
    const scraped = new Date(scrapedAt).getTime();
    return Date.now() - scraped < 24 * 60 * 60 * 1000; // within 24h
  }

  const newCount = events.filter((e) => isNewlyScraped(e.scraped_at)).length;

  const eventTypeLabel: Record<string, string> = {
    career_fair: "Career Fair", meetup: "Meetup", networking: "Networking",
    conference: "Conference", workshop: "Workshop",
  };

  const eventTypeColor: Record<string, string> = {
    career_fair: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    meetup: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    networking: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    conference: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    workshop: "text-pink-400 bg-pink-500/10 border-pink-500/20",
  };

  const dotColor: Record<string, string> = {
    career_fair: "bg-emerald-400", meetup: "bg-blue-400", networking: "bg-violet-400",
    conference: "bg-amber-400", workshop: "bg-pink-400",
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0d0f13] border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/60 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-50">Tech Events - {countryLabel}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Career fairs, meetups, conferences &amp; workshops</p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <button
              onClick={() => setViewMode("calendar")}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                viewMode === "calendar"
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                  : "bg-transparent border-gray-800 text-gray-600 hover:text-gray-400"
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                viewMode === "list"
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                  : "bg-transparent border-gray-800 text-gray-600 hover:text-gray-400"
              }`}
            >
              List
            </button>
            <div className="w-px h-4 bg-gray-800" />
            {viewMode === "list" && (
              <>
                <button
                  onClick={() => setSortBy("deadline")}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                    sortBy === "deadline"
                      ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                      : "bg-transparent border-gray-800 text-gray-600 hover:text-gray-400"
                  }`}
                >
                  Deadline
                </button>
                <button
                  onClick={() => setSortBy("relevancy")}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                    sortBy === "relevancy"
                      ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                      : "bg-transparent border-gray-800 text-gray-600 hover:text-gray-400"
                  }`}
                >
                  Relevancy
                </button>
                <button
                  onClick={() => setSortBy("newest")}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                    sortBy === "newest"
                      ? "bg-green-500/15 border-green-500/30 text-green-400"
                      : "bg-transparent border-gray-800 text-gray-600 hover:text-gray-400"
                  }`}
                >
                  Newly Scraped
                </button>
              </>
            )}
            <button
              onClick={() => setShowAll((v) => !v)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                showAll
                  ? "bg-gray-700/30 border-gray-600 text-gray-300"
                  : "bg-transparent border-gray-800 text-gray-600 hover:text-gray-400"
              }`}
            >
              {showAll ? "Upcoming" : "Show all"}
            </button>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-800/40 shrink-0">
          <select
            value={activeCountry}
            onChange={(e) => { setActiveCountry(e.target.value); }}
            className="bg-[#0f1115] border border-gray-800/60 rounded-lg px-2.5 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-blue-500/40 cursor-pointer"
          >
            {Object.entries(COUNTRY_OPTIONS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-[#0f1115] border border-gray-800/60 rounded-lg px-2.5 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-blue-500/40 cursor-pointer">
            {TYPE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
          {typeFilter && (
            <button onClick={() => { setTypeFilter(""); }}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Clear</button>
          )}
          <a
            href={`/api/events/export.ics?upcoming=${!showAll}${typeFilter ? `&type=${typeFilter}` : ""}`}
            download={`tech-events-${activeCountry}.ics`}
            className="text-xs font-medium text-blue-400 bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/20 px-2.5 py-1.5 rounded-lg transition-colors ml-auto flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Export .ics
          </a>
          <span className="text-xs text-gray-600">
            {countryFilteredEvents.length} event{countryFilteredEvents.length !== 1 ? "s" : ""} in {countryLabel}
            {newCount > 0 && <span className="text-green-400 ml-1">({newCount} new)</span>}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error && <p className="text-sm text-red-400 py-8 text-center">{error}</p>}

          {/* ── CALENDAR VIEW ── */}
          {!loading && !error && viewMode === "calendar" && (
            <div className="p-4">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 })}
                  className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-sm font-bold text-gray-200">
                  {monthNames[calMonth.month]} {calMonth.year}
                </h3>
                <button
                  onClick={() => setCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 })}
                  className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="text-[10px] text-gray-600 text-center font-medium py-1">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map(({ date, key, inMonth }) => {
                  const dayEvents = eventsByDate.get(key) || [];
                  const isToday = key === todayKey;
                  const isSelected = key === selectedDate;
                  const hasEvents = dayEvents.length > 0;

                  return (
                    <button
                      key={key}
                      onClick={() => hasEvents ? setSelectedDate(isSelected ? null : key) : undefined}
                      className={`relative h-12 rounded-lg text-xs transition-all flex flex-col items-center justify-center gap-0.5 ${
                        !inMonth ? "text-gray-800" :
                        isSelected ? "bg-blue-500/20 border border-blue-500/40 text-blue-300" :
                        isToday ? "bg-gray-800/60 text-white font-bold ring-1 ring-blue-500/30" :
                        hasEvents ? "bg-[#0f1115] text-gray-300 hover:bg-gray-800/50 cursor-pointer" :
                        "text-gray-600"
                      }`}
                    >
                      <span>{date.getDate()}</span>
                      {hasEvents && (
                        <div className="flex gap-0.5">
                          {dayEvents.slice(0, 3).map((ev, i) => (
                            <span key={i} className={`w-1.5 h-1.5 rounded-full ${dotColor[ev.event_type] || "bg-gray-500"}`} />
                          ))}
                          {dayEvents.length > 3 && <span className="text-[8px] text-gray-500">+{dayEvents.length - 3}</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Selected date events */}
              {selectedDate && selectedDateEvents.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    {formatEventDate(selectedDate)} - {selectedDateEvents.length} event{selectedDateEvents.length !== 1 ? "s" : ""}
                  </h4>
                  {selectedDateEvents.map((ev) => (
                    <div key={ev.id} className="p-3 rounded-xl bg-[#0f1115] border border-gray-800/60 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded ${eventTypeColor[ev.event_type] || "text-gray-400 bg-gray-500/10 border-gray-500/20"}`}>
                            {eventTypeLabel[ev.event_type] || ev.event_type}
                          </span>
                          {isNewlyScraped(ev.scraped_at) && (
                            <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">NEW</span>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-100">{ev.title}</h3>
                        {ev.organizer && <p className="text-xs text-gray-500 mt-0.5">{ev.organizer}</p>}
                        {ev.location && <p className="text-xs text-gray-600 mt-0.5">{ev.location}</p>}
                      </div>
                      {ev.event_url && (
                        <a href={ev.event_url} target="_blank" rel="noreferrer"
                          className="shrink-0 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/20 px-2.5 py-1 rounded-lg transition-colors font-medium">
                          View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-800/40">
                {Object.entries(dotColor).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-[10px] text-gray-600">{eventTypeLabel[type]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── LIST VIEW ── */}
          {!loading && !error && viewMode === "list" && (
            <div className="px-6 py-4">
              {countryFilteredEvents.length === 0 && (
                <div className="py-16 text-center">
                  <div className="text-4xl mb-3">🗓</div>
                  <p className="text-sm text-gray-500">
                    {events.length > 0
                      ? `No events in ${countryLabel}.`
                      : "No events found."}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    {events.length > 0
                      ? "Switch your target country in Settings, or check back after the next pipeline run."
                      : typeFilter ? "Try adjusting your filters." : "Events are scraped automatically when you run the pipeline."}
                  </p>
                </div>
              )}
              {sortedEvents.length > 0 && (
                <div className="space-y-3 pb-4">
                  {sortedEvents.map((ev) => {
                    const days = daysUntil(ev.event_date);
                    const isUrgent = days !== null && days >= 0 && days <= 7;
                    const isPast = days !== null && days < 0;
                    return (
                      <div key={ev.id}
                        className={`p-4 rounded-xl border transition-colors ${
                          isPast ? "bg-[#0a0c10] border-gray-800/40 opacity-50" :
                          isUrgent ? "bg-amber-500/5 border-amber-500/20" :
                          "bg-[#0f1115] border-gray-800/60 hover:border-gray-700/60"
                        }`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={`inline-flex items-center text-[10px] font-bold border px-1.5 py-0.5 rounded ${eventTypeColor[ev.event_type] || "text-gray-400 bg-gray-500/10 border-gray-500/20"}`}>
                                {eventTypeLabel[ev.event_type] || ev.event_type}
                              </span>
                              {isNewlyScraped(ev.scraped_at) && (
                                <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">NEW</span>
                              )}
                              {isUrgent && (
                                <span className="text-[10px] font-bold text-amber-400">
                                  {days === 0 ? "TODAY" : `${days}d away`}
                                </span>
                              )}
                            </div>
                            <h3 className="text-sm font-semibold text-gray-100 leading-snug">{ev.title}</h3>
                            {ev.organizer && <p className="text-xs text-gray-500 mt-0.5">{ev.organizer}</p>}
                            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {formatEventDate(ev.event_date)}
                              </span>
                              {ev.location && (
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  {ev.location}
                                </span>
                              )}
                            </div>
                            {ev.description && <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{ev.description}</p>}
                          </div>
                          {ev.event_url && (
                            <a href={ev.event_url} target="_blank" rel="noreferrer"
                              className="shrink-0 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/20 px-2.5 py-1 rounded-lg transition-colors font-medium">
                              View
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800/60 shrink-0">
          <p className="text-[11px] text-gray-600">
            Events from Eventbrite, GradIreland, JobsExpo.ie, TechMeetups & Meetup.com. Run the pipeline to refresh.
          </p>
        </div>
      </div>
    </div>
  );
}
