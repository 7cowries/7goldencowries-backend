// utils/seed.js
import db from "../db.js";

async function ensureQuestColumns() {
  const cols = await db.all(`PRAGMA table_info(quests)`);
  const names = new Set(cols.map(c => c.name));

  const alters = [];
  if (!names.has("code"))        alters.push(`ALTER TABLE quests ADD COLUMN code TEXT;`);
  if (!names.has("requirement")) alters.push(`ALTER TABLE quests ADD COLUMN requirement TEXT;`);
  if (!names.has("target"))      alters.push(`ALTER TABLE quests ADD COLUMN target TEXT;`);
  if (!names.has("active"))      alters.push(`ALTER TABLE quests ADD COLUMN active INTEGER DEFAULT 1;`);
  // NOTE: most schemas already have a NOT NULL url column; we don't add it here.

  for (const sql of alters) {
    try { await db.run(sql); console.log("Migration OK:", sql); }
    catch (e) { console.log("Migration skipped:", sql, "-", e.message); }
  }

  // Unique index so ON CONFLICT(code) works
  try {
    await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_code ON quests(code)`);
    console.log("Index OK: idx_quests_code");
  } catch (e) {
    console.log("Index skipped: idx_quests_code -", e.message);
  }
}

const QUESTS = [
  {
    code: "tg_join_channel",
    title: "Enroll in the Official 7GoldenCowries Telegram Channel",
    xp: 5, type: "social", requirement: "tg_channel_member",
    target: "@GOLDENCOWRIE",
    url: "https://t.me/GOLDENCOWRIE",
  },
  {
    code: "tg_start_bot",
    title: "Initiate the 7GoldenCowries Telegram Bot",
    xp: 5, type: "social", requirement: "tg_bot_linked",
    target: "@GOLDENCOWRIEBOT",
    url: "https://t.me/GOLDENCOWRIEBOT",
  },
  {
    code: "tg_join_group",
    title: "Enter the 7GoldenCowries Community Group",
    xp: 5, type: "social", requirement: "tg_group_member",
    target: "@sevengoldencowries",
    url: "https://t.me/sevengoldencowries",
  },
  {
    code: "x_follow_main",
    title: "Follow 7GoldenCowries on X",
    xp: 5, type: "social", requirement: "x_follow",
    target: "@7goldencowries",
    url: "https://x.com/7goldencowries",
  },
  {
    code: "x_follow_founder",
    title: "Follow the Founder on X",
    xp: 5, type: "social", requirement: "x_follow",
    target: "@0X_deepseek",
    url: "https://x.com/0X_deepseek",
  },
  {
    code: "x_follow_partner",
    title: "Follow Our Ecosystem Partner on X",
    xp: 5, type: "social", requirement: "x_follow",
    target: "@Gigilabs_",
    url: "https://x.com/Gigilabs_",
  },
  {
    code: "discord_join",
    title: "Enter the 7GoldenCowries Discord Realm",
    xp: 5, type: "social", requirement: "discord_member",
    target: "https://discord.gg/Yj9TQYdgSP",
    url: "https://discord.gg/Yj9TQYdgSP",
  },
];

export async function seedOnBoot({ disableOthers = false } = {}) {
  await ensureQuestColumns();

  for (const q of QUESTS) {
    await db.run(
      `INSERT INTO quests (code, title, xp, type, requirement, target, url, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(code) DO UPDATE SET
         title=excluded.title,
         xp=excluded.xp,
         type=excluded.type,
         requirement=excluded.requirement,
         target=excluded.target,
         url=excluded.url,
         active=excluded.active`,
      q.code, q.title, q.xp, q.type, q.requirement, q.target, q.url
    );
  }

  if (disableOthers) {
    const keep = QUESTS.map(q => q.code);
    await db.run(
      `UPDATE quests SET active=0 WHERE code IS NULL OR code NOT IN (${keep.map(()=>"?").join(",")})`,
      ...keep
    );
  }

  const rows = await db.all(`SELECT id, code, title, requirement, target, url, xp, active FROM quests ORDER BY id`);
  console.log(`✅ Seeded quests (auto-boot):`, rows.length);
}
