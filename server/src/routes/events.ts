import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Career events routes (Postgres edition).
 * Every query is scoped by user_id. The old SQLite version had cross-tenant
 * leaks on every endpoint - fixed structurally here.
 */

const router = Router();

// ─── GET /api/events ─────────────────────────────────────────────────
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const upcoming = req.query.upcoming === "true";
  const location = typeof req.query.location === "string" ? req.query.location.toLowerCase() : null;
  const type = typeof req.query.type === "string" ? req.query.type : null;

  try {
    // postgres.js doesn't interpolate WHERE clauses, so we branch on
    // combinations. There are only 8 combinations and this stays clear.
    let rows;
    if (upcoming && location && type) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId}
           AND event_date >= NOW()
           AND LOWER(location) LIKE ${"%" + location + "%"}
           AND event_type = ${type}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else if (upcoming && location) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId}
           AND event_date >= NOW()
           AND LOWER(location) LIKE ${"%" + location + "%"}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else if (upcoming && type) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId}
           AND event_date >= NOW()
           AND event_type = ${type}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else if (location && type) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId}
           AND LOWER(location) LIKE ${"%" + location + "%"}
           AND event_type = ${type}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else if (upcoming) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId} AND event_date >= NOW()
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else if (location) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId} AND LOWER(location) LIKE ${"%" + location + "%"}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else if (type) {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId} AND event_type = ${type}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    } else {
      rows = await sql`
        SELECT * FROM career_events
         WHERE user_id = ${userId}
         ORDER BY event_date ASC
         LIMIT 100
      `;
    }
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/events]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/events/batch ──────────────────────────────────────────
// Pipeline calls this to upsert scraped events. Conflict key is
// (user_id, event_url).
router.post("/batch", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { events } = req.body;
  if (!Array.isArray(events)) {
    res.status(400).json({ error: "events must be an array" });
    return;
  }

  let inserted = 0;
  try {
    for (const ev of events) {
      const eventUrl = ev.event_url || ev.url;
      if (!ev.title || !eventUrl) continue;
      const result = await sql`
        INSERT INTO career_events (
          user_id, title, organizer, location, event_date, event_url,
          description, event_type, source
        ) VALUES (
          ${userId}, ${ev.title}, ${ev.organizer || null}, ${ev.location || null},
          ${ev.eventDate || ev.event_date || null}, ${eventUrl},
          ${ev.description || null}, ${ev.eventType || ev.event_type || "career_fair"},
          ${ev.source || null}
        )
        ON CONFLICT (user_id, event_url) DO NOTHING
      `;
      if (result.count > 0) inserted++;
    }
    res.json({ inserted, total: events.length });
  } catch (err: any) {
    console.error("[POST /api/events/batch]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/events/export.ics ──────────────────────────────────────
// Export this user's upcoming events as iCalendar so they can add them
// to Google Calendar / Apple Calendar / Outlook.
router.get("/export.ics", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const events = await sql<{
      id: number;
      title: string;
      organizer: string | null;
      location: string | null;
      event_date: Date | null;
      event_url: string | null;
      description: string | null;
    }[]>`
      SELECT id, title, organizer, location, event_date, event_url, description
        FROM career_events
       WHERE user_id = ${userId} AND event_date >= NOW()
       ORDER BY event_date ASC
       LIMIT 200
    `;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GO CANDID8//Career Events//EN",
    ];

    function escapeICS(s: string | null | undefined): string {
      if (!s) return "";
      return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    }

    for (const ev of events) {
      if (!ev.event_date) continue;
      const dt = new Date(ev.event_date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:gocandid8-event-${ev.id}@gocandid8`,
        `DTSTAMP:${dt}`,
        `DTSTART:${dt}`,
        `SUMMARY:${escapeICS(ev.title)}`,
        `DESCRIPTION:${escapeICS(ev.description)}`,
        `LOCATION:${escapeICS(ev.location)}`,
        ev.event_url ? `URL:${ev.event_url}` : "",
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=career-events.ics");
    res.send(lines.filter(Boolean).join("\r\n") + "\r\n");
  } catch (err: any) {
    console.error("[GET /api/events/export.ics]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/events/:id ──────────────────────────────────────────
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM career_events WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/events/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
