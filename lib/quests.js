// lib/quests.js
import db from '../db.js';

/**
 * Idempotently award a quest's XP to a wallet and record completion.
 * Returns { ok, xpGain, already }.
 */
export async function awardQuest(wallet, questId) {
  if (!wallet || questId === undefined || questId === null || questId === "") {
    return { ok: false, error: 'bad-args' };
  }

  const idNum = Number(questId);
  let quest;
  if (Number.isFinite(idNum)) {
    quest = await db.get('SELECT id, xp FROM quests WHERE id = ?', idNum);
  } else {
    quest = await db.get('SELECT id, xp FROM quests WHERE code = ?', questId);
  }
  if (!quest) return { ok: false, error: 'quest-not-found' };

  const qid = quest.id;

  const isDone = await db.get(
    'SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?',
    wallet, qid
  );
  if (isDone) return { ok: true, xpGain: 0, already: true, questId: qid };

  const now = Date.now();
  await db.run(
    'INSERT INTO completed_quests (wallet, questId, timestamp) VALUES (?, ?, ?)',
    wallet, qid, now
  );
  const xpGain = quest.xp ?? 0;
  await db.run(
    'UPDATE users SET xp = COALESCE(xp,0) + ? WHERE wallet = ?',
    xpGain, wallet
  );

  return { ok: true, xpGain, already: false, questId: qid };
}
