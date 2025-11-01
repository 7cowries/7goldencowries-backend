import { Router } from "express";
import dbp from "../db.js";

const router = Router();

router.get("/", async (_req, res) => {
  const db = await dbp;
  // Join with the latest subscription tier per wallet (no 'active' reads)
  const rows = await db.all(`
    WITH latest_sub AS (
      SELECT s.wallet, s.tier
      FROM subscriptions s
      JOIN (
        SELECT wallet, MAX(id) AS max_id
        FROM subscriptions
        GROUP BY wallet
      ) m ON s.wallet = m.wallet AND s.id = m.max_id
    )
    SELECT u.wallet, u.twitter_handle, u.xp, u.level, u.level_name,
           COALESCE(ls.tier, 'Free') AS tier
    FROM users u
    LEFT JOIN latest_sub ls ON ls.wallet = u.wallet
    ORDER BY u.xp DESC, u.id ASC
    LIMIT 100;
  `);
  res.json({ ok:true, rows });
});

export default router;
