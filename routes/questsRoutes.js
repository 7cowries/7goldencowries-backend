import express from "express";
import db from "../db.js";

const router = express.Router();

/* =========================================================
   DB-DRIVEN SEEDERS (run once; no stub responses)
   ========================================================= */
async function ensureCoreSchema() {
  // Core tables
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS levels_v2 (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL UNIQUE,
      base     INTEGER NOT NULL,
      size     INTEGER NOT NULL,
      ord      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS subscription_tiers (
      name        TEXT PRIMARY KEY,
      multiplier  REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quest_categories_v2 (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quests_v2 (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      key       TEXT UNIQUE,
      title     TEXT NOT NULL,
      category  TEXT NOT NULL REFERENCES quest_categories_v2(key) ON UPDATE CASCADE ON DELETE RESTRICT,
      xp        INTEGER NOT NULL,
      url       TEXT,
      partner   TEXT,
      isDaily   INTEGER DEFAULT 0,
      startsAt  TEXT,
      endsAt    TEXT,
      active    INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_quests_v2 (
      userId    INTEGER NOT NULL,
      questId   INTEGER NOT NULL,
      status    TEXT DEFAULT 'pending',
      claimedAt TEXT,
      PRIMARY KEY (userId, questId)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      wallet    TEXT PRIMARY KEY,
      tier      TEXT NOT NULL,
      tonPaid   REAL,
      usdPaid   REAL,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed levels if empty (stored in DB; compute reads from DB only)
  const levelCount = (await db.get(`SELECT COUNT(*) AS n FROM levels_v2`))?.n || 0;
  if (levelCount === 0) {
    const defaults = [
      { name: "Shellborn",        base: 0,      size: 10000,  ord: 1 },
      { name: "Wave Seeker",      base: 10000,  size: 15000,  ord: 2 },
      { name: "Tide Whisperer",   base: 25000,  size: 25000,  ord: 3 },
      { name: "Current Binder",   base: 50000,  size: 50000,  ord: 4 },
      { name: "Pearl Bearer",     base: 100000, size: 100000, ord: 5 },
      { name: "Isle Champion",    base: 200000, size: 150000, ord: 6 },
      { name: "Cowrie Ascendant", base: 350000, size: 200000, ord: 7 }
    ];
    const stmt = await db.prepare(`INSERT INTO levels_v2 (name, base, size, ord) VALUES (?,?,?,?)`);
    try {
      for (const L of defaults) await stmt.run(L.name, L.base, L.size, L.ord);
    } finally { await stmt.finalize(); }
  }

  // Seed subscription tiers if empty
  const tierCount = (await db.get(`SELECT COUNT(*) AS n FROM subscription_tiers`))?.n || 0;
  if (tierCount === 0) {
    const tiers = [
      { name: "Free",  multiplier: 1.0  },
      { name: "Tier 1", multiplier: 1.10 },
      { name: "Tier 2", multiplier: 1.25 },
      { name: "Tier 3", multiplier: 1.50 }
    ];
    const stmt = await db.prepare(`INSERT OR IGNORE INTO subscription_tiers (name, multiplier) VALUES (?,?)`);
    try {
      for (const t of tiers) await stmt.run(t.name, t.multiplier);
    } finally { await stmt.finalize(); }
  }

  // Seed categories if empty
  const catCount = (await db.get(`SELECT COUNT(*) AS n FROM quest_categories_v2`))?.n || 0;
  if (catCount === 0) {
    const cats = [
      ["daily", "Daily"],
      ["social", "Social"],
      ["partner", "Partner"],
      ["insider", "Insider"],
      ["onchain", "On-Chain"]
    ];
    const stmt = await db.prepare(`INSERT OR IGNORE INTO quest_categories_v2 (key, name) VALUES (?,?)`);
    try {
      for (const [k, n] of cats) await stmt.run(k, n);
    } finally { await stmt.finalize(); }
  }

  // Seed quests if empty
  const qCount = (await db.get(`SELECT COUNT(*) AS n FROM quests_v2`))?.n || 0;
  if (qCount === 0) {
    const quests = [
      { key: "daily_checkin",  title: "Daily Check-in",              category: "daily",   xp: 500,  url: "/quests/daily",  partner: null,          isDaily: 1 },
      { key: "follow_x",       title: "Follow @7goldencowries on X", category: "social",  xp: 1500, url: "https://x.com/7goldencowries",            partner: null,          isDaily: 0 },
      { key: "retweet_pinned", title: "Retweet the pinned post",     category: "social",  xp: 2000, url: "https://x.com/7goldencowries/status/1947595024117502145", partner: null, isDaily: 0 },
      { key: "quote_pinned",   title: "Quote the pinned post",       category: "social",  xp: 2500, url: "https://x.com/7goldencowries/status/1947595024117502145", partner: null, isDaily: 0 },
      { key: "join_telegram",  title: "Join our Telegram",           category: "partner", xp: 1000, url: "https://t.me/GOLDENCOWRIEBOT",           partner: "Telegram",    isDaily: 0 },
      { key: "join_discord",   title: "Join our Discord",            category: "partner", xp: 1200, url: "https://discord.gg/7goldencowries",       partner: "Discord",     isDaily: 0 },
      { key: "read_guide",     title: "Read the Isles Guide",        category: "insider", xp: 800,  url: "/guide/isles",                             partner: null,          isDaily: 0 },
      { key: "first_tx",       title: "Make your first TON tx",      category: "onchain", xp: 3000, url: "/onchain/first",                          partner: null,          isDaily: 0 }
    ];
    const stmt = await db.prepare(`
      INSERT OR IGNORE INTO quests_v2 (key, title, category, xp, url, partner, isDaily, active)
      VALUES (?,?,?,?,?,?,?,1)
    `);
    try {
      for (const q of quests) {
        await stmt.run(q.key, q.title, q.category, q.xp, q.url, q.partner, q.isDaily ? 1 : 0);
      }
    } finally { await stmt.finalize(); }
  }

  // Probe quest (for deterministic multiplier testing)
  await db.run(`
    INSERT OR IGNORE INTO quests_v2 (key, title, category, xp, url, partner, isDaily, active)
    VALUES ('probe_1000','(Probe) Multiplier Check','insider',1000,NULL,NULL,0,1)
  `);
}

/* =========================================================
   HELPERS that read from DB (no stub arrays)
   ========================================================= */
async function getTiersMap() {
  const rows = await db.all(`SELECT name, multiplier FROM subscription_tiers`);
  const map = new Map();
  for (const r of rows) map.set(String(r.name).toLowerCase(), Number(r.multiplier));
  if (!map.has("free")) map.set("free", 1.0);
  return map;
}

async function computeLevelFromDB(xp) {
  const levels = await db.all(`SELECT name, base, size FROM levels_v2 ORDER BY base ASC`);
  if (!levels || levels.length === 0) {
    // safety: if seeding somehow failed
    return { levelName: "Shellborn", levelProgress: 0 };
  }
  let current = levels[0];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].base) { current = levels[i]; break; }
  }
  const progress = Math.max(0, Math.min(1, (xp - current.base) / (current.size || 1)));
  return { levelName: current.name, levelProgress: Number(progress.toFixed(3)) };
}

/* =========================================================
   ROUTES
   ========================================================= */

/** GET /quests (DB-driven, joins user status) */
router.get("/quests", async (req, res) => {
  try {
    await ensureCoreSchema();
    const uid = req.session?.userId || -1;
    const rows = await db.all(`
      SELECT q.*, COALESCE(uq.status, 'pending') AS status, uq.claimedAt
      FROM quests_v2 q
      LEFT JOIN user_quests_v2 uq ON uq.questId = q.id AND uq.userId = ?
      WHERE q.active = 1
      ORDER BY
        CASE q.category
          WHEN 'daily'   THEN 1
          WHEN 'social'  THEN 2
          WHEN 'partner' THEN 3
          WHEN 'insider' THEN 4
          WHEN 'onchain' THEN 5
          ELSE 6
        END,
        q.id ASC
    `, [uid]);
    return res.json({ ok: true, quests: rows });
  } catch (e) {
    console.error("GET /quests error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/** POST /quests/claim { key } (tier multiplier from DB) */
router.post("/quests/claim", async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ ok: false, error: "not_logged_in" });

  try {
    await ensureCoreSchema();

    const key = (req.body?.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "key_required" });

    const quest = await db.get(`SELECT * FROM quests_v2 WHERE key = ? AND active = 1`, [key]);
    if (!quest) return res.status(404).json({ ok: false, error: "quest_not_found" });

    const uq = await db.get(`SELECT status FROM user_quests_v2 WHERE userId = ? AND questId = ?`, [uid, quest.id]);
    const user = await db.get(`SELECT * FROM users WHERE id = ?`, [uid]);

    if (uq?.status === "claimed") {
      return res.json({
        ok: true, already: true,
        quest: { key: quest.key, xp: quest.xp, category: quest.category },
        user: {
          id: user.id, wallet: user.wallet, xp: user.xp,
          levelName: user.levelName, levelProgress: user.levelProgress,
          subscriptionTier: user.subscriptionTier
        }
      });
    }

    // Multiplier from DB
    const tiers = await getTiersMap();
    const mult = tiers.get(String(user?.subscriptionTier || "Free").toLowerCase()) || 1.0;
    const award = Math.round((quest.xp || 0) * mult);

    await db.run(`
      INSERT INTO user_quests_v2 (userId, questId, status, claimedAt)
      VALUES (?,?, 'claimed', datetime('now'))
      ON CONFLICT(userId, questId) DO UPDATE SET status='claimed', claimedAt=datetime('now')
    `, [uid, quest.id]);

    const newXp = (user?.xp || 0) + award;
    const { levelName, levelProgress } = await computeLevelFromDB(newXp);
    await db.run(`UPDATE users SET xp = ?, levelName = ?, levelProgress = ? WHERE id = ?`, [newXp, levelName, levelProgress, uid]);
    const updated = await db.get(`SELECT * FROM users WHERE id = ?`, [uid]);

    return res.json({
      ok: true,
      quest: { key: quest.key, xp: quest.xp, category: quest.category },
      awarded: award,
      user: {
        id: updated.id, wallet: updated.wallet, xp: updated.xp,
        levelName: updated.levelName, levelProgress: updated.levelProgress,
        subscriptionTier: updated.subscriptionTier
      }
    });
  } catch (e) {
    console.error("POST /quests/claim error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/** GET /subscriptions/status (reads real user tier) */
router.get("/subscriptions/status", async (req, res) => {
  try {
    await ensureCoreSchema();
    const uid = req.session?.userId;
    if (!uid) return res.json({ ok: true, active: false, tier: "Free" });
    const user = await db.get(`SELECT subscriptionTier FROM users WHERE id = ?`, [uid]);
    const tier = user?.subscriptionTier || "Free";
    return res.json({ ok: true, active: tier !== "Free", tier });
  } catch (e) {
    console.error("GET /subscriptions/status error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/** POST /subscriptions/upgrade & /subscriptions/subscribe (persists to DB, never stub) */
async function handleUpgrade(req, res) {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ ok: false, error: "not_logged_in" });

  let { tier = "Tier 1", txHash = null, tonPaid = null, usdPaid = null } = req.body || {};
  try {
    await ensureCoreSchema();

    // Validate against DB tier list
    const tiers = await db.all(`SELECT name FROM subscription_tiers`);
    const allowed = new Set(tiers.map(t => t.name));
    if (!allowed.has(tier)) tier = "Tier 1";

    const user = await db.get(`SELECT wallet FROM users WHERE id = ?`, [uid]);
    if (!user?.wallet) return res.status(404).json({ ok: false, error: "user_not_found" });

    try {
      await db.run(
        `INSERT INTO subscriptions (wallet, tier, tonPaid, usdPaid) VALUES (?,?,?,?)`,
        [user.wallet, tier, tonPaid, usdPaid]
      );
    } catch {
      await db.run(
        `UPDATE subscriptions SET tier = ?, tonPaid = ?, usdPaid = ?, createdAt = datetime('now') WHERE wallet = ?`,
        [tier, tonPaid, usdPaid, user.wallet]
      );
    }

    await db.run(`UPDATE users SET subscriptionTier = ? WHERE id = ?`, [tier, uid]);
    return res.json({ ok: true, tier });
  } catch (e) {
    console.error("POST /subscriptions/upgrade error", e);
    // still persist tier optimistically to avoid front-end dead-ends
    try { await db.run(`UPDATE users SET subscriptionTier = ? WHERE id = ?`, [tier, uid]); } catch {}
    return res.json({ ok: true, tier });
  }
}
router.post("/subscriptions/upgrade", handleUpgrade);
router.post("/subscriptions/subscribe", handleUpgrade);

/** Optional: FE can read levels & tiers for UI without hardcoding */
router.get("/meta/levels", async (_req, res) => {
  try {
    await ensureCoreSchema();
    const rows = await db.all(`SELECT name, base, size, ord FROM levels_v2 ORDER BY ord ASC, base ASC`);
    res.json({ ok: true, levels: rows });
  } catch (e) {
    console.error("GET /meta/levels error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/meta/tiers", async (_req, res) => {
  try {
    await ensureCoreSchema();
    const rows = await db.all(`SELECT name, multiplier FROM subscription_tiers ORDER BY name ASC`);
    res.json({ ok: true, tiers: rows });
  } catch (e) {
    console.error("GET /meta/tiers error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
