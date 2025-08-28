// utils/seed.js
import db from "../db.js";

/* -------------------------------------------
   Ensure quests table has the columns we need
   ------------------------------------------- */
async function ensureQuestColumns() {
  const cols = await db.all(`PRAGMA table_info(quests);`);
  const names = new Set(cols.map((c) => c.name));

  const alters = [];
  // some older DBs didn't have url
  if (!names.has("url"))         alters.push(`ALTER TABLE quests ADD COLUMN url TEXT;`);
  if (!names.has("code"))        alters.push(`ALTER TABLE quests ADD COLUMN code TEXT;`);
  if (!names.has("requirement")) alters.push(`ALTER TABLE quests ADD COLUMN requirement TEXT;`);
  if (!names.has("target"))      alters.push(`ALTER TABLE quests ADD COLUMN target TEXT;`);
  if (!names.has("active"))      alters.push(`ALTER TABLE quests ADD COLUMN active INTEGER DEFAULT 1;`);

  for (const sql of alters) {
    try {
      await db.run(sql);
      console.log("Migration OK:", sql);
    } catch (e) {
      // If it fails because it already exists or type mismatch, just log and continue
      console.log("Migration skipped:", sql, "-", e.message);
    }
  }

  // Unique index so ON CONFLICT(code) works
  try {
    await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_code ON quests(code)`);
    console.log("Index OK: idx_quests_code");
  } catch (e) {
    console.log("Index skipped: idx_quests_code -", e.message);
  }
}

/* -------------------------------------------
   Helpers to build targets/links from .env
   (we strip any leading @)
   ------------------------------------------- */
const stripAt = (s) => (s || "").replace(/^@/, "");

const TG_CH   = stripAt(process.env.TELEGRAM_CHANNEL_USERNAME || "GOLDENCOWRIE");
const TG_GR   = stripAt(process.env.TELEGRAM_GROUP_USERNAME   || "sevengoldencowries");
const TG_BOT  = stripAt(process.env.TELEGRAM_BOT_NAME         || "GOLDENCOWRIEBOT");
const X_MAIN  = stripAt(process.env.TWITTER_TARGET_HANDLE      || "7goldencowries");
const X_FOUN  = stripAt(process.env.TWITTER_FOUNDER_HANDLE     || "0X_deepseek");
const X_PART  = stripAt(process.env.TWITTER_PARTNER_HANDLE     || "Gigilabs_");
const DC_INV  = process.env.DISCORD_INVITE_URL || "https://discord.gg/Yj9TQYdgSP";

const tgUrl   = (name) => `https://t.me/${stripAt(name)}`;
const xUrl    = (name) => `https://x.com/${stripAt(name)}`;

/* -------------------------------------------
   Quest catalog (idempotent upserts by code)
   ------------------------------------------- */
const QUESTS = [
  {
    code: "tg_join_channel",
    title: "Enroll in the Official 7GoldenCowries Telegram Channel",
    xp: 5,
    type: "social",
    requirement: "tg_channel_member",
    target: `@${TG_CH}`,
    url: tgUrl(TG_CH),
  },
  {
    code: "tg_start_bot",
    title: "Initiate the 7GoldenCowries Telegram Bot",
    xp: 5,
    type: "social",
    requirement: "tg_bot_linked",
    target: `@${TG_BOT}`,
    url: tgUrl(TG_BOT),
  },
  {
    code: "tg_join_group",
    title: "Enter the 7GoldenCowries Community Group",
    xp: 5,
    type: "social",
    requirement: "tg_group_member",
    target: `@${TG_GR}`,
    url: tgUrl(TG_GR),
  },
  {
    code: "x_follow_main",
    title: "Follow 7GoldenCowries on X",
    xp: 5,
    type: "social",
    requirement: "x_follow",
    target: `@${X_MAIN}`,
    url: xUrl(X_MAIN),
  },
  {
    code: "x_follow_founder",
    title: "Follow the Founder on X",
    xp: 5,
    type: "social",
    requirement: "x_follow",
    target: `@${X_FOUN}`,
    url: xUrl(X_FOUN),
  },
  {
    code: "x_follow_partner",
    title: "Follow Our Ecosystem Partner on X",
    xp: 5,
    type: "social",
    requirement: "x_follow",
    target: `@${X_PART}`,
    url: xUrl(X_PART),
  },
  {
    code: "discord_join",
    title: "Enter the 7GoldenCowries Discord Realm",
    xp: 5,
    type: "social",
    requirement: "discord_member",
    target: DC_INV,
    url: DC_INV,
  },
];

/* -------------------------------------------
   Seed on boot (idempotent)
   ------------------------------------------- */
export async function seedOnBoot({ disableOthers = false } = {}) {
  await ensureQuestColumns();

  // Transaction for speed + atomicity
  await db.exec("BEGIN");
  try {
    for (const q of QUESTS) {
      // Upsert on the quest code
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
      const keepCodes = QUESTS.map((q) => q.code);
      await db.run(
        `UPDATE quests SET active=0
           WHERE code IS NULL OR code NOT IN (${keepCodes.map(() => "?").join(",")})`,
        ...keepCodes
      );
    }

    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    console.error("❌ Seed failed:", e);
    throw e;
  }

  const rows = await db.all(
    `SELECT id, code, title, requirement, target, url, xp, active
       FROM quests
      ORDER BY id`
  );
  console.log(`✅ Seeded quests (auto-boot): ${rows.length}`);
}
