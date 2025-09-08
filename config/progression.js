export const MAX_XP = 250000;

export const LEVELS = [
  { id: 1, key: "Shellborn",        need: 10000 },
  { id: 2, key: "Wave Seeker",      need: 30000 },
  { id: 3, key: "Tide Whisperer",   need: 60000 },
  { id: 4, key: "Current Binder",   need: 100000 },
  { id: 5, key: "Pearl Bearer",     need: 150000 },
  { id: 6, key: "Isle Champion",    need: 200000 },
  { id: 7, key: "Cowrie Ascendant", need: 250000 },
];

export function deriveLevel(total = 0) {
  const xpTotal = Math.max(0, Number(total) || 0);

  // Below first threshold: still considered first level
  if (xpTotal < LEVELS[0].need) {
    const nextNeed = LEVELS[0].need;
    return {
      levelName: LEVELS[0].key,
      levelIndex: LEVELS[0].id,
      prevNeed: 0,
      nextNeed,
      progress: Math.min(xpTotal / nextNeed, 1),
      xpTotal,
      maxXP: MAX_XP,
    };
  }

  // Find first level whose requirement exceeds current XP
  let idx = 1;
  for (; idx < LEVELS.length; idx++) {
    if (xpTotal < LEVELS[idx].need) break;
  }

  const current = LEVELS[idx - 1];
  const next = LEVELS[idx];
  const prevNeed = current.need;
  const nextNeed = next ? next.need : MAX_XP;
  const denom = nextNeed - prevNeed;
  const progress = denom > 0
    ? Math.max(0, Math.min((xpTotal - prevNeed) / denom, 1))
    : 1;

  return {
    levelName: current.key,
    levelIndex: current.id,
    prevNeed,
    nextNeed,
    progress,
    xpTotal,
    maxXP: MAX_XP,
  };
}
