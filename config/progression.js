export const LEVELS = [
  { key: 'shellborn',        name: 'Shellborn',        symbol: '🐚', min: 0 },
  { key: 'wave-seeker',      name: 'Wave Seeker',      symbol: '🌊', min: 10000 },
  { key: 'tide-whisperer',   name: 'Tide Whisperer',   symbol: '🌀', min: 30000 },
  { key: 'current-binder',   name: 'Current Binder',   symbol: '🪙', min: 60000 },
  { key: 'pearl-bearer',     name: 'Pearl Bearer',     symbol: '🫧', min: 100000 },
  { key: 'isle-champion',    name: 'Isle Champion',    symbol: '🏝️', min: 160000 },
  { key: 'cowrie-ascendant', name: 'Cowrie Ascendant', symbol: '👑', min: 250000 },
];

export const MAX_XP = LEVELS[LEVELS.length - 1].min;

export function deriveLevel(totalXPInput) {
  const total = Math.max(0, Number(totalXPInput) || 0);
  let i = LEVELS.length - 1;
  for (let idx = 0; idx < LEVELS.length; idx += 1) {
    const next = LEVELS[idx + 1];
    if (!next || total < next.min) {
      i = idx;
      break;
    }
  }
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  const span = next ? next.min - cur.min : 1;
  const into = total - cur.min;
  const progress = next ? Math.min(1, Math.max(0, into / span)) : 1;

  return {
    totalXP: total,
    levelName: cur.name,
    levelSymbol: cur.symbol,
    levelTier: cur.key,
    progress,
    xpIntoLevel: into,
    nextNeed: next ? span : into || 1,
  };
}

export default { LEVELS, deriveLevel, MAX_XP };
