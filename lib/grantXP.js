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
  await db.run(
    `INSERT OR IGNORE INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, ${timestamp})`,
    wallet
  );

  const current = await db.get(
    "SELECT COALESCE(xp,0) AS xp, levelName, levelProgress, nextXP FROM users WHERE wallet = ?",
    wallet
  );
  const total = (current?.xp || 0) + amount;
  const level = deriveLevel(total);

  await db.run(
    `UPDATE users
        SET xp = ?,
            levelName = ?,
            levelProgress = ?,
            nextXP = ?,
            updatedAt = ${timestamp}
      WHERE wallet = ?`,
    total,
    level.levelName,
    level.progress,
    level.nextNeed,
    wallet
  );

  return { delta: amount, total, level };
}

export default grantXP;
