// routes/quests.js
// 7 Golden Cowries – LIVE quests (no stubs), sqlite self-heal
import express from "express";
import dbPromise, { dbRun, dbGet, dbAll } from "../db.js";

const router = express.Router();

// helper: add column if missing (safe on Render)
async function addColumnSafe(table, column, def = "TEXT") {
  const db = await dbPromise;
  const info = await db.all(`PRAGMA table_info(${table})`);
  const has = info.some((c) => c.name === column);
  if (!has) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

// create tables + add missing columns + seed
async function ensureQuestTablesAndSeed() {
  // base tables
  await dbRun(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT,
      category TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      twitter_action TEXT,
      twitter_target TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_wallet TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      UNIQUE(user_wallet, quest_id)
    )
  `);

  // self-heal older DBs from Render (your crash was: "table quests has no column named description")
  await addColumnSafe("quests", "description", "TEXT");
  await addColumnSafe("quests", "twitter_action", "TEXT");
  await addColumnSafe("quests", "twitter_target", "TEXT");
  await addColumnSafe("quests", "category", "TEXT");
  await addColumnSafe("quests", "link", "TEXT");
  await addColumnSafe("quests", "active", "INTEGER NOT NULL DEFAULT 1");

  // seed if empty
  const row = await dbGet(`SELECT COUNT(*) AS c FROM quests`);
  if (!row || row.c === 0) {
    // your real 7goldencowries quests
    await dbRun(
      `
      INSERT INTO quests (id, title, description, type, category, xp, link, twitter_action, twitter_target, active)
      VALUES
        ('daily-checkin', 'Daily Tide Check-in', 'Open 7GC today to keep your tide glowing.', 'daily', 'daily', 10, NULL, NULL, NULL, 1),
        ('follow-twitter', 'Follow @7goldencowries', 'Follow our X account to unlock ocean XP.', 'twitter', 'social', 50, 'https://x.com/7goldencowries', 'follow', '7goldencowries', 1),
        ('retweet-pinned', 'Retweet the pinned post', 'Retweet the launch tweet on @7goldencowries.', 'twitter', 'social', 80, 'https://x.com/7goldencowries/status/1947595024117502145', 'retweet', '1947595024117502145', 1),
        ('quote-pinned', 'Quote the pinned post', 'Quote our pinned tweet with your message.', 'twitter', 'social', 100, 'https://x.com/7goldencowries/status/1947595024117502145', 'quote', '1947595024117502145', 1),
        ('join-telegram', 'Join the Telegram crew', 'Join GOLDENCOWRIEBOT to get insider tides.', 'social', 'telegram', 40, 'https://t.me/GOLDENCOWRIEBOT', NULL, NULL, 1)
      `
    );
  }
}

// run now (will run once on boot on Render)
await ensureQuestTablesAndSeed();

// GET /api/quests
router.get("/", async (req, res) => {
  const wallet = req.session?.address || req.get("x-wallet") || null;

  const quests = await dbAll(
    `SELECT id, title, description, type, category, xp, link, twitter_action, twitter_target, active
       FROM quests
      WHERE active = 1
      ORDER BY category, xp DESC`
  );

  if (!wallet) {
    return res.json({ ok: true, wallet: null, quests, completed: [] });
  }

  const completed = await dbAll(
    `SELECT quest_id FROM user_quests WHERE user_wallet = ? AND claimed = 1`,
    [wallet]
  );

  res.json({
    ok: true,
    wallet,
    quests,
    completed: completed.map((c) => c.quest_id),
  });
});

// POST /api/quests/claim
// expects: { questId }
router.post("/claim", async (req, res) => {
  try {
    const wallet = req.session?.address || req.get("x-wallet") || req.body?.wallet;
    const questId = req.body?.questId;
    if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });
    if (!questId) return res.status(400).json({ ok: false, error: "questId-required" });

    const quest = await dbGet(`SELECT * FROM quests WHERE id = ? AND active = 1`, [questId]);
    if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

    // idempotent claim
    const existing = await dbGet(
      `SELECT * FROM user_quests WHERE user_wallet = ? AND quest_id = ?`,
      [wallet, questId]
    );
    if (existing && existing.claimed) {
      return res.json({ ok: true, claimed: true, xpDelta: 0, repeat: true });
    }

    // award XP
    await dbRun(
      `INSERT INTO user_quests (user_wallet, quest_id, claimed, claimed_at)
         VALUES (?, ?, 1, datetime('now'))
         ON CONFLICT(user_wallet, quest_id)
         DO UPDATE SET claimed = 1, claimed_at = datetime('now')`,
      [wallet, questId]
    );

    // make sure users table exists and add xp
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet TEXT NOT NULL UNIQUE,
        xp INTEGER NOT NULL DEFAULT 0
      )
    `);
    await dbRun(`INSERT OR IGNORE INTO users (wallet, xp) VALUES (?, 0)`, [wallet]);
    await dbRun(`UPDATE users SET xp = xp + ? WHERE wallet = ?`, [quest.xp, wallet]);

    res.json({
      ok: true,
      claimed: true,
      xpDelta: quest.xp,
      quest,
    });
  } catch (e) {
    console.error("claim error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
