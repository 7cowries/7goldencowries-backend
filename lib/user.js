import db from "./db.js";
import { deriveLevel } from "../config/progression.js";

export async function ensureUser(wallet) {
  const address = String(wallet || "").trim();
  if (!address) return null;
  const existing = await db.get("SELECT wallet FROM users WHERE wallet = ?", address);
  if (existing?.wallet) return existing.wallet;
  await db.run(
    `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
     VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(wallet) DO NOTHING`,
    address
  );
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", address);
  return row?.wallet || null;
}

export async function getProfile(wallet) {
  const address = await ensureUser(wallet);
  if (!address) return null;

  const user = await db.get(
    `SELECT wallet, xp, tier, twitterHandle, telegramHandle, telegramId,
            discordHandle, discordId, levelName, levelSymbol, levelProgress
       FROM users WHERE wallet = ?`,
    address
  );
  if (!user) return null;

  const lvl = deriveLevel(user.xp || 0);
  return {
    wallet: address,
    totalXP: lvl.totalXP,
    xp: lvl.xpIntoLevel,
    nextXP: lvl.nextNeed,
    levelName: lvl.levelName,
    levelSymbol: lvl.levelSymbol,
    levelTier: lvl.levelTier,
    progress: lvl.progress,
    tier: user.tier || "Free",
    twitterHandle: user.twitterHandle || null,
    telegramHandle: user.telegramHandle || null,
    telegramId: user.telegramId || null,
    discordHandle: user.discordHandle || null,
    discordId: user.discordId || null,
  };
}

export default { ensureUser, getProfile };
