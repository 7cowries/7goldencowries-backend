import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Backfill users.xp from completed_quests when xp is NULL or 0.
 * Preserves any existing bonuses or multipliers.
 * @param {import('sqlite').Database} db
 */
export async function backfillXP(db) {
  console.log('XP backfill: preserving existing XP; only filling NULL/0');
  const sqlPath = path.join(__dirname, '../migrations/2025-09-03_recompute_user_xp.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await db.exec(sql);
}

export default backfillXP;
