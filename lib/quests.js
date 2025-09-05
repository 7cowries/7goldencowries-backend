// lib/quests.js
import db from '../db.js';

/**
 * Idempotently award a quest's XP to a wallet and record completion.
 * Returns { ok, xpGain, already }.
 */
export async function awardQuest(wallet, questIdentifier) {
  if (!wallet || questIdentifier === undefined || questIdentifier === null || questIdentifier === "") {
    return { ok: false, error: 'bad-args' };
  }

  let quest;
  if (typeof questIdentifier === 'string' && questIdentifier !== '') {
    quest = await db.get('SELECT id, code, xp FROM quests WHERE code = ?', questIdentifier);
    if (!quest) {
      const idNum = Number(questIdentifier);
      if (Number.isFinite(idNum)) {
        quest = await db.get('SELECT id, code, xp FROM quests WHERE id = ?', idNum);
      }
    }
  } else {
    const idNum = Number(questIdentifier);
    if (Number.isFinite(idNum)) {
      quest = await db.get('SELECT id, code, xp FROM quests WHERE id = ?', idNum);
    }
  }
  if (!quest) return { ok: false, error: 'quest-not-found' };

  const qid = quest.id;
  const qcode = quest.code;

  const isDone = await db.get(
    'SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?',
    wallet, qid
  );
  if (isDone) return { ok: true, xpGain: 0, already: true, questId: qcode };

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

  return { ok: true, xpGain, already: false, questId: qcode };
}
