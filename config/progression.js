const LEVELS = [
  { name: "Shellborn", min: 0 },
  { name: "Wave Seeker", min: 100 },
  { name: "Tide Whisperer", min: 400 },
  { name: "Current Binder", min: 1000 },
  { name: "Pearl Bearer", min: 2000 },
  { name: "Isle Champion", min: 3500 },
  { name: "Cowrie Ascendant", min: 6000 },
];

export const MAX_XP = LEVELS[LEVELS.length - 1].min;

export function deriveLevel(totalXP) {
  const xp = Math.max(0, Number(totalXP) || 0);
  let i = LEVELS.length - 1;
  for (let idx = 0; idx < LEVELS.length; idx += 1) {
    const next = LEVELS[idx + 1];
    if (!next || xp < next.min) {
      i = idx;
      break;
    }
  }
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  const span = next ? next.min - cur.min : 1;
  const into = xp - cur.min;
  const progress = next ? Math.min(1, Math.max(0, into / span)) : 1;
  const nextNeed = next ? next.min - cur.min : into || 1;
  return { levelName: cur.name, progress, nextNeed };
}

export { LEVELS };

export default { deriveLevel, LEVELS, MAX_XP };
