import express from "express";
import db from "../lib/db.js";

const router = express.Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev_admin_secret_change_me";

// very simple header check
router.use((req, res, next) => {
  const key = req.header("x-admin");
  if (key && key === ADMIN_SECRET) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

// Upsert our verified quests (XP=5 each)
router.post("/seed-quests", async (_req, res) => {
  try {
    const quests = [
      { code: "tg_join_channel",  title: "Enroll in the Official 7GoldenCowries Telegram Channel", xp: 5, type: "social", requirement: "tg_channel_member", target: "@GOLDENCOWRIE" },
      { code: "tg_start_bot",     title: "Initiate the 7GoldenCowries Telegram Bot",              xp: 5, type: "social", requirement: "tg_bot_linked",     target: "@GOLDENCOWRIEBOT" },
      { code: "tg_join_group",    title: "Enter the 7GoldenCowries Community Group",              xp: 5, type: "social", requirement: "tg_group_member",    target: "@sevengoldencowries" },
      { code: "x_follow_main",    title: "Follow 7GoldenCowries on X",                            xp: 5, type: "social", requirement: "x_follow",           target: "@7goldencowries" },
      { code: "x_follow_founder", title: "Follow the Founder on X",                               xp: 5, type: "social", requirement: "x_follow",           target: "@0X_deepseek" },
      { code: "x_follow_partner", title: "Follow Our Ecosystem Partner on X",                     xp: 5, type: "social", requirement: "x_follow",           target: "@Gigilabs_" },
      { code: "discord_join",     title: "Enter the 7GoldenCowries Discord Realm",                xp: 5, type: "social", requirement: "discord_member",     target: "https://discord.gg/Yj9TQYdgSP" },
    ];

    for (const q of quests) {
      await db.run(
        `INSERT INTO quests (code, title, xp, type, requirement, target, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(code) DO UPDATE SET
           title=excluded.title,
           xp=excluded.xp,
           type=excluded.type,
           requirement=excluded.requirement,
           target=excluded.target,
           active=excluded.active`,
        q.code, q.title, q.xp, q.type, q.requirement, q.target
      );
    }

    res.json({ ok: true, upserted: quests.length });
  } catch (e) {
    console.error("seed-quests error:", e);
    res.status(500).json({ error: "seed failed" });
  }
});

// quick list for sanity
router.get("/dump-quests", async (_req, res) => {
  const rows = await db.all(`SELECT id, code, title, requirement, target, xp FROM quests ORDER BY id`);
  res.json(rows);
});

export default router;
