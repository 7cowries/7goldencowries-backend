import express from "express";
import db from "../lib/db.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

function bool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "1" || v === "true";
  }
  return false;
}

function getAdminToken(req) {
  const hdr = String(req.get("authorization") || "");
  if (!hdr.toLowerCase().startsWith("bearer ")) return "";
  return hdr.slice(7).trim();
}

function requireAdmin(req, res, next) {
  const expected = String(process.env.ADMIN_TOKEN || "").trim();
  const provided = getAdminToken(req);
  if (!expected || provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

async function listActiveQuests(limit = 12) {
  try {
    return await db.all(
      `SELECT id, title, COALESCE(category,'All') AS category, COALESCE(xp,0) AS xp, COALESCE(url,'') AS url
         FROM quests
        WHERE COALESCE(active,1) = 1
        ORDER BY COALESCE(sort,0) ASC, COALESCE(updatedAt, createdAt, CURRENT_TIMESTAMP) DESC
        LIMIT ?`,
      Number(limit)
    );
  } catch {
    return [];
  }
}

router.get("/api/home", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    const [featuredQuests, topUsers, liveArenas, sponsorSlots] = await Promise.all([
      listActiveQuests(6),
      db
        .all(
          `SELECT wallet, COALESCE(xp,0) AS xp
             FROM users
            WHERE wallet IS NOT NULL
            ORDER BY COALESCE(xp,0) DESC, COALESCE(updatedAt, CURRENT_TIMESTAMP) DESC
            LIMIT 5`
        )
        .catch(() => []),
      db
        .all(
          `SELECT id, code, title, status, start_time, end_time, entry_fee_amount, entry_fee_currency
             FROM arenas
            WHERE visibility = 'public' AND status IN ('scheduled','live')
            ORDER BY COALESCE(start_time, created_at) ASC
            LIMIT 6`
        )
        .catch(() => []),
      db
        .all(
          `SELECT id, title, campaign_type, placement, status, start_time, end_time
             FROM sponsor_campaigns
            WHERE status IN ('scheduled','live')
            ORDER BY COALESCE(start_time, created_at) ASC
            LIMIT 6`
        )
        .catch(() => []),
    ]);

    return res.json({
      ok: true,
      wallet: wallet || null,
      featuredQuests,
      leaderboardPreview: topUsers,
      liveArenas,
      partnerSlots: sponsorSlots,
      hasLiveData: featuredQuests.length > 0 || topUsers.length > 0 || liveArenas.length > 0,
    });
  } catch (err) {
    console.error("home payload error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/partners", async (_req, res) => {
  try {
    const [slots, latestApplications] = await Promise.all([
      db
        .all(
          `SELECT id, campaign_type, title, description, slot_type, placement, status, start_time, end_time
             FROM sponsor_campaigns
            WHERE status IN ('scheduled', 'live')
            ORDER BY COALESCE(start_time, created_at) ASC`
        )
        .catch(() => []),
      db
        .all(
          `SELECT id, brand_name, campaign_type, status, payment_status, created_at
             FROM sponsor_applications
            ORDER BY id DESC
            LIMIT 20`
        )
        .catch(() => []),
    ]);

    return res.json({ ok: true, slots, latestApplications });
  } catch (err) {
    console.error("partners payload error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/admin/me", requireAdmin, (_req, res) => {
  return res.json({ ok: true, role: "admin" });
});

router.get("/api/admin/quests", requireAdmin, async (_req, res) => {
  try {
    const quests = await db.all(
      `SELECT id, code, title, COALESCE(category,'All') AS category, COALESCE(xp,0) AS xp,
              COALESCE(requirement,'none') AS requirement, COALESCE(active,1) AS active,
              COALESCE(requiredTier,'Free') AS requiredTier, COALESCE(url,'') AS url,
              COALESCE(sort,0) AS sort, COALESCE(updatedAt, createdAt, CURRENT_TIMESTAMP) AS updatedAt
         FROM quests
        ORDER BY COALESCE(sort,0) ASC, COALESCE(updatedAt, createdAt, CURRENT_TIMESTAMP) DESC`
    );
    return res.json({ ok: true, quests });
  } catch (err) {
    console.error("admin quests list error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/admin/quests", requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ ok: false, error: "title_required" });

    const id = String(req.body?.id || `free_${Date.now()}`).trim();
    const code = String(req.body?.code || id).trim();
    const xp = Math.max(0, Number(req.body?.xp || 0));
    const requirement = String(req.body?.requirement || "none").trim() || "none";
    const requiredTier = String(req.body?.requiredTier || "Free").trim() || "Free";
    const category = String(req.body?.category || "All").trim() || "All";
    const url = String(req.body?.url || "").trim();
    const sort = Number(req.body?.sort || 0);
    const active = bool(req.body?.active ?? true) ? 1 : 0;

    await db.run(
      `INSERT INTO quests (id, code, title, category, xp, requirement, requiredTier, url, sort, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      code,
      title,
      category,
      xp,
      requirement,
      requiredTier,
      url,
      sort,
      active
    );

    return res.status(201).json({ ok: true, id, code });
  } catch (err) {
    console.error("admin create quest error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/api/admin/quests/:id", requireAdmin, async (req, res) => {
  try {
    await db.run(
      `UPDATE quests
          SET title = COALESCE(?, title),
              category = COALESCE(?, category),
              xp = COALESCE(?, xp),
              requirement = COALESCE(?, requirement),
              requiredTier = COALESCE(?, requiredTier),
              url = COALESCE(?, url),
              sort = COALESCE(?, sort),
              active = COALESCE(?, active),
              updatedAt = CURRENT_TIMESTAMP
        WHERE CAST(id AS TEXT) = CAST(? AS TEXT)`,
      req.body?.title ?? null,
      req.body?.category ?? null,
      Number.isFinite(Number(req.body?.xp)) ? Number(req.body?.xp) : null,
      req.body?.requirement ?? null,
      req.body?.requiredTier ?? null,
      req.body?.url ?? null,
      Number.isFinite(Number(req.body?.sort)) ? Number(req.body?.sort) : null,
      typeof req.body?.active === "undefined" ? null : bool(req.body?.active) ? 1 : 0,
      req.params.id
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("admin patch quest error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/payments/state", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.json({ ok: true, wallet: null, subscription: null, tokenSale: null, arena: null });
    }

    const [user, latestSub, tokenSaleRows, pendingArenaPayment] = await Promise.all([
      db
        .get(
          `SELECT paid, tier, subscriptionTier, lastPaymentAt, subscriptionPaidAt, subscriptionClaimedAt
             FROM users WHERE wallet = ?`,
          wallet
        )
        .catch(() => null),
      db
        .get(
          `SELECT tier, status, renewalDate, timestamp
             FROM subscriptions WHERE wallet = ?
            ORDER BY datetime(timestamp) DESC
            LIMIT 1`,
          wallet
        )
        .catch(() => null),
      db
        .all(
          `SELECT status, ton_amount, usd_amount, created_at
             FROM token_sale_contributions WHERE wallet = ?
            ORDER BY id DESC LIMIT 3`,
          wallet
        )
        .catch(() => []),
      db
        .get(
          `SELECT id, arena_id, status, amount, currency, checkout_url
             FROM payments
            WHERE user_wallet = ? AND status IN ('pending', 'requires_action')
            ORDER BY id DESC LIMIT 1`,
          wallet
        )
        .catch(() => null),
    ]);

    const subscriptionTier = user?.subscriptionTier || latestSub?.tier || user?.tier || "Free";
    const paid = bool(user?.paid) || String(latestSub?.status || "").toLowerCase() === "active";

    return res.json({
      ok: true,
      wallet,
      subscription: {
        tier: subscriptionTier,
        paid,
        status: latestSub?.status || (paid ? "active" : "inactive"),
        renewalDate: latestSub?.renewalDate || null,
        lastPaymentAt: user?.subscriptionPaidAt || user?.lastPaymentAt || latestSub?.timestamp || null,
        claimedAt: user?.subscriptionClaimedAt || null,
      },
      tokenSale: {
        totalContributions: tokenSaleRows.length,
        latest: tokenSaleRows[0] || null,
      },
      arena: {
        pendingPayment: pendingArenaPayment || null,
      },
    });
  } catch (err) {
    console.error("payments state error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
