import express from "express";
import fetch from "node-fetch";
import db from "../lib/db.js";

const router = express.Router();

const TONCENTER_API =
  process.env.TONCENTER_API || "https://toncenter.com/api/v2";
const TONCENTER_KEY = process.env.TONCENTER_KEY || "";

async function getFirstTxQuest() {
  let q = await db.get(
    "SELECT * FROM quests WHERE code='FIRST_TON_TX' AND active=1"
  );
  if (!q)
    q = await db.get(
      "SELECT * FROM quests WHERE requirement='first_ton_tx' AND active=1 LIMIT 1"
    );
  return q || null;
}

router.post("/api/quests/ton/first-transfer/verify", async (req, res) => {
  try {
    const wallet = req.user?.wallet;
    if (!wallet) return res.status(401).json({ error: "Auth required" });

    const quest = await getFirstTxQuest();
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const done = await db.get(
      `SELECT 1 FROM quest_history WHERE wallet=? AND (quest_id=? OR title=?) LIMIT 1`,
      wallet,
      quest.id,
      quest.code
    );
    if (done) return res.json({ status: "already_completed" });

    const url = `${TONCENTER_API}/getTransactions?address=${encodeURIComponent(
      wallet
    )}&limit=1`;
    const headers = TONCENTER_KEY ? { "X-API-Key": TONCENTER_KEY } : {};
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(500).json({ error: "ton_api_error" });
    const data = await r.json();
    const hasTx = Array.isArray(data.result) && data.result.length > 0;
    if (!hasTx)
      return res.status(400).json({ error: "no_transactions_found" });

    await db.run("BEGIN");
    try {
      await db.run(
        `UPDATE users SET xp = COALESCE(xp,0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet=?`,
        [quest.xp, wallet]
      );
      await db.run(
        `INSERT INTO quest_history (wallet, quest_id, title, xp) VALUES (?,?,?,?)`,
        wallet,
        quest.id,
        quest.code,
        quest.xp
      );
      await db.run("COMMIT");
    } catch (e) {
      await db.run("ROLLBACK");
      throw e;
    }

    res.json({ status: "completed", xp: quest.xp });
  } catch (e) {
    console.error("ton first transfer verify error:", e);
    res.status(500).json({ error: "ton_verify_failed" });
  }
});

export default router;
