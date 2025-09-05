// routes/questRoutes.js
import express from "express";
import fetch from "node-fetch";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { awardQuest } from "../lib/quests.js";

const router = express.Router();

/* ========= ENV used for verification ========= */
const TGBOT = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHANNEL_UN = process.env.TELEGRAM_CHANNEL_USERNAME;     // e.g. GOLDENCOWRIE (no @)
const TG_GROUP_UN   = process.env.TELEGRAM_GROUP_USERNAME;       // e.g. sevengoldencowries (no @)
const TG_GROUP_ID   = process.env.TELEGRAM_GROUP_ID || null;     // optional numeric -100...
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;           // e.g. 1410268433857122448

/* ========= Helpers ========= */

// Normalize a quest row so old/new schemas both work
function normalizeQuestRow(row = {}) {
  return {
    id: row.id,
    title: row.title || "",
    description: row.description || "",
    category: row.category || "All",
    type: (row.type || row.kind || "link").toLowerCase(),
    url: row.url || "",
    xp: Number(row.xp || 0),
    active: row.active ?? 1,
    sort: Number(row.sort ?? 0),

    // legacy fields
    requiredTier: row.requiredTier || "Free",
    requiresTwitter: !!(row.requiresTwitter || false),

    // flexible gating
    requirement: row.requirement || (row.requiresTwitter ? "x_follow" : "none"),
    target: row.target || row.target_handle || null,
  };
}

// Tier rules
const tierOrder = { Free: 0, "Tier 1": 1, "Tier 2": 2, "Tier 3": 3 };
const multiplierByTier = { Free: 1.0, "Tier 1": 1.25, "Tier 2": 1.5, "Tier 3": 2.0 };

// Telegram: check membership via getChatMember (supports @username or -100... id)
async function tgIsMember(chatIdOrUn, userTelegramId) {
  if (!TGBOT || !userTelegramId) return false;
  const chat =
    !chatIdOrUn ? null :
    chatIdOrUn.startsWith("@") ? chatIdOrUn :
    /^\-?\d+$/.test(chatIdOrUn) ? chatIdOrUn :
    `@${chatIdOrUn}`;
  if (!chat) return false;

  const url = `https://api.telegram.org/bot${TGBOT}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${encodeURIComponent(
    userTelegramId
  )}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!j.ok) return false;
    const status = j.result?.status;
    return ["creator", "administrator", "member", "restricted"].includes(status);
  } catch {
    return false;
  }
}

// Discord: check if user's OAuth token sees our guild
async function discordIsMember(accessToken, guildId) {
  if (!accessToken || !guildId) return false;
  try {
    const r = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return false;
    const guilds = await r.json();
    return Array.isArray(guilds) && guilds.some((g) => String(g.id) === String(guildId));
  } catch {
    return false;
  }
}

/* ========= Route handlers (shared) ========= */

async function listQuestsHandler(_req, res) {
  try {
    const rows = await db.all(`
      SELECT
        id,
        title,
        COALESCE(description,'') AS description,
        COALESCE(category,'All') AS category,
        COALESCE(kind,'link') AS kind,
        COALESCE(url,'') AS url,
              COALESCE(xp, 0) AS xp,
        COALESCE(active,1) AS active,
        COALESCE(sort,0) AS sort,
        COALESCE(updatedAt, createdAt, 0) AS updatedAt
      FROM quests
      WHERE COALESCE(active,1) = 1
      ORDER BY COALESCE(sort,0) ASC, COALESCE(updatedAt, createdAt, 0) DESC
    `);
    const quests = rows.map(normalizeQuestRow);

    if (String(_req.query.flat || "") === "1") return res.json(quests);
    return res.json({ quests });
  } catch (err) {
    console.error("Failed to fetch quests:", err);
    res.status(500).json({ error: "Failed to load quests" });
  }
}

async function completedHandler(req, res) {
  const wallet = (req.params.wallet || "").trim();
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  try {
    const rows = await db.all(
      `SELECT questId FROM completed_quests WHERE wallet = ? ORDER BY timestamp DESC`,
      wallet
    );
    const completed = rows.map((r) => r.questId);
    res.json({ completed });
  } catch (err) {
    console.error("Fetch completed error:", err);
    res.status(500).json({ error: "Failed to fetch completed quests" });
  }
}

async function journalHandler(req, res) {
  const wallet = (req.params.wallet || "").trim();
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  try {
    const journal = await db.all(
      `SELECT q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.questId
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 200`,
      wallet
    );
    res.json({ journal });
  } catch (err) {
    console.error("Journal fetch error:", err);
    res.status(500).json({ error: "Failed to fetch journal" });
  }
}

async function completeHandler(req, res) {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    const questId = String(req.body?.questId || "").trim();
    if (!wallet || !questId) {
      return res.status(400).json({ success: false, message: "Missing wallet or questId" });
    }

    // Prevent double-claim
    const dup = await db.get(
      `SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?`,
      wallet,
      questId
    );
    if (dup) {
      return res.status(400).json({ success: false, message: "Quest already completed" });
    }

    // Load user & quest
    const user =
      (await db.get(
        `SELECT wallet, xp, tier, twitterHandle, telegramId, telegramHandle, discordId, discordHandle, discordAccessToken
           FROM users WHERE wallet = ?`,
        wallet
      )) || {};
    if (!user.wallet) return res.status(404).json({ success: false, message: "User not found" });

    const rawQuest = await db.get(`SELECT * FROM quests WHERE id = ?`, questId);
    if (!rawQuest) return res.status(404).json({ success: false, message: "Quest not found" });
    const quest = normalizeQuestRow(rawQuest);

    // --- Gating: Tier ---
    const userTier = user.tier || "Free";
    const requiredTier = quest.requiredTier || "Free";
    if ((tierOrder[userTier] ?? 0) < (tierOrder[requiredTier] ?? 0)) {
      return res.status(403).json({ success: false, message: `This quest requires ${requiredTier}` });
    }

    // --- Gating: Socials ---
    const hasX  = !!(user.twitterHandle);
    const hasTG = !!(user.telegramId || user.telegramHandle);
    const hasDC = !!(user.discordId || user.discordHandle);

    const tgGroupChat = TG_GROUP_UN ? `@${TG_GROUP_UN}` : TG_GROUP_ID;
    switch (quest.requirement) {
      case "x_follow": {
        if (!(hasX || quest.requiresTwitter)) {
          return res.status(403).json({ success: false, message: "This quest requires a linked X (Twitter) account." });
        }
        // TODO: optional real follow check using user OAuth tokens
        break;
      }
      case "tg_channel_member": {
        if (!hasTG) return res.status(403).json({ success: false, message: "Link Telegram first." });
        if (!TG_CHANNEL_UN) return res.status(500).json({ success: false, message: "Telegram channel handle not configured." });
        const ok = await tgIsMember(`@${TG_CHANNEL_UN}`, user.telegramId);
        if (!ok) return res.status(403).json({ success: false, message: "Join the official Telegram channel first." });
        break;
      }
      case "tg_bot_linked": {
        if (!hasTG) return res.status(403).json({ success: false, message: "Start the Telegram bot first." });
        // (Optional) Add a 'tg_started' flag once your bot sets it.
        break;
      }
      case "tg_group_member": {
        if (!hasTG) return res.status(403).json({ success: false, message: "Link Telegram first." });
        if (!tgGroupChat) return res.status(500).json({ success: false, message: "Telegram group not configured." });
        const ok = await tgIsMember(tgGroupChat, user.telegramId);
        if (!ok) return res.status(403).json({ success: false, message: "Join the community group first." });
        break;
      }
      case "discord_member": {
        if (!hasDC) return res.status(403).json({ success: false, message: "Link Discord first." });
        if (!DISCORD_GUILD_ID) return res.status(500).json({ success: false, message: "Discord guild not configured." });
        const ok = await discordIsMember(user.discordAccessToken, DISCORD_GUILD_ID);
        if (!ok) return res.status(403).json({ success: false, message: "Join the Discord server first." });
        break;
      }
      case "none":
      default:
        // no gating
        break;
    }

    // Award XP with multiplier
    const baseXP = Number(quest.xp || 0);
    const mult = multiplierByTier[userTier] ?? 1;
    const xpGain = Math.max(0, Math.round(baseXP * mult));

    await db.run(
      `UPDATE users SET xp = COALESCE(xp, 0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
      xpGain,
      wallet
    );

    // Recompute level
    const { xp } = await db.get(`SELECT xp FROM users WHERE wallet = ?`, wallet);
    const lvl = deriveLevel(xp);
    await db.run(
      `UPDATE users
         SET levelName = ?, levelProgress = ?, nextXP = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE wallet = ?`,
      lvl.levelName, lvl.progress, lvl.nextNeed, wallet
    );

    // Record completion
    await db.run(
      `INSERT INTO completed_quests (wallet, questId, timestamp) VALUES (?, ?, ?)`,
      wallet, questId, new Date().toISOString()
    );

    // Referral bonus on first completion (+50 XP to referrer)
    const { count } = await db.get(
      `SELECT COUNT(*) AS count FROM completed_quests WHERE wallet = ?`,
      wallet
    );
    if (Number(count) === 1) {
      const ref = await db.get(
        `SELECT referrer FROM referrals WHERE referred = ? AND completed = 0`,
        wallet
      );
      if (ref?.referrer) {
        await db.run(`UPDATE referrals SET completed = 1 WHERE referred = ?`, wallet);
        await db.run(
          `UPDATE users SET xp = COALESCE(xp, 0) + 50, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
          ref.referrer
        );

        const { xp: refXp } = await db.get(
          `SELECT xp FROM users WHERE wallet = ?`,
          ref.referrer
        );
        const refLvl = deriveLevel(refXp);
        await db.run(
          `UPDATE users
              SET levelName = ?, levelProgress = ?, nextXP = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE wallet = ?`,
          refLvl.levelName, refLvl.progress, refLvl.nextNeed, ref.referrer
        );
        console.log(`✨ Referral XP awarded to ${ref.referrer}`);
      }
    }

    return res.json({
      success: true,
      message: `+${xpGain} XP gained!`,
      xpGain,
      baseXP,
      multiplier: mult,
    });
  } catch (err) {
    console.error("Quest complete error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/* ========= Routes (primary + legacy aliases) ========= */

/** PUBLIC: Quests list */
router.get("/api/quests", listQuestsHandler);   // ✅ modern (frontend hits this)

/** Completed IDs for a wallet */
router.get("/api/quests/completed/:wallet", completedHandler); // modern
router.get("/quest/completed/:wallet", completedHandler);      // legacy
router.get("/completed/:wallet", completedHandler);            // extra alias

/** Journal for a wallet */
router.get("/api/quests/journal/:wallet", journalHandler); // modern
router.get("/quest/journal/:wallet", journalHandler);      // legacy
router.get("/journal/:wallet", journalHandler);            // extra alias

/** Complete a quest */
router.post("/api/quests/complete", completeHandler); // modern
router.post("/api/quest/complete", completeHandler);  // legacy

// Idempotent quest XP claim
router.post("/api/quests/claim", async (req, res) => {
  try {
    const wallet =
      req.session.wallet || (req.query.wallet ? String(req.query.wallet) : null);
    const questIdentifier = req.body?.questId;
    if (!wallet) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing wallet address" });
    }
    if (questIdentifier === undefined || questIdentifier === null || questIdentifier === "") {
      return res.status(400).json({ ok: false, error: "bad-args" });
    }

    const result = await awardQuest(wallet, questIdentifier);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: result.error });
    }

    const row = await db.get(`SELECT xp FROM users WHERE wallet = ?`, wallet);
    const xpTotal = row?.xp ?? 0;
    const lvl = deriveLevel(xpTotal);

    return res.json({
      ok: true,
      wallet,
      questId: result.questId,
      xpAwarded: result.xpGain,
      xpTotal,
      levelName: lvl.levelName,
      progress: lvl.progress,
      alreadyClaimed: result.already ? true : undefined,
    });
  } catch (err) {
    console.error("Quest claim error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

export default router;
