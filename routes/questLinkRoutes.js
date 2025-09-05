// routes/questLinkRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

// Create a wallet-based attempts table (safe if run multiple times)
async function ensureTables() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS link_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      quest_id INTEGER NOT NULL,
      nonce TEXT NOT NULL UNIQUE,
      target_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      clicked_at DATETIME,
      finished_at DATETIME,
      ip TEXT, ua TEXT
    )
  `);
}

// Resolve quest by id or code (your schema uses code/title/xp/type/requirement/url/active)
async function getQuestByIdOrCode(idOrCode) {
  let q = null;
  if (/^\d+$/.test(String(idOrCode))) {
    q = await db.get(`SELECT * FROM quests WHERE id=? AND active=1`, [Number(idOrCode)]);
  } else {
    q = await db.get(`SELECT * FROM quests WHERE code=? AND active=1`, [String(idOrCode)]);
  }
  return q || null;
}

// POST /api/quests/:idOrCode/link/start
router.post("/api/quests/:idOrCode/link/start", async (req, res) => {
  try {
    const wallet = req.user?.wallet;
    if (!wallet) return res.status(401).json({ error: "Auth required" });

    await ensureTables();

    const quest = await getQuestByIdOrCode(req.params.idOrCode);
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    // We treat this as a "link visit" quest if it has a URL.
    const target_url = quest.url;
    if (!target_url) return res.status(400).json({ error: "Quest missing URL" });

    // If already completed (by quest_history), short-circuit
    const already = await db.get(
      `SELECT 1 FROM quest_history WHERE wallet=? AND (quest_id=? OR title=?) LIMIT 1`,
      wallet,
      quest.id,
      quest.code
    );
    if (already) return res.json({ status: "already_completed" });

    const nonce = crypto.randomBytes(16).toString("hex");
    await db.run(
      `INSERT INTO link_attempts (wallet, quest_id, nonce, target_url, ip, ua)
       VALUES (?,?,?,?,?,?)`,
      wallet, quest.id, nonce, target_url, req.ip, req.headers["user-agent"]
    );

    // default minimum seconds before "Claim"
    const minSeconds = 7;
    return res.json({ redirectUrl: `/r/${nonce}`, minSeconds, nonce });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "start_failed" });
  }
});

// GET /r/:nonce -> public redirect (sets cookie, logs click)
router.get("/r/:nonce", async (req, res) => {
  try {
    await ensureTables();
    const att = await db.get(`SELECT * FROM link_attempts WHERE nonce=?`, [req.params.nonce]);
    if (!att) return res.status(404).send("Invalid link");

    if (!att.clicked_at) {
      await db.run(
        `UPDATE link_attempts SET clicked_at=CURRENT_TIMESTAMP, ip=?, ua=? WHERE id=?`,
        req.ip, req.headers["user-agent"], att.id
      );
    }
    // set an httpOnly cookie so finish call must come from same browser
    res.cookie("qa", att.nonce, { httpOnly: true, sameSite: "Lax", maxAge: 10 * 60 * 1000 });
    return res.redirect(att.target_url);
  } catch (e) {
    console.error(e);
    res.status(500).send("redirect_failed");
  }
});

// POST /api/quests/:idOrCode/link/finish
router.post("/api/quests/:idOrCode/link/finish", async (req, res) => {
  try {
    const wallet = req.user?.wallet;
    if (!wallet) return res.status(401).json({ error: "Auth required" });

    await ensureTables();

    const quest = await getQuestByIdOrCode(req.params.idOrCode);
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    // idempotency via quest_history
    const already = await db.get(
      `SELECT 1 FROM quest_history WHERE wallet=? AND (quest_id=? OR title=?) LIMIT 1`,
      wallet, quest.id, quest.code
    );
    if (already) return res.json({ status: "already_completed" });

    const cookieNonce = req.cookies?.qa || req.body?.nonce;
    if (!cookieNonce) return res.status(400).json({ error: "Missing nonce" });

    const att = await db.get(`SELECT * FROM link_attempts WHERE nonce=?`, [cookieNonce]);
    if (!att || att.wallet !== wallet || att.quest_id !== quest.id) {
      return res.status(400).json({ error: "Attempt mismatch" });
    }
    if (!att.clicked_at) return res.status(400).json({ error: "Not clicked" });

    const secondsElapsed = Math.floor((Date.now() - new Date(att.clicked_at).getTime()) / 1000);
    const minSeconds = 7;
    if (secondsElapsed < minSeconds) {
      return res.status(400).json({ error: "Too fast", secondsElapsed, required: minSeconds });
    }

    // Award XP + log
    await db.run("BEGIN");
    try {
      await db.run(`UPDATE link_attempts SET finished_at=CURRENT_TIMESTAMP WHERE id=?`, [att.id]);
        await db.run(
          `UPDATE users SET xp = COALESCE(xp, 0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet=?`,
          [quest.xp, wallet]
        );

      // keep your existing quest_history format
      await db.run(
        `INSERT INTO quest_history (wallet, quest_id, title, xp)
         VALUES (?,?,?,?)`,
        wallet, quest.id, quest.code, quest.xp
      );

      await db.run("COMMIT");
    } catch (e) {
      await db.run("ROLLBACK"); throw e;
    }

    res.clearCookie("qa");
    return res.json({ status: "completed", xp: quest.xp });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "finish_failed" });
  }
});

export default router;
