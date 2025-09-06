/**
 * Return XP multiplier for a wallet's tier. Defaults to 1.0 when tier missing.
 * @param {object} dbConn - sqlite database connection
 * @param {string} wallet - user wallet address
 * @returns {Promise<number>}
 */
export async function getTierMultiplier(dbConn, wallet) {
  if (!wallet) return 1.0;
  const row = await dbConn.get(
    `SELECT COALESCE(m.multiplier, 1.0) AS mult
       FROM users u LEFT JOIN tier_multipliers m ON m.tier = u.tier
      WHERE u.wallet = ?
      LIMIT 1`,
    wallet
  );
  return row?.mult ?? 1.0;
}

