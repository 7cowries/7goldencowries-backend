const LEVELS = [
  { xp:     0, name: 'Shellborn',        symbol: '🐚' },
  { xp: 10000, name: 'Wave Seeker',      symbol: '🌊' },
  { xp: 30000, name: 'Tide Whisperer',   symbol: '🌀' },
  { xp: 60000, name: 'Current Binder',   symbol: '🔗' },
  { xp: 100000, name: 'Pearl Bearer',     symbol: '🦪' },
  { xp: 170000, name: 'Isle Champion',    symbol: '🏝️' },
  { xp: 250000, name: 'Cowrie Ascendant', symbol: '✨' } // Final mythical level
];

export function getLevelInfo(xp = 0) {
  let current = LEVELS[0];

  for (const level of LEVELS) {
    if (xp >= level.xp) current = level;
    else break;
  }

  const index = LEVELS.indexOf(current);
  const next = LEVELS[index + 1] || null;
  const baseXP = current.xp;
  const progress = next ? (xp - baseXP) / (next.xp - baseXP) : 1;

  return {
    level: index + 1,
    name: current.name,
    symbol: current.symbol,
    progress: Math.min(progress, 1),
    nextXP: next ? next.xp : null
  };
}
