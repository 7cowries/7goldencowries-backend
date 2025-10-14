import { Router } from "express";
import db from "../db.js";
const router = Router();

async function ensureTables() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      xp INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS token_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      txHash TEXT NOT NULL UNIQUE,
      tonAmount REAL,
      usdAmount REAL,
      tokensPurchased REAL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getOrCreateUserIdFromSession(req) {
  const wallet = req.session?.address;
  if (!wallet) return null;
  let row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
  if (!row) { await db.run("INSERT INTO users (wallet, xp) VALUES (?,0)", wallet);
              row = await db.get("SELECT id FROM users WHERE wallet=?", wallet); }
  return row?.id ?? null;
}

router.get("/status", async (req, res) => {
  try {
    await ensureTables();
    const userId = await getOrCreateUserIdFromSession(req);
    if (!userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    const rows = await db.all("SELECT txHash,tonAmount,usdAmount,tokensPurchased,createdAt FROM token_purchases WHERE userId=? ORDER BY id DESC LIMIT 20", userId);
    return res.json({ ok:true, entries: rows || [] });
  } catch (e) { return res.status(500).json({ ok:false, error:e.message }); }
});

router.post("/purchase", async (req, res) => {
  try {
    await ensureTables();
    const userId = await getOrCreateUserIdFromSession(req);
    if (!userId) return res.status(401).json({ ok:false, error:"not_logged_in" });

    const { txHash, tonAmount, usdAmount, tokensPurchased } = req.body || {};
    if (!txHash) return res.status(400).json({ ok:false, error:"txHash_required" });

    const exists = await db.get("SELECT id FROM token_purchases WHERE txHash=?", txHash);
    if (exists) return res.json({ ok:true, already:true });

    await db.run(
      "INSERT INTO token_purchases (userId, txHash, tonAmount, usdAmount, tokensPurchased) VALUES (?,?,?,?,?)",
      userId, txHash, tonAmount ?? null, usdAmount ?? null, tokensPurchased ?? null
    );
    return res.json({ ok:true, txHash });
  } catch (e) { return res.status(500).json({ ok:false, error:e.message }); }
});

export default router;
