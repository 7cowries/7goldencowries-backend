import db from '../db.js';

// 🐦 Get Twitter handle by wallet from users table
export function getTwitterHandleByWallet(wallet) {
  const row = db.prepare(`SELECT twitterHandle FROM users WHERE wallet = ?`).get(wallet);
  return row?.twitterHandle || null;
}

// ⚔️ XP multiplier by subscription tier
export function getXpMultiplier(tier) {
  switch (tier) {
    case 'Tier 3': return 2.0;
    case 'Tier 2': return 1.5;
    case 'Tier 1': return 1.2;
    default: return 1.0;
  }
}

// 🧭 Level info based on XP
export function getLevelInfo(xp) {
  const levels = [
    { xp: 0, name: 'Shell of Curiosity', symbol: '🐚' },
    { xp: 100, name: 'Wisdom', symbol: '🧭' },
    { xp: 250, name: 'Courage', symbol: '🛡' },
    { xp: 500, name: 'Integrity', symbol: '⚖' },
    { xp: 1000, name: 'Creativity', symbol: '🎨' },
    { xp: 2000, name: 'Compassion', symbol: '❤️' },
    { xp: 4000, name: 'Resilience', symbol: '🔱' },
    { xp: 7000, name: 'Vision', symbol: '👁' }
  ];

  let current = levels[0];
  for (let lvl of levels) {
    if (xp >= lvl.xp) {
      current = lvl;
    } else {
      break;
    }
  }

  const nextLevel = levels.find(l => l.xp > current.xp);
  const progress = nextLevel ? (xp - current.xp) / (nextLevel.xp - current.xp) : 1;

  return {
    name: current.name,
    symbol: current.symbol,
    progress: Math.min(progress, 1),
    nextXP: nextLevel?.xp || null
  };
}
