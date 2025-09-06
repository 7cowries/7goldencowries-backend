// routes/questRoutes.js
import express from "express";
import fetch from "node-fetch";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { delCache } from "../utils/cache.js";
import { awardQuest } from "../lib/quests.js";
import { getTierMultiplier } from "../utils/tier.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { normalizeTweetUrl, verifyProofRow } from "../lib/proof.js";

const router = express.Router();

const proofLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, _res) => req.session?.wallet || ipKeyGenerator(req),
});

// simple twitter url regex
const TWITTER_STATUS_RE = /^https:\/\/(x|twitter)\.com\/[^/]+\/status\/(\d+)/i;

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

async function listQuestsHandler(req, res) {
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
    let quests = rows.map(normalizeQuestRow);
    const wallet = req.session?.wallet;
    if (wallet) {
      const completedRows = await db.all(
        `SELECT quest_id FROM completed_quests WHERE wallet = ?`,
        wallet
      );
      const completedSet = new Set(completedRows.map((r) => String(r.quest_id)));
      const proofRows = await db.all(
        `SELECT quest_id, status FROM proofs WHERE wallet = ?`,
        wallet
      );
      const proofMap = new Map(proofRows.map((r) => [String(r.quest_id), r.status]));
      quests = quests.map((q) => ({
        ...q,
        completed: completedSet.has(String(q.id)),
        proofStatus: proofMap.get(String(q.id)) || null,
      }));
    } else {
      quests = quests.map((q) => ({ ...q, completed: false, proofStatus: null }));
    }
    if (String(req.query.flat || "") === "1") return res.json(quests);
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
      `SELECT quest_id FROM completed_quests WHERE wallet = ? ORDER BY timestamp DESC`,
      wallet
    );
    const completed = rows.map((r) => r.quest_id);
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
         JOIN quests q ON q.id = c.quest_id
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

// legacy complete handler removed (proof-based claim is used instead)

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

/** Submit a Twitter/X proof URL */
router.post("/api/quests/submit-proof", proofLimiter, async (req, res) => {
  try {
    const sessionWallet = req.session?.wallet || null;
    const walletParam = String(req.body?.wallet || req.query.wallet || "").trim();
    const wallet = sessionWallet || walletParam;
    if (!wallet || (sessionWallet && walletParam && walletParam !== sessionWallet)) {
      return res.status(403).json({ status: "rejected", reason: "auth-required" });
    }
    const questId = String(
      req.body?.questId ?? req.body?.quest_id ?? ""
    ).trim();
    const url = String(req.body?.url || "").trim();
    if (!questId || !url) return res.status(400).json({ status: "rejected", reason: "bad-args" });

    const quest = await db.get(`SELECT requirement, active FROM quests WHERE id = ?`, questId);
    if (!quest || quest.active !== 1) {
      return res.status(404).json({ status: "rejected", reason: "quest-not-found" });
    }

    let parsed;
    try {
      parsed = normalizeTweetUrl(url);
    } catch {
      return res.status(400).json({ status: "rejected", reason: "invalid-url" });
    }

    const user = await db.get(`SELECT twitterHandle, twitter_username FROM users WHERE wallet = ?`, wallet);
    const userHandle = (user?.twitterHandle || user?.twitter_username || '').toLowerCase();
    if (quest.requirement && quest.requirement.startsWith('x_')) {
      if (!userHandle) return res.status(403).json({ status: 'rejected', reason: 'not-linked' });
      if (userHandle !== parsed.handle.toLowerCase()) {
        return res.status(403).json({ status: 'rejected', reason: 'handle-mismatch' });
      }
    }

    const existing = await db.get(
      `SELECT id, status, reason, updatedAt FROM proofs WHERE wallet = ? AND quest_id = ?`,
      wallet,
      questId
    );
    if (existing && (existing.status === 'pending' || existing.status === 'verified')) {
      return res.status(409).json({ status: existing.status, reason: existing.reason });
    }
    if (existing) {
      const diff = Date.now() - new Date(existing.updatedAt).getTime();
      if (diff < 10_000) {
        return res.status(429).json({ status: existing.status, reason: 'cooldown' });
      }
    }

    await db.run(
      `INSERT INTO proofs (wallet, quest_id, url, provider, status, tweet_id, handle, createdAt, updatedAt)
       VALUES (?, ?, ?, 'x', 'pending', ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(wallet, quest_id) DO UPDATE SET url=excluded.url, status='pending', reason=NULL, provider='x', tweet_id=excluded.tweet_id, handle=excluded.handle, updatedAt=datetime('now')`,
      wallet,
      questId,
      parsed.url,
      parsed.tweetId,
      parsed.handle
    );
    const row = await db.get(`SELECT id FROM proofs WHERE wallet = ? AND quest_id = ?`, wallet, questId);
    setImmediate(() => verifyProofRow(row.id));
    return res.json({ status: 'pending' });
  } catch (err) {
    console.error('submit-proof error', err);
    res.status(500).json({ status: 'rejected', reason: 'server-error' });
  }
});

// Read latest proof status for a wallet+quest
router.get("/api/quests/proof-status", async (req, res) => {
  try {
    const wallet = String(req.query.wallet || "").trim();
    const questId = String(
      req.query.questId ?? req.query.quest_id ?? ""
    ).trim();
    if (!wallet || !questId) return res.status(400).json({ error: "bad-args" });
    const row = await db.get(
      `SELECT status, reason FROM proofs WHERE wallet = ? AND quest_id = ?`,
      wallet,
      questId
    );
    if (!row) return res.json({ status: "none" });
    return res.json(row);
  } catch (err) {
    console.error("proof-status error", err);
    res.status(500).json({ error: "server-error" });
  }
});

// Simplified proof submission
router.post("/api/quests/:questId/proofs", async (req, res) => {
  try {
    const wallet = req.session?.wallet;
    if (!wallet) return res.status(401).json({ ok: false, error: "auth-required" });

    const questId = req.params.questId || String(req.body?.quest_id || req.body?.questId || "").trim();
    const vendor = String(req.body?.vendor || "").trim() || null;
    const url = String(req.body?.url || "").trim();
    if (!questId || !url) return res.status(400).json({ ok: false, error: "bad-args" });

    let tweetId = null;
    if (vendor === "twitter") {
      const m = TWITTER_STATUS_RE.exec(url);
      if (!m) return res.status(400).json({ ok: false, error: "invalid-url" });
      tweetId = m[2];
    }

    const quest = await db.get(`SELECT id FROM quests WHERE id = ?`, questId);
    if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

    await db.run(
      `INSERT INTO quest_proofs (wallet, quest_id, vendor, url, tweet_id, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(wallet, quest_id) DO UPDATE SET vendor=excluded.vendor, url=excluded.url, tweet_id=excluded.tweet_id, updatedAt=datetime('now')`,
      wallet,
      quest.id,
      vendor,
      url,
      tweetId
    );

    const proof = await db.get(
      `SELECT id, wallet, quest_id, vendor, url, tweet_id, updatedAt FROM quest_proofs WHERE wallet = ? AND quest_id = ?`,
      wallet,
      quest.id
    );
    const completed = await db.get(
      `SELECT 1 FROM completed_quests WHERE wallet = ? AND quest_id = ?`,
      wallet,
      quest.id
    );
    return res.json({ ok: true, proof, canClaim: !completed });
  } catch (err) {
    console.error("proof submit error", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

// Simplified claim using session wallet
router.post("/api/quests/:questId/claim", async (req, res) => {
  try {
    const wallet = req.session?.wallet;
    if (!wallet) return res.status(401).json({ ok: false, error: "auth-required" });
    const questId = req.params.questId || String(req.body?.quest_id || req.body?.questId || "").trim();
    if (!questId) return res.status(400).json({ ok: false, error: "bad-args" });

    const quest = await db.get(`SELECT id, xp, requirement FROM quests WHERE id = ?`, questId);
    if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

    if (quest.requirement && quest.requirement !== "none") {
      const proof = await db.get(
        `SELECT id FROM quest_proofs WHERE wallet = ? AND quest_id = ?`,
        wallet,
        quest.id
      );
      if (!proof) return res.status(403).json({ ok: false, error: "proof-required" });
    }

    const result = await awardQuest(wallet, quest.id);
    delCache(`user:${wallet}`);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, alreadyClaimed: result.already ? true : undefined });
  } catch (err) {
    console.error("claim error", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

// Idempotent quest XP claim
router.post("/api/quests/claim", async (req, res) => {
  try {
    const wallet =
      req.session.wallet || (req.query.wallet ? String(req.query.wallet) : null);
    const questIdentifier = req.body?.questId ?? req.body?.quest_id;
    if (!wallet) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing wallet address" });
    }
    if (questIdentifier === undefined || questIdentifier === null || questIdentifier === "") {
      return res.status(400).json({ ok: false, error: "bad-args" });
    }

    let qrow = await db.get(`SELECT id, requirement FROM quests WHERE id = ?`, questIdentifier);
    if (!qrow && typeof questIdentifier === "string" && questIdentifier !== "") {
      try {
        qrow = await db.get(`SELECT id, requirement FROM quests WHERE code = ?`, questIdentifier);
      } catch {}
    }
    if (!qrow) {
      return res.status(404).json({ ok: false, error: "quest-not-found" });
    }
    if (qrow.requirement && qrow.requirement !== "none") {
      const proof = await db.get(
        `SELECT status FROM proofs WHERE wallet = ? AND quest_id = ?`,
        wallet,
        qrow.id
      );
      if (!proof || proof.status !== "verified") {
        return res.status(403).json({ ok: false, error: "proof-required", message: "Submit a valid proof first." });
      }
    }

    const result = await awardQuest(wallet, qrow.id);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: result.error });
    }
    delCache(`user:${wallet}`);

    const row = await db.get(`SELECT xp FROM users WHERE wallet = ?`, wallet);
    const newTotalXp = row?.xp ?? 0;
    const lvl = deriveLevel(newTotalXp);

    return res.json({
      ok: true,
      questId: result.questId,
      baseXp: result.baseXp,
      multiplier: result.multiplier,
      effectiveXp: result.xpGain,
      newTotalXp,
      level: lvl.levelName,
      levelProgress: lvl.progress,
      alreadyClaimed: result.already ? true : undefined,
    });
  } catch (err) {
    console.error("Quest claim error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

export default router;
