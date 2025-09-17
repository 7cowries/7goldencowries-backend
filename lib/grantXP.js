import db from "./db.js";
import { deriveLevel } from "../config/progression.js";

function resolveWallet(input) {
  if (!input) return null;
  if (typeof input === "string") return input;
  if (typeof input === "object" && input.wallet) return String(input.wallet);
  return null;
}

export async function grantXP(userOrWallet, delta) {
  const wallet = resolveWallet(userOrWallet);
  const amount = Math.max(0, Number(delta) || 0);
  if (!wallet) {
    return { delta: 0, total: 0 };
  }

  if (amount === 0) {
    const row = await db.get("SELECT COALESCE(xp,0) AS xp FROM users WHERE wallet = ?", wallet);
    const total = row?.xp ?? 0;
    const level = deriveLevel(total);
    return { delta: 0, total, level };
  }

  const timestamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const base = deriveLevel(0);
  await db.run(
    `INSERT OR IGNORE INTO users (wallet, xp, tier, level, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
       VALUES (?, 0, 'Free', ?, ?, ?, ?, ?, ${timestamp})`,
    wallet,
    base.level,
    base.levelName,
    base.levelSymbol,
    base.progress,
    base.nextNeed
  );

  const current = await db.get(
    "SELECT COALESCE(xp,0) AS xp, level, levelName, levelSymbol, levelProgress, nextXP FROM users WHERE wallet = ?",
    wallet
  );
  const total = (current?.xp || 0) + amount;
  const level = deriveLevel(total);

  await db.run(
    `UPDATE users
        SET xp = ?,
            level = ?,
            levelName = ?,
            levelSymbol = ?,
            levelProgress = ?,
            nextXP = ?,
            updatedAt = ${timestamp}
      WHERE wallet = ?`,
    total,
    level.level,
    level.levelName,
    level.levelSymbol,
    level.progress,
    level.nextNeed,
    wallet
  );

  return { delta: amount, total, level };
}

export default grantXP;
