// routes/questTelegramRoutes.js
// Verifies Telegram GROUP and/or CHANNEL membership and awards XP once per quest.
// ENV needed (set as many as you use):
//   TELEGRAM_BOT_TOKEN=xxxxxxxx:yyyyyyyyyyyyyyy
//   TELEGRAM_GROUP_ID=-1002784283458        (your @sevengoldencowries group)
//   TELEGRAM_CHANNEL_ID=-1002979678444      (your @GOLDENCOWRIE channel)

import express from "express";
import fetch from "node-fetch";
import db from "../db.js";

const router = express.Router();

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_ID;       // supergroup/group
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;   // broadcast channel

/* ----------------------------- helpers ----------------------------- */

// Lookup the most appropriate quest for a given target.
// Prefers exact code first, then requirement variants.
async function findQuestFor(target /* 'group' | 'channel' */) {
  if (target === "group") {
    // Try your existing code first:
    let q =
      (await db.get(`SELECT * FROM quests WHERE code='tg_join_group' AND active=1`)) ||
      (await db.get(
        `SELECT * FROM quests 
          WHERE active=1 AND requirement IN ('tg_group_member','join_telegram_group') 
          ORDER BY id LIMIT 1`
      ));
    return q || null;
  }
  if (target === "channel") {
    let q =
      (await db.get(`SELECT * FROM quests WHERE code='tg_join_channel' AND active=1`)) ||
      (await db.get(
        `SELECT * FROM quests 
          WHERE active=1 AND requirement IN ('tg_channel_member','join_telegram_channel','join_telegram') 
          ORDER BY id LIMIT 1`
      ));
    return q || null;
  }
  return null;
}

// Has this quest already been completed by wallet?
async function alreadyCompleted(wallet, quest) {
  // Your quest_history rows look like (wallet, quest_id, title, xp)
  return await db.get(
    `SELECT 1 FROM quest_history WHERE wallet=? AND (quest_id=? OR title=?) LIMIT 1`,
    wallet,
    quest.id,
    quest.code
  );
}

// Award XP & log in quest_history (idempotent guarded by caller)
async function award(wallet, quest, noteMeta = {}) {
  await db.run("BEGIN");
  try {
    await db.run(
      `UPDATE users SET xp = COALESCE(xp,0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet=?`,
      [quest.xp, wallet]
    );
    await db.run(
      `INSERT INTO quest_history (wallet, quest_id, title, xp)
       VALUES (?,?,?,?)`,
      wallet,
      quest.id,
      quest.code,
      quest.xp
    );
    await db.run("COMMIT");
  } catch (e) {
    await db.run("ROLLBACK");
    throw e;
  }
}

async function getChatMemberStatus(chatId, telegramUserId) {
  const url = `https://api.telegram.org/bot${BOT}/getChatMember?chat_id=${encodeURIComponent(
    chatId
  )}&user_id=${encodeURIComponent(telegramUserId)}`;
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Telegram API error: ${r.status} ${txt}`);
  }
  const j = await r.json();
  return j?.result?.status || null;
}

function isMemberStatus(status) {
  // Accept normal membership and admin/creator
  return ["member", "administrator", "creator", "owner"].includes(status);
}

/* --------------------------- main endpoints --------------------------- */

// Flexible endpoint that can check one or both.
// POST /api/quests/telegram/join/verify
// Body (optional): { target: 'group' | 'channel' }
// If omitted, it will attempt both (for which env IDs are configured).
router.post("/api/quests/telegram/join/verify", async (req, res) => {
  try {
    if (!BOT) return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not set" });

    const wallet = req.user?.wallet;
    if (!wallet) return res.status(401).json({ error: "Auth required" });

    // Must have linked Telegram login before verifying
    const u = await db.get(`SELECT telegram_id FROM users WHERE wallet=?`, [wallet]);
    if (!u?.telegram_id) return res.status(400).json({ error: "Telegram not linked" });

    // Determine which targets to check
    const wanted = (req.body?.target || "").toLowerCase();
    const checkGroup = (wanted ? wanted === "group" : true) && !!GROUP_ID;
    const checkChannel = (wanted ? wanted === "channel" : true) && !!CHANNEL_ID;

    if (!checkGroup && !checkChannel) {
      return res.status(400).json({
        error:
          "Nothing to verify. Provide target='group' or 'channel', and set TELEGRAM_GROUP_ID / TELEGRAM_CHANNEL_ID envs.",
      });
    }

    const results = [];

    // ---- GROUP ----
    if (checkGroup) {
      const quest = await findQuestFor("group");
      if (quest) {
        const done = await alreadyCompleted(wallet, quest);
        if (done) {
          results.push({ target: "group", questCode: quest.code, status: "already_completed" });
        } else {
          const status = await getChatMemberStatus(GROUP_ID, u.telegram_id);
          if (isMemberStatus(status)) {
            await award(wallet, quest, { chatId: GROUP_ID });
            results.push({ target: "group", questCode: quest.code, status: "completed", xp: quest.xp });
          } else {
            results.push({
              target: "group",
              questCode: quest.code,
              status: "not_member",
              detail: `status=${status || "unknown"}`,
            });
          }
        }
      } else {
        results.push({ target: "group", status: "no_matching_quest" });
      }
    }

    // ---- CHANNEL ----
    if (checkChannel) {
      const quest = await findQuestFor("channel");
      if (quest) {
        const done = await alreadyCompleted(wallet, quest);
        if (done) {
          results.push({ target: "channel", questCode: quest.code, status: "already_completed" });
        } else {
          const status = await getChatMemberStatus(CHANNEL_ID, u.telegram_id);
          if (isMemberStatus(status)) {
            await award(wallet, quest, { chatId: CHANNEL_ID });
            results.push({ target: "channel", questCode: quest.code, status: "completed", xp: quest.xp });
          } else {
            results.push({
              target: "channel",
              questCode: quest.code,
              status: "not_member",
              detail: `status=${status || "unknown"}`,
            });
          }
        }
      } else {
        results.push({ target: "channel", status: "no_matching_quest" });
      }
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error("telegram/join/verify error:", e);
    res.status(500).json({ error: "tg_verify_failed" });
  }
});

export default router;
