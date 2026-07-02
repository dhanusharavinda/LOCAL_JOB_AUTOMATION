import { Router, Request, Response } from "express";
import { sql } from "../db";

/**
 * Feedback capture (public — no auth).
 * ────────────────────────────────────
 * Backs the floating "Contact" button. Stores every bug report / feature
 * request / note server-side so nothing is lost (the old mailto-only flow
 * couldn't guarantee delivery), and returns a real confirmation. Mounted
 * BEFORE the global requireAuth so anonymous visitors can send feedback too.
 */

const router = Router();

let feedbackTableReady = false;
async function ensureFeedbackTable(): Promise<void> {
  if (feedbackTableReady) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS feedback (
        id         bigserial primary key,
        user_id    uuid,
        email      text,
        category   text,
        message    text not null,
        page       text,
        created_at timestamptz not null default now()
      )
    `;
    feedbackTableReady = true;
  } catch (err: any) {
    console.error("[feedback] ensureFeedbackTable failed:", err?.message || err);
  }
}

// ─── POST /api/feedback ──────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < 2) {
    res.status(400).json({ error: "Please write a message first." });
    return;
  }
  if (message.length > 5000) {
    res.status(400).json({ error: "That message is too long (max 5000 characters)." });
    return;
  }
  const category = typeof body.category === "string" ? body.category.slice(0, 40) : "general";
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().slice(0, 200) : null;
  const page = typeof body.page === "string" ? body.page.slice(0, 300) : null;

  try {
    await ensureFeedbackTable();
    await sql`
      INSERT INTO feedback (category, message, email, page)
      VALUES (${category}, ${message}, ${email}, ${page})
    `;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[POST /api/feedback]", err?.message || err);
    res.status(500).json({ error: "Could not save your feedback. Please try again." });
  }
});

export default router;
