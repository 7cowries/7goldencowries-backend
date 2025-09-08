import db from '../db.js';

/**
 * Merge social data for a user under users.socials JSON column.
 * @param {string} wallet
 * @param {string} provider one of 'twitter','telegram','discord'
 * @param {object} data
 */
export async function upsertSocial(wallet, provider, data) {
  const row = await db.get('SELECT socials FROM users WHERE wallet = ?', wallet);
  let socials = {};
  try { if (row?.socials) socials = JSON.parse(row.socials); } catch {}
  socials[provider] = { ...(socials[provider] || {}), ...data, connected: true };
  await db.run('UPDATE users SET socials=? WHERE wallet=?', JSON.stringify(socials), wallet);
}

export default upsertSocial;
