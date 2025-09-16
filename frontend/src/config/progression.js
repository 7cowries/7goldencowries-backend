export const LEVELS = [
  { key: 'shellborn',        name: 'Shellborn',        emoji: '🐚', min: 0 },
  { key: 'wave-seeker',      name: 'Wave Seeker',      emoji: '🌊', min: 10000 },
  { key: 'tide-whisperer',   name: 'Tide Whisperer',   emoji: '🌀', min: 30000 },
  { key: 'current-binder',   name: 'Current Binder',   emoji: '🪙', min: 60000 },
  { key: 'pearl-bearer',     name: 'Pearl Bearer',     emoji: '🫧', min: 100000 },
  { key: 'isle-champion',    name: 'Isle Champion',    emoji: '🏝️', min: 160000 },
  { key: 'cowrie-ascendant', name: 'Cowrie Ascendant', emoji: '👑', min: 250000 },
];

export const levelBadgeSrc = (levelName) => {
  const base = String(levelName || 'Shellborn').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `/images/badges/level-${base}.png`;
};
