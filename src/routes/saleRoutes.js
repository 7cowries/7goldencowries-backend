import { Router } from "express";
import db from "../db.js";
const router = Router();

async function ensureTables(){
  await db.exec(`
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

router.get("/status", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureTables();
    const rows = await db.all("SELECT txHash,tonAmount,usdAmount,tokensPurchased,createdAt FROM token_purchases WHERE userId=? ORDER BY id DESC LIMIT 20", req.session.userId);
    return res.json({ ok:true, purchases: rows || [] });
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

router.post("/purchase", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureTables();
    const { txHash, tonAmount, usdAmount, tokensPurchased } = req.body || {};
    if (!txHash) return res.status(400).json({ ok:false, error:"txHash-required" });

    const exists = await db.get("SELECT id FROM token_purchases WHERE txHash=?", txHash);
    if (exists) return res.json({ ok:true, already:true });

    await db.run(
      "INSERT INTO token_purchases(userId,txHash,tonAmount,usdAmount,tokensPurchased) VALUES (?,?,?,?,?)",
      req.session.userId, txHash, tonAmount ?? null, usdAmount ?? null, tokensPurchased ?? null
    );

    const last = await db.get("SELECT txHash,tonAmount,usdAmount,tokensPurchased,createdAt FROM token_purchases WHERE txHash=?", txHash);
    return res.json({ ok:true, purchase:last });
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

export default router;
