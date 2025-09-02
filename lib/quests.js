// lib/quests.js
import db from '../db.js';

/**
 * Idempotently award a quest's XP to a wallet and record completion.
 * Returns { ok, xpGain, already }.
 */
export async function awardQuest(wallet, questId) {
  if (!wallet || !Number.isFinite(Number(questId))) {
    return { ok: false, error: 'bad-args' };
  }

  // already?
  const isDone = await db.get(
    'SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?',
    wallet, Number(questId)
  );
  if (isDone) return { ok: true, xpGain: 0, already: true };

  const quest = await db.get(
    'SELECT id, title, xp FROM quests WHERE id = ?',
    Number(questId)
  );
  if (!quest) return { ok: false, error: 'quest-not-found' };

  const now = Date.now();
  await db.run(
    'INSERT INTO completed_quests (wallet, questId, timestamp) VALUES (?, ?, ?)',
    wallet, Number(questId), now
  );
  const xpGain = quest.xp ?? 0;
  await db.run(
    'UPDATE users SET xp = COALESCE(xp,0) + ? WHERE wallet = ?',
    xpGain, wallet
  );

  return { ok: true, xpGain, already: false };
}
