import db from "../db.js";

const BASE_QUESTS = [
  {
    id: "daily-checkin",
    title: "Daily Check-in",
    description: "Open 7goldencowries today and sync.",
    category: "daily",
    xp: 25
  },
  {
    id: "follow-twitter",
    title: "Follow @7goldencowries",
    description: "Follow our X account to unlock ocean XP.",
    category: "social",
    xp: 80,
    link: "https://x.com/7goldencowries"
  },
  {
    id: "retweet-pinned",
    title: "Retweet the pinned quest tweet",
    description: "Boost the pinned tweet to the tides.",
    category: "social",
    xp: 120,
    link: "https://x.com/7goldencowries/status/1947595024117502145"
  },
  {
    id: "quote-pinned",
    title: "Quote the pinned tweet",
    description: "Add your own tide message to the pinned tweet.",
    category: "social",
    xp: 150,
    link: "https://x.com/7goldencowries/status/1947595024117502145"
  },
  {
    id: "referral-first",
    title: "Invite a friend",
    description: "Invite 1 friend that binds wallet.",
    category: "referral",
    xp: 200
  }
];

async function ensureQuestTables() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_id TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, quest_id)
    );
  `);

  /* in case the table existed without quest_id (your Render log error) */
  const cols = await db.all(`PRAGMA table_info(user_quests);`);
  const hasQuestId = cols.some(c => c.name === "quest_id");
  if (!hasQuestId) {
    await db.exec(`ALTER TABLE user_quests ADD COLUMN quest_id TEXT;`);
  }

  // seed base quests idempotently
  for (const q of BASE_QUESTS) {
    await db.run(
      `INSERT OR IGNORE INTO quests (id, title, description, category, xp, link)
       VALUES (?, ?, ?, ?, ?, ?)`,
      q.id, q.title, q.description, q.category, q.xp, q.link || null
    );
  }
}

await ensureQuestTables();

function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

async function getUserByWallet(wallet) {
  const w = normalizeAddress(wallet);
  if (!w) return null;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      xp INTEGER NOT NULL DEFAULT 0,
      levelName TEXT,
      levelProgress REAL,
      twitterHandle TEXT
    );
  `);
  await db.run(`INSERT OR IGNORE INTO users (wallet) VALUES (?)`, w);
  return await db.get(`SELECT * FROM users WHERE wallet = ?`, w);
}

export async function listQuestsHandler(req, res) {
  const wallet =
    req.session?.address ||
    req.get("x-wallet") ||
    req.query.wallet ||
    req.body?.wallet ||
    null;

  await ensureQuestTables();

  const quests = await db.all(`SELECT id, title, description, category, xp, link FROM quests ORDER BY id ASC`);

  let completed = [];
  if (wallet) {
    const user = await getUserByWallet(wallet);
    if (user) {
      const rows = await db.all(`SELECT quest_id FROM user_quests WHERE user_id = ?`, user.id);
      completed = rows.map(r => r.quest_id);
    }
  }

  const data = quests.map(q => ({
    ...q,
    completed: completed.includes(q.id)
  }));

  res.json({ ok: true, quests: data });
}

export async function claimQuestHandler(req, res) {
  const { questId, id } = req.body || {};
  const qid = questId || id;
  if (!qid) return res.status(400).json({ ok: false, error: "quest-id-required" });

  const wallet =
    req.session?.address ||
    req.get("x-wallet") ||
    req.body?.wallet ||
    req.body?.address ||
    null;
  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });

  await ensureQuestTables();

  const user = await getUserByWallet(wallet);
  if (!user) return res.status(500).json({ ok: false, error: "user-not-created" });

  const quest = await db.get(`SELECT * FROM quests WHERE id = ?`, qid);
  if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

  try {
    await db.run(
      `INSERT INTO user_quests (user_id, quest_id, completed_at) VALUES (?, ?, datetime('now'))`,
      user.id,
      quest.id
    );
  } catch (e) {
    // UNIQUE(user_id, quest_id)
  }

  // add XP
  const xpDelta = Number(quest.xp || 0);
  if (xpDelta > 0) {
    await db.run(`UPDATE users SET xp = COALESCE(xp,0) + ? WHERE id = ?`, xpDelta, user.id);
  }

  res.json({ ok: true, quest: quest.id, xpDelta, totalXp: user.xp + xpDelta });
}

export default function questsRouter(app) {
  app.get("/api/quests", listQuestsHandler);
  app.get("/api/v1/quests", listQuestsHandler);
  app.post("/api/quests/claim", claimQuestHandler);
  app.post("/api/v1/quests/claim", claimQuestHandler);
}
