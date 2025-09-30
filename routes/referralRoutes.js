// routes/referralRoutes.js
// Public + Admin referral APIs using the new schema:
//
//  Tables (from migrations):
//   - users: id, wallet, twitter_handle, referral_code, xp, ...
//   - referrals: id, referrer_user_id, referee_user_id, code, created_at, UNIQUE(referee_user_id)
//   - referral_events: id, referee_user_id, first_quest_completed_at
//
// Public endpoints (mounted at /api/referrals):
//   POST /api/referrals/accept { code }                 -> link me (req.user) to a referrer
//   GET  /api/referrals/code                            -> get or create my referral code
//   GET  /api/referrals/stats                           -> my code + list of referees
//
// Admin endpoints (mounted at /api/admin/referrals) with x-admin/x-admin-secret header:
//   POST /api/admin/referrals/create { referrer_id, referee_id }  (or wallets)
//   GET  /api/admin/referrals?referrer_id=&referee_id=&limit=&offset=
//   POST /api/admin/referrals/unlink { referee_id }               (remove a link)

import express from "express";
import db from "../lib/db.js";

const publicRouter = express.Router();
const adminRouter = express.Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_TOKEN || "";

/* ----------------------------- helpers ----------------------------- */

function requireAuth(req, res, next) {
  const uid = req.user?.id;
  if (!uid) return res.status(401).json({ error: "Auth required" });
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(500).json({ error: "ADMIN_SECRET not set on server" });
  }
  const got = req.get("x-admin") || req.get("x-admin-secret");
  if (got !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Create a short readable code from user id
function makeRefCode(id) {
  return (id.toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}

// Get or create a user's referral code
async function getOrCreateReferralCode(userId) {
  const row = await db.get("SELECT referral_code FROM users WHERE id=?", [userId]);
  if (row?.referral_code) return row.referral_code;
  const code = makeRefCode(userId);
  await db.run(
    `UPDATE users SET referral_code=?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    [code, userId]
  );
  return code;
}

// Resolve a user by id or wallet (for admin convenience)
async function resolveUserId({ id, wallet }) {
  if (id) return id;
  if (wallet) {
    const u = await db.get("SELECT id FROM users WHERE wallet=?", [wallet]);
    return u?.id || null;
  }
  return null;
}

/* =========================
   PUBLIC REFERRAL ENDPOINTS
   Mounted at /api/referrals
   ========================= */

// Accept a referral code (idempotent). Links the current user (referee) to referrer.
publicRouter.post("/accept", requireAuth, async (req, res) => {
  try {
    const refereeId = req.user.id;
    const code = (req.body?.code || "").trim();
    const CODE_RE = /^[A-Z0-9_-]{4,64}$/i;
    if (!code || !CODE_RE.test(code))
      return res.status(400).json({ error: "Invalid code" });

    // who owns this code?
    const referrer = await db.get("SELECT id FROM users WHERE referral_code=?", [code]);
    if (!referrer) return res.status(404).json({ error: "Invalid code" });
    if (referrer.id === refereeId) return res.status(400).json({ error: "Self referral not allowed" });

    // already linked?
    const exists = await db.get("SELECT 1 AS x FROM referrals WHERE referee_user_id=?", [refereeId]);
    if (exists) return res.json({ status: "already_linked" });

    // link
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO referrals (referrer_user_id, referee_user_id, code, created_at) VALUES (?,?,?,?)",
      [referrer.id, refereeId, code, now]
    );

    res.json({ status: "linked", referrer_user_id: referrer.id, referee_user_id: refereeId });
  } catch (e) {
    console.error("referrals/accept error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Get (or create) my referral code
publicRouter.get("/code", requireAuth, async (req, res) => {
  try {
    const code = await getOrCreateReferralCode(req.user.id);
    res.json({ code });
  } catch (e) {
    console.error("referrals/code error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Stats for the current user (their own code + list of referees)
publicRouter.get("/stats", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const code = await getOrCreateReferralCode(userId);

    // list referees with minimal profile
    const referees = await db.all(
      `SELECT u.id AS user_id,
              u.wallet,
              u.twitter_handle,
              r.created_at,
              (SELECT first_quest_completed_at
                 FROM referral_events e
                WHERE e.referee_user_id = u.id
                LIMIT 1) AS first_quest_completed_at
         FROM referrals r
         JOIN users u ON u.wallet = r.referred
        WHERE r.referrer_user_id = ?
        ORDER BY r.created_at DESC`,
      [userId]
    );

    res.json({ code, referees });
  } catch (e) {
    console.error("referrals/stats error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Public lookup of referrals by code
publicRouter.get("/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    const CODE_RE = /^[A-Z0-9_-]{4,64}$/i;
    if (!code || !CODE_RE.test(code)) return res.json({ entries: [] });
    const rows = await db.all(
      `SELECT u.wallet, COALESCE(u.xp,0) AS xp, r.created_at AS joinedAt
         FROM referrals r
         JOIN users u ON u.id = r.referee_user_id
        WHERE r.code = ?
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [code]
    );
    res.json({ entries: rows });
  } catch (e) {
    console.error("referrals/:code error", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/* =========================
   ADMIN REFERRAL ENDPOINTS
   Mounted at /api/admin/referrals
   ========================= */

// Create a referral link (admin). Accepts either ids or wallets.
adminRouter.post("/create", requireAdmin, async (req, res) => {
  try {
    const referrer_id = await resolveUserId({
      id: req.body?.referrer_id,
      wallet: req.body?.referrer_wallet,
    });
    const referee_id = await resolveUserId({
      id: req.body?.referee_id,
      wallet: req.body?.referee_wallet,
    });

    if (!referrer_id || !referee_id) {
      return res.status(400).json({ error: "Missing referrer/referee (id or wallet)" });
    }
    if (referrer_id === referee_id) {
      return res.status(400).json({ error: "Referrer and referee must differ" });
    }

    const code = await getOrCreateReferralCode(referrer_id);

    // idempotent: only one referrer per referee
    const exists = await db.get("SELECT 1 FROM referrals WHERE referee_user_id=?", [referee_id]);
    if (exists) return res.json({ ok: true, status: "already_linked" });

    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO referrals (referrer_user_id, referee_user_id, code, created_at) VALUES (?,?,?,?)",
      [referrer_id, referee_id, code, now]
    );

    res.json({ ok: true, status: "linked", referrer_user_id: referrer_id, referee_user_id: referee_id, code });
  } catch (e) {
    console.error("admin referrals/create error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// List referrals with filters
adminRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const where = [];
    const args = [];

    if (req.query.referrer_id) {
      where.push("r.referrer_user_id = ?");
      args.push(Number(req.query.referrer_id));
    }
    if (req.query.referee_id) {
      where.push("r.referee_user_id = ?");
      args.push(Number(req.query.referee_id));
    }

    const sql = `
      SELECT r.id, r.code, r.created_at,
             r.referrer_user_id, ru.wallet AS referrer_wallet, ru.twitter_handle AS referrer_twitter,
             r.referee_user_id, eu.wallet AS referee_wallet,  eu.twitter_handle  AS referee_twitter,
             (SELECT first_quest_completed_at
                FROM referral_events e
               WHERE e.referee_user_id = r.referee_user_id
               LIMIT 1) AS first_quest_completed_at
        FROM referrals r
        JOIN users ru ON ru.id = r.referrer_user_id
        JOIN users eu ON eu.id = r.referee_user_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?
    `;
    args.push(limit, offset);

    const rows = await db.all(sql, args);
    res.json({ ok: true, rows });
  } catch (e) {
    console.error("admin referrals/list error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Unlink a referee (admin)
adminRouter.post("/unlink", requireAdmin, async (req, res) => {
  try {
    const referee_id = await resolveUserId({
      id: req.body?.referee_id,
      wallet: req.body?.referee_wallet,
    });
    if (!referee_id) return res.status(400).json({ error: "Missing referee (id or wallet)" });

    const del = await db.run("DELETE FROM referrals WHERE referee_user_id=?", [referee_id]);
    res.json({ ok: true, deleted: del.changes || 0 });
  } catch (e) {
    console.error("admin referrals/unlink error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ----------------------------- exports ----------------------------- */
export default publicRouter;     // mount at /api/referrals
export { adminRouter as admin }; // mount at /api/admin/referrals
