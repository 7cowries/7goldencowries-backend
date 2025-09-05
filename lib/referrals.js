import db from '../db.js';

const REFERRER_XP = 50;
const REFEREE_XP  = 25;

export async function maybeRecordFirstQuest(userId) {
  // already recorded?
  const ev = await db.get(
    'SELECT first_quest_completed_at FROM referral_events WHERE referee_user_id=?',
    [userId]
  );
  if (ev?.first_quest_completed_at) return;

  // at least 1 completion?
  const c = await db.get('SELECT COUNT(*) AS n FROM quest_completions WHERE user_id=?', [userId]);
  if ((c?.n || 0) < 1) return;

  // has a referrer?
  const ref = await db.get('SELECT referrer_user_id FROM referrals WHERE referee_user_id=?', [userId]);
  if (!ref?.referrer_user_id) return;

  await db.run('BEGIN');
  try {
    await db.run(
      'INSERT INTO referral_events (referee_user_id, first_quest_completed_at) VALUES (?, CURRENT_TIMESTAMP)',
      [userId]
    );

    // award to referee (new user)
    await db.run(
      "UPDATE users SET xp = COALESCE(xp,0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      [REFEREE_XP, userId]
    );
    await db.run('INSERT INTO xp_history (user_id, delta, reason, meta) VALUES (?,?,?,?)',
      [userId, REFEREE_XP, 'REFERRAL:referee_bonus', JSON.stringify({ by: ref.referrer_user_id })]);

    // award to referrer
    await db.run(
      "UPDATE users SET xp = COALESCE(xp,0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      [REFERRER_XP, ref.referrer_user_id]
    );
    await db.run('INSERT INTO xp_history (user_id, delta, reason, meta) VALUES (?,?,?,?)',
      [ref.referrer_user_id, REFERRER_XP, 'REFERRAL:referrer_bonus', JSON.stringify({ referee: userId })]);

    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
}
