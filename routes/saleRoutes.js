import { Router } from "express";
import db from "../db.js";
const router = Router();

async function ensureTables(){
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
    CREATE INDEX IF NOT EXISTS idx_token_purchases_user ON token_purchases(userId);
  `);
}

function requireWallet(req,res){
  const w = req.session?.wallet;
  if(!w){
    res.status(401).json({ ok:false, error:"not_logged_in" });
    return null;
  }
  return w;
}

async function getOrCreateUserIdByWallet(wallet){
  const row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
  if(row?.id) return row.id;
  const ins = await db.run("INSERT OR IGNORE INTO users(wallet,xp) VALUES(?,0)", wallet);
  if(ins.lastID) return ins.lastID;
  const again = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
  return again?.id ?? null;
}

router.get("/status", async (req,res) => {
  try{
    const wallet = requireWallet(req,res); if(!wallet) return;
    await ensureTables();
    const userId = await getOrCreateUserIdByWallet(wallet);
    const rows = await db.all(
      "SELECT txHash,tonAmount,usdAmount,tokensPurchased,createdAt FROM token_purchases WHERE userId=? ORDER BY id DESC LIMIT 50",
      userId
    );
    return res.json({ ok:true, entries: rows || [] });
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

router.post("/purchase", async (req,res) => {
  try{
    const wallet = requireWallet(req,res); if(!wallet) return;
    await ensureTables();
    const userId = await getOrCreateUserIdByWallet(wallet);

    const { txHash, tonAmount, usdAmount, tokensPurchased } = req.body || {};
    if(!txHash) return res.status(400).json({ ok:false, error:"txHash-required" });

    const exists = await db.get("SELECT id FROM token_purchases WHERE txHash=?", String(txHash).trim());
    if(exists?.id){
      return res.json({ ok:true, already:true });
    }

    await db.run(
      "INSERT INTO token_purchases(userId,txHash,tonAmount,usdAmount,tokensPurchased) VALUES(?,?,?,?,?)",
      userId, String(txHash).trim(), tonAmount ?? null, usdAmount ?? null, tokensPurchased ?? null
    );
    return res.json({ ok:true, created:true });
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

export default router;
