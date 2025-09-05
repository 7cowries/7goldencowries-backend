import db from "../db.js";

const REFERRAL_XP = Number(process.env.REFERRAL_XP || 100);

export async function maybeCreditReferral(wallet) {
  if (!wallet) return;
  const link = await db.get(
    "SELECT id, referrer, completed FROM referrals WHERE referred = ?",
    wallet
  );
  if (!link || link.completed) return;
  if (link.referrer === wallet) return; // self
  try {
    await db.exec("BEGIN");
      await db.run(
        "UPDATE users SET xp = COALESCE(xp, 0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?",
        REFERRAL_XP,
        link.referrer
      );
    await db.run(
      "UPDATE referrals SET completed = 1 WHERE id = ?",
      link.id
    );
    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    console.error("maybeCreditReferral error", e);
  }
}
