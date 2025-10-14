import express from "express";
import db from "../db.js";

const router = express.Router();

// --- helpers ---
function tierMultiplier(tier) {
  if (!tier) return 1.0;
  const t = String(tier).toLowerCase();
  if (t === "tier 3") return 1.5;
  if (t === "tier 2") return 1.25;
  if (t === "tier 1") return 1.10;
  return 1.0;
}

// Blueprint level names
function computeLevel(xp) {
  const levels = [
    { name: "Shellborn",        base: 0,      size: 10000 },
    { name: "Wave Seeker",      base: 10000,  size: 15000 },
    { name: "Tide Whisperer",   base: 25000,  size: 25000 },
    { name: "Current Binder",   base: 50000,  size: 50000 },
    { name: "Pearl Bearer",     base: 100000, size: 100000 },
    { name: "Isle Champion",    base: 200000, size: 150000 },
    { name: "Cowrie Ascendant", base: 350000, size: 200000 }
  ];
  let current = levels[0];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].base) { current = levels[i]; break; }
  }
  const progress = Math.max(0, Math.min(1, (xp - current.base) / (current.size || 1)));
  return { levelName: current.name, levelProgress: Number(progress.toFixed(3)) };
}

async function ensureQuestSchemaAndSeeds() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quest_categories (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      xp INTEGER NOT NULL,
      url TEXT,
      partner TEXT,
      isDaily INTEGER DEFAULT 0,
      startsAt TEXT,
      endsAt TEXT,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS user_quests (
      userId INTEGER NOT NULL,
      questId INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      claimedAt TEXT,
      PRIMARY KEY (userId, questId)
    );
  `);

  const row = await db.get("SELECT COUNT(*) as n FROM quests");
  if ((row?.n || 0) === 0) {
    const cats = [
      ["daily", "Daily"],
      ["social", "Social"],
      ["partner", "Partner"],
      ["insider", "Insider"],
      ["onchain", "On-Chain"],
    ];
    for (const [k, n] of cats) {
      await db.run("INSERT OR IGNORE INTO quest_categories (key, name) VALUES (?,?)", [k, n]);
    }
    const quests = [
      { key: "daily_checkin",  title: "Daily Check-in",              category: "daily",   xp: 500,  url: "/quests/daily",  isDaily: 1 },
      { key: "follow_x",       title: "Follow @7goldencowries on X", category: "social",  xp: 1500, url: "https://x.com/7goldencowries" },
      { key: "retweet_pinned", title: "Retweet the pinned post",     category: "social",  xp: 2000, url: "https://x.com/7goldencowries/status/1947595024117502145" },
      { key: "quote_pinned",   title: "Quote the pinned post",       category: "social",  xp: 2500, url: "https://x.com/7goldencowries/status/1947595024117502145" },
      { key: "join_telegram",  title: "Join our Telegram",           category: "partner", xp: 1000, url: "https://t.me/GOLDENCOWRIEBOT", partner: "Telegram" },
      { key: "join_discord",   title: "Join our Discord",            category: "partner", xp: 1200, url: "https://discord.gg/7goldencowries", partner: "Discord" },
      { key: "read_guide",     title: "Read the Isles Guide",        category: "insider", xp: 800,  url: "/guide/isles" },
      { key: "first_tx",       title: "Make your first TON tx",      category: "onchain", xp: 3000, url: "/onchain/first" }
    ];
    for (const q of quests) {
      await db.run(
        `INSERT OR IGNORE INTO quests (key, title, category, xp, url, partner, isDaily, active)
         VALUES (?,?,?,?,?,?,?,1)`,
        [q.key, q.title, q.category, q.xp, q.url || null, q.partner || null, q.isDaily ? 1 : 0]
      );
    }
  }
}

/** GET /quests -> active quests + user status */
router.get("/quests", async (req, res) => {
  try {
    await ensureQuestSchemaAndSeeds();
    const uid = req.session?.userId || -1;
    const rows = await db.all(`
      SELECT q.*, COALESCE(uq.status, 'pending') as status, uq.claimedAt
      FROM quests q
      LEFT JOIN user_quests uq ON uq.questId = q.id AND uq.userId = ?
      WHERE q.active = 1
      ORDER BY
        CASE q.category
          WHEN 'daily' THEN 1
          WHEN 'social' THEN 2
          WHEN 'partner' THEN 3
          WHEN 'insider' THEN 4
          WHEN 'onchain' THEN 5
          ELSE 6
        END, q.id ASC
    `, [uid]);
    return res.json({ ok: true, quests: rows });
  } catch (e) {
    console.error("GET /quests error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/** POST /quests/claim { key } -> ensure schema+seeds, then award XP */
router.post("/quests/claim", async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ ok: false, error: "not_logged_in" });
  try {
    await ensureQuestSchemaAndSeeds(); // <-- IMPORTANT FIX
    const key = (req.body?.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "key_required" });

    const quest = await db.get("SELECT * FROM quests WHERE key = ? AND active = 1", [key]);
    if (!quest) return res.status(404).json({ ok: false, error: "quest_not_found" });

    const uq = await db.get("SELECT status FROM user_quests WHERE userId = ? AND questId = ?", [uid, quest.id]);
    const user = await db.get("SELECT * FROM users WHERE id = ?", [uid]);

    if (uq?.status === "claimed") {
      return res.json({ ok: true, already: true, quest: { key: quest.key, xp: quest.xp, category: quest.category }, user: {
        id: user.id, wallet: user.wallet, xp: user.xp, levelName: user.levelName, levelProgress: user.levelProgress, subscriptionTier: user.subscriptionTier
      }});
    }

    const mult = tierMultiplier(user?.subscriptionTier);
    const award = Math.round((quest.xp || 0) * mult);

    await db.run(`
      INSERT INTO user_quests (userId, questId, status, claimedAt)
      VALUES (?,?, 'claimed', datetime('now'))
      ON CONFLICT(userId, questId) DO UPDATE SET status='claimed', claimedAt=datetime('now')
    `, [uid, quest.id]);

    const newXp = (user?.xp || 0) + award;
    const { levelName, levelProgress } = computeLevel(newXp);
    await db.run("UPDATE users SET xp = ?, levelName = ?, levelProgress = ? WHERE id = ?", [newXp, levelName, levelProgress, uid]);
    const updated = await db.get("SELECT * FROM users WHERE id = ?", [uid]);

    return res.json({
      ok: true,
      quest: { key: quest.key, xp: quest.xp, category: quest.category },
      awarded: award,
      user: {
        id: updated.id, wallet: updated.wallet, xp: updated.xp, levelName: updated.levelName, levelProgress: updated.levelProgress, subscriptionTier: updated.subscriptionTier
      }
    });
  } catch (e) {
    console.error("POST /quests/claim error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
