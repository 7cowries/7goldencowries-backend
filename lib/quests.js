// lib/quests.js
import db from '../lib/db.js';
import { maybeCreditReferral } from '../utils/referrals.js';
import { maybeRecordFirstQuest } from './referrals.js';
import { delCache } from '../utils/cache.js';

/**
 * Idempotently award a quest's XP to a wallet and record completion.
 * Returns { ok, xpGain, already }.
 */
export async function awardQuest(wallet, questIdentifier) {
  if (!wallet || questIdentifier === undefined || questIdentifier === null || questIdentifier === "") {
    return { ok: false, error: 'bad-args' };
  }

  let quest = await db.get('SELECT id, xp FROM quests WHERE id = ?', questIdentifier);
  if (!quest && typeof questIdentifier === 'string' && questIdentifier !== '') {
    try {
      quest = await db.get('SELECT id, xp FROM quests WHERE code = ?', questIdentifier);
    } catch {
      /* ignore if code column missing */
    }
  }
  if (!quest) return { ok: false, error: 'quest-not-found' };

  const qid = quest.id;

  const isDone = await db.get(
    'SELECT 1 FROM completed_quests WHERE wallet = ? AND quest_id = ?',
    wallet, qid
  );
  if (isDone) return { ok: true, xpGain: 0, already: true };

  const now = Date.now();
  await db.run(
    'INSERT INTO completed_quests (wallet, quest_id, timestamp) VALUES (?, ?, ?)',
    wallet, qid, now
  );
  const baseXp = quest.xp ?? 0;
  const urow = await db.get('SELECT tier FROM users WHERE wallet = ?', wallet);
  const tier = String(urow?.tier || 'Free').toLowerCase();
  const multMap = { free: 1.0, tier1: 1.05, tier2: 1.1, tier3: 1.25 };
  const multiplier = multMap[tier] ?? 1.0;
  const xpGain = Math.round(baseXp * multiplier);
  await db.run(
    "UPDATE users SET xp = COALESCE(xp, 0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?",
    xpGain, wallet
  );
  await maybeCreditReferral(wallet);
  try {
    const u = await db.get('SELECT id FROM users WHERE wallet = ?', wallet);
    if (u?.id) await maybeRecordFirstQuest(u.id);
  } catch {
    /* ignore missing schema */
  }
  delCache('leaderboard');
  delCache(`user:${wallet}`);

  return { ok: true, xpGain, already: false };
}
