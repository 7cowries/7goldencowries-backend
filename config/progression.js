const LEVELS = [
  { level: 1, name: "Shellborn", symbol: "🐚", min: 0 },
  { level: 2, name: "Wave Seeker", symbol: "🌊", min: 100 },
  { level: 3, name: "Tide Whisperer", symbol: "🌀", min: 400 },
  { level: 4, name: "Current Binder", symbol: "🪢", min: 1000 },
  { level: 5, name: "Pearl Bearer", symbol: "🦪", min: 2000 },
  { level: 6, name: "Isle Champion", symbol: "🏝️", min: 3500 },
  { level: 7, name: "Cowrie Ascendant", symbol: "🌅", min: 6000 },
];

export const MAX_XP = LEVELS[LEVELS.length - 1].min;

export function deriveLevel(totalXP) {
  const xp = Math.max(0, Number(totalXP) || 0);
  let index = LEVELS.length - 1;
  for (let idx = 0; idx < LEVELS.length; idx += 1) {
    const next = LEVELS[idx + 1];
    if (!next || xp < next.min) {
      index = idx;
      break;
    }
  }

  const current = LEVELS[index];
  const next = LEVELS[index + 1] || null;
  const span = next ? next.min - current.min : 1;
  const into = xp - current.min;
  const progress = next ? Math.min(1, Math.max(0, into / span)) : 1;
  const nextNeed = next ? next.min - current.min : into || 1;

  return {
    level: current.level ?? index + 1,
    levelName: current.name,
    levelSymbol: current.symbol,
    progress,
    nextNeed,
    nextLevelAt: next ? next.min : null,
  };
}

export { LEVELS };

export default { deriveLevel, LEVELS, MAX_XP };
