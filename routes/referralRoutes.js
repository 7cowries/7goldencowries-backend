// routes/referralRoutes.js
import express from "express";
import db from "../db.js";
import { getLevelInfo } from "../utils/levelUtils.js";

const publicRouter = express.Router();
const adminRouter = express.Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_TOKEN || "";

/* ----------------------------- helpers ----------------------------- */
function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(500).json({ error: "ADMIN_SECRET not set on server" });
  }
  const got = req.get("x-admin") || req.get("x-admin-secret");
  if (got !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function ensureUser(wallet) {
  if (!wallet) return;
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000)`,
      wallet
    );
  }
}

async function awardXpAndLog(wallet, amount, title = "Referral bonus", questId = null) {
  if (!amount) return;
  await ensureUser(wallet);
  await db.run("UPDATE users SET xp = xp + ? WHERE wallet = ?", amount, wallet);
  try {
    await db.run(
      `INSERT INTO quest_history (wallet, quest_id, title, xp)
       VALUES (?, ?, ?, ?)`,
      wallet,
      questId,
      title,
      amount
    );
  } catch {
    // quest_history table may not exist yet; ignore
  }
}

/* =========================
   PUBLIC REFERRAL ENDPOINTS
   Mounted at /api/referrals
   ========================= */

async function handleClaim(req, res) {
  const { referrer, referred } = req.body || {};
  if (!referrer || !referred) {
    return res.status(400).json({ error: "Missing referrer or referred" });
  }
  if (referrer === referred) {
    return res.status(400).json({ error: "Cannot refer yourself" });
  }

  try {
    await ensureUser(referrer);
    await ensureUser(referred);

    const exists = await db.get(
      "SELECT id FROM referrals WHERE referred = ?",
      referred
    );
    if (exists) {
      return res.status(409).json({ error: "Referral already claimed" });
    }

    const result = await db.run(
      "INSERT INTO referrals (referrer, referred) VALUES (?, ?)",
      referrer,
      referred
    );

    const REFERRER_XP = 50;
    const REFERRED_XP = 50;

    await awardXpAndLog(
      referrer,
      REFERRER_XP,
      `Referral: invited ${referred}`,
      `referral:${result.lastID}`
    );
    await awardXpAndLog(
      referred,
      REFERRED_XP,
      `Referral: joined via ${referrer}`,
      `referral:${result.lastID}`
    );

    const userRow = await db.get(
      "SELECT xp FROM users WHERE wallet = ?",
      referred
    );
    const level = getLevelInfo(userRow?.xp || 0);

    return res.json({
      ok: true,
      id: result.lastID,
      referred: { wallet: referred, xp: userRow?.xp || 0, level },
    });
  } catch (err) {
    console.error("Referral claim error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

publicRouter.post("/claim-referral", handleClaim);
publicRouter.post("/claim", handleClaim);

/** List referrals for a referrer */
publicRouter.get("/referrals/:wallet", async (req, res) => {
  const { wallet } = req.params;
  try {
    let list = [];
    try {
      list = await db.all(
        `SELECT id, referred AS address, completed
           FROM referrals
          WHERE referrer = ?
          ORDER BY id DESC`,
        wallet
      );
    } catch (err) {
      if (String(err.message || "").includes("no such column: completed")) {
        list = await db.all(
          `SELECT id, referred AS address, 0 AS completed
             FROM referrals
            WHERE referrer = ?
            ORDER BY id DESC`,
          wallet
        );
      } else {
        throw err;
      }
    }
    res.json({ referrals: list });
  } catch (err) {
    console.error("Referral fetch error:", err);
    res.status(500).json({ error: "Failed to fetch referrals" });
  }
});

/** Quick stats */
publicRouter.get("/stats/:wallet", async (req, res) => {
  try {
    const w = req.params.wallet;
    const rows = await db.all(
      "SELECT completed, COUNT(*) AS c FROM referrals WHERE referrer = ? GROUP BY completed",
      w
    );
    const completed = rows.find((r) => r.completed === 1)?.c || 0;
    const pending = rows.find((r) => r.completed === 0)?.c || 0;
    res.json({ ok: true, referrer: w, completed, pending, total: completed + pending });
  } catch (e) {
    console.error("referrals/stats error:", e);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/** Back-compat: protected mark-complete */
publicRouter.post("/referral/complete", requireAdmin, async (req, res) => {
  const { id, referred, awardXp = 0 } = req.body || {};
  try {
    let targets = [];
    if (id) {
      const row = await db.get("SELECT * FROM referrals WHERE id = ?", id);
      if (row) targets = [row];
    } else if (referred) {
      targets = await db.all(
        "SELECT * FROM referrals WHERE referred = ? AND completed = 0",
        referred
      );
    } else {
      return res.status(400).json({ error: "Provide id or referred" });
    }

    if (!targets.length) return res.json({ ok: true, updated: 0 });

    const ids = targets.map((t) => t.id);
    const placeholders = ids.map(() => "?").join(",");
    await db.run(`UPDATE referrals SET completed = 1 WHERE id IN (${placeholders})`, ids);

    if (Number(awardXp) > 0) {
      for (const t of targets) {
        await awardXpAndLog(
          t.referrer,
          Number(awardXp),
          `Referral complete: ${t.referred}`,
          `referral:${t.id}`
        );
      }
    }

    res.json({ ok: true, updated: ids.length });
  } catch (err) {
    if (String(err.message || "").includes("no such column: completed")) {
      console.warn("⚠️ Column `completed` missing; no-op update.");
      return res.json({ ok: true, warning: "Column `completed` missing", updated: 0 });
    }
    console.error("Referral complete error:", err);
    res.status(500).json({ error: "Failed to mark referral(s) complete" });
  }
});

/* =========================
   ADMIN REFERRAL ENDPOINTS
   Mounted at /api/admin/referrals
   ========================= */

adminRouter.post("/create", requireAdmin, async (req, res) => {
  try {
    const { referrer, referred } = req.body || {};
    if (!referrer || !referred) return res.status(400).json({ error: "Missing referrer or referred" });
    if (referrer === referred) return res.status(400).json({ error: "Referrer and referred must differ" });

    await ensureUser(referrer);
    await ensureUser(referred);

    const exists = await db.get(
      "SELECT id FROM referrals WHERE referrer = ? AND referred = ?",
      referrer,
      referred
    );
    if (exists) return res.json({ ok: true, id: exists.id, message: "Already exists" });

    const result = await db.run(
      "INSERT INTO referrals (referrer, referred) VALUES (?, ?)",
      referrer,
      referred
    );
    res.json({ ok: true, id: result.lastID });
  } catch (e) {
    console.error("admin referrals/create error:", e);
    res.status(500).json({ error: "Failed to create referral" });
  }
});

adminRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const { referrer, referred, completed, limit = 100, offset = 0 } = req.query;
    const where = [];
    const args = [];
    if (referrer) { where.push("referrer = ?"); args.push(referrer); }
    if (referred) { where.push("referred = ?"); args.push(referred); }
    if (completed === "0" || completed === "1") { where.push("completed = ?"); args.push(Number(completed)); }
    const sql =
      "SELECT id, referrer, referred, completed FROM referrals" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY id DESC LIMIT ? OFFSET ?";
    args.push(Number(limit), Number(offset));
    const rows = await db.all(sql, args);
    res.json({ ok: true, rows });
  } catch (e) {
    console.error("admin referrals/list error:", e);
    res.status(500).json({ error: "Failed to list referrals" });
  }
});

adminRouter.post("/complete", requireAdmin, async (req, res) => {
  const { id, referred, awardXp = 0 } = req.body || {};
  try {
    let targets = [];
    if (id) {
      const row = await db.get("SELECT * FROM referrals WHERE id = ?", id);
      if (row) targets = [row];
    } else if (referred) {
      targets = await db.all("SELECT * FROM referrals WHERE referred = ? AND completed = 0", referred);
    } else {
      return res.status(400).json({ error: "Provide id or referred" });
    }

    if (!targets.length) return res.json({ ok: true, updated: 0 });

    const ids = targets.map((t) => t.id);
    const placeholders = ids.map(() => "?").join(",");
    await db.run(`UPDATE referrals SET completed = 1 WHERE id IN (${placeholders})`, ids);

    let awarded = 0;
    if (Number(awardXp) > 0) {
      for (const t of targets) {
        await awardXpAndLog(
          t.referrer,
          Number(awardXp),
          `Referral complete: ${t.referred}`,
          `referral:${t.id}`
        );
        awarded++;
      }
    }

    res.json({ ok: true, updated: ids.length, awardedReferrers: awarded });
  } catch (e) {
    if (String(e.message || "").includes("no such column: completed")) {
      console.warn("⚠️ Column `completed` missing; no-op update.");
      return res.json({ ok: true, warning: "Column `completed` missing", updated: 0 });
    }
    console.error("admin referrals/complete error:", e);
    res.status(500).json({ error: "Failed to complete referrals" });
  }
});

/* ----------------------------- exports ----------------------------- */
export default publicRouter;     // mount at /api/referrals
export { adminRouter as admin }; // mount at /api/admin/referrals
