// routes/questDiscordRoutes.js
import express from "express";
import fetch from "node-fetch";
import db from "../db.js";

const router = express.Router();

const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

async function getJoinDiscordQuest() {
  // Prefer code 'JOIN_DISCORD', else any quest where requirement='join_discord'
  let q = await db.get(`SELECT * FROM quests WHERE code='JOIN_DISCORD' AND active=1`);
  if (!q) q = await db.get(`SELECT * FROM quests WHERE requirement='join_discord' AND active=1 LIMIT 1`);
  return q || null;
}

router.post("/api/quests/discord/join/verify", async (req, res) => {
  try {
    if (!BOT || !GUILD_ID) return res.status(500).json({ error: "Discord env missing" });

    const wallet = req.user?.wallet;
    if (!wallet) return res.status(401).json({ error: "Auth required" });

    const quest = await getJoinDiscordQuest();
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const done = await db.get(
      `SELECT 1 FROM quest_history WHERE wallet=? AND (quest_id=? OR title=?) LIMIT 1`,
      wallet, quest.id, quest.code
    );
    if (done) return res.json({ status: "already_completed" });

    const u = await db.get(`SELECT discord_id FROM users WHERE wallet=?`, [wallet]);
    if (!u?.discord_id) return res.status(400).json({ error: "Discord not linked" });

    const resp = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${u.discord_id}`, {
      headers: { Authorization: `Bot ${BOT}` }
    });

    if (resp.status === 404) return res.status(400).json({ error: "Not a guild member yet" });
    if (!resp.ok) return res.status(500).json({ error: "discord_api_error" });

    await db.run("BEGIN");
    try {
      await db.run(
        `UPDATE users SET xp = COALESCE(xp,0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet=?`,
        [quest.xp, wallet]
      );
      await db.run(
        `INSERT INTO quest_history (wallet, quest_id, title, xp)
         VALUES (?,?,?,?)`,
        wallet, quest.id, quest.code, quest.xp
      );
      await db.run("COMMIT");
    } catch (e) { await db.run("ROLLBACK"); throw e; }

    return res.json({ status: "completed", xp: quest.xp });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "dc_verify_failed" });
  }
});

export default router;
