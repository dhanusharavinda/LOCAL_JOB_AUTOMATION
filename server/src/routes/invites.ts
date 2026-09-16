import { Router, Request, Response } from "express";
import crypto from "crypto";
import { sql } from "../db";
import { ensureInviteSchema, isAdminEmail, accessStateFor } from "../access";

/**
 * Invite links for the invite-only launch.
 *
 *   GET  /api/invites/check/:token        PUBLIC  is this link usable?
 *   POST /api/invites/redeem              auth    { token } -> grant access
 *   GET  /api/invites                     admin   list links + who used them
 *   POST /api/invites                     admin   { count, label?, days? } -> new links
 *   POST /api/invites/:id/revoke          admin   cancel an unused link
 *   POST /api/invites/users/:userId/extend admin  { days } -> add access time
 *   POST /api/invites/users/:userId/end   admin   end someone's access now
 *
 * Links are single-use so a link posted publicly can't let a crowd in.
 * An already-active user opening a link does NOT burn it.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

function newToken(): string {
  return crypto.randomBytes(12).toString("base64url"); // 16 url-safe chars
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdminEmail(req.user?.email)) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

async function schemaOr503(res: Response): Promise<boolean> {
  if (await ensureInviteSchema()) return true;
  res.status(503).json({ error: "Invites are temporarily unavailable. Please try again shortly." });
  return false;
}

// ─── GET /api/invites/check/:token (public) ─────────────────────────
// Lets the invite landing screen say "this link was already used"
// BEFORE someone creates an account for nothing.
export async function checkInviteHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.params.token || "");
  if (!TOKEN_RE.test(token)) { res.json({ valid: false, reason: "not_found" }); return; }
  if (!(await schemaOr503(res))) return;
  try {
    const rows = await sql<{ access_days: number; redeemed_by: string | null; revoked_at: Date | null }[]>`
      SELECT access_days, redeemed_by, revoked_at FROM invite_links WHERE token = ${token} LIMIT 1
    `;
    const row = rows[0];
    if (!row) { res.json({ valid: false, reason: "not_found" }); return; }
    if (row.revoked_at) { res.json({ valid: false, reason: "revoked" }); return; }
    if (row.redeemed_by) { res.json({ valid: false, reason: "used" }); return; }
    res.json({ valid: true, access_days: row.access_days });
  } catch (err: any) {
    console.error("[GET /api/invites/check]", err?.message || err);
    res.status(500).json({ error: "Could not check this invite." });
  }
}

const router = Router();

// ─── POST /api/invites/redeem ───────────────────────────────────────
router.post("/redeem", async (req: Request, res: Response) => {
  const user = req.user!;
  const token = String((req.body || {}).token || "").trim();
  if (!TOKEN_RE.test(token)) {
    res.status(400).json({ code: "not_found", error: "That doesn't look like a valid invite link." });
    return;
  }
  if (!(await schemaOr503(res))) return;

  const state = accessStateFor(user);
  if (state === "admin" || state === "active") {
    // Already in: keep the link unused so it can go to someone else.
    res.json({ ok: true, alreadyHasAccess: true, access_expires_at: user.access_expires_at ?? null });
    return;
  }

  try {
    const outcome = await sql.begin(async (tx) => {
      const rows = await tx<{ id: number; access_days: number; redeemed_by: string | null; revoked_at: Date | null }[]>`
        SELECT id, access_days, redeemed_by, revoked_at
          FROM invite_links WHERE token = ${token}
         FOR UPDATE
      `;
      const inv = rows[0];
      if (!inv) return { status: 404, body: { code: "not_found", error: "This invite link doesn't exist. Check you copied the whole link." } };
      if (inv.revoked_at) return { status: 410, body: { code: "revoked", error: "This invite link was cancelled. Ask for a new one." } };
      if (inv.redeemed_by) return { status: 409, body: { code: "used", error: "This invite link has already been used. Each link works once. Ask for your own link." } };

      await tx`UPDATE invite_links SET redeemed_by = ${user.id}, redeemed_at = NOW() WHERE id = ${inv.id}`;
      const updated = await tx<{ access_expires_at: Date }[]>`
        UPDATE profiles
           SET approval_status   = 'approved',
               approved_at       = NOW(),
               access_expires_at = NOW() + make_interval(days => ${inv.access_days}::int),
               invite_id         = ${inv.id}
         WHERE id = ${user.id}
        RETURNING access_expires_at
      `;
      return { status: 200, body: { ok: true, access_expires_at: updated[0]?.access_expires_at ?? null } };
    });
    res.status(outcome.status).json(outcome.body);
  } catch (err: any) {
    console.error("[POST /api/invites/redeem]", err?.message || err);
    res.status(500).json({ error: "Could not redeem this invite. Please try again." });
  }
});

// ─── GET /api/invites (admin) ───────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  if (!(await schemaOr503(res))) return;
  try {
    const rows = await sql<any[]>`
      SELECT i.id, i.token, i.label, i.access_days, i.created_at, i.redeemed_at, i.revoked_at,
             p.id AS redeemed_user_id, p.email AS redeemed_email, p.name AS redeemed_name,
             p.access_expires_at
        FROM invite_links i
        LEFT JOIN profiles p ON p.id = i.redeemed_by
       ORDER BY i.created_at DESC
       LIMIT 500
    `;
    // Only unused, live links need their token (for copying).
    res.json({
      invites: rows.map((r) => ({
        ...r,
        token: !r.redeemed_at && !r.revoked_at ? r.token : null,
      })),
    });
  } catch (err: any) {
    console.error("[GET /api/invites]", err?.message || err);
    res.status(500).json({ error: "Could not load invites." });
  }
});

// ─── POST /api/invites (admin) ──────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  if (!(await schemaOr503(res))) return;
  const count = Math.min(50, Math.max(1, parseInt(String((req.body || {}).count ?? 1), 10) || 1));
  const days = Math.min(365, Math.max(1, parseInt(String((req.body || {}).days ?? 30), 10) || 30));
  const rawLabel = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 120) : "";
  try {
    const values = Array.from({ length: count }, () => ({
      token: newToken(),
      label: rawLabel || null,
      access_days: days,
      created_by: req.user!.id,
    }));
    const created = await sql<any[]>`
      INSERT INTO invite_links ${sql(values as any)}
      RETURNING id, token, label, access_days, created_at, redeemed_at, revoked_at
    `;
    res.status(201).json({ invites: created });
  } catch (err: any) {
    console.error("[POST /api/invites]", err?.message || err);
    res.status(500).json({ error: "Could not create invite links." });
  }
});

// ─── POST /api/invites/:id/revoke (admin) ───────────────────────────
router.post("/:id/revoke", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  if (!(await schemaOr503(res))) return;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await sql`
      UPDATE invite_links SET revoked_at = NOW()
       WHERE id = ${id} AND redeemed_by IS NULL AND revoked_at IS NULL
      RETURNING id
    `;
    if (rows.length === 0) {
      res.status(409).json({ error: "Only unused links can be cancelled." });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[POST /api/invites/:id/revoke]", err?.message || err);
    res.status(500).json({ error: "Could not cancel this link." });
  }
});

// ─── POST /api/invites/users/:userId/extend (admin) ─────────────────
// Adds days on top of whatever is left (or from today if already expired).
router.post("/users/:userId/extend", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  if (!(await schemaOr503(res))) return;
  const days = Math.min(365, Math.max(1, parseInt(String((req.body || {}).days ?? 30), 10) || 30));
  try {
    const rows = await sql<{ access_expires_at: Date }[]>`
      UPDATE profiles
         SET access_expires_at = GREATEST(COALESCE(access_expires_at, NOW()), NOW()) + make_interval(days => ${days}::int),
             approval_status   = 'approved'
       WHERE id = ${req.params.userId}
      RETURNING access_expires_at
    `;
    if (rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ ok: true, access_expires_at: rows[0].access_expires_at });
  } catch (err: any) {
    console.error("[POST /api/invites/users/:userId/extend]", err?.message || err);
    res.status(500).json({ error: "Could not extend access." });
  }
});

// ─── POST /api/invites/users/:userId/end (admin) ────────────────────
router.post("/users/:userId/end", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  if (!(await schemaOr503(res))) return;
  if (req.params.userId === req.user!.id) {
    res.status(400).json({ error: "You can't end your own access." });
    return;
  }
  try {
    const rows = await sql<{ access_expires_at: Date }[]>`
      UPDATE profiles SET access_expires_at = NOW()
       WHERE id = ${req.params.userId}
      RETURNING access_expires_at
    `;
    if (rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ ok: true, access_expires_at: rows[0].access_expires_at });
  } catch (err: any) {
    console.error("[POST /api/invites/users/:userId/end]", err?.message || err);
    res.status(500).json({ error: "Could not end access." });
  }
});

export default router;
