import { deriveLevel, LEVELS } from '../config/progression.js';

describe('deriveLevel', () => {
  test('handles low or negative xp as Shellborn', () => {
    const lvl = deriveLevel(-5);
    expect(lvl.levelName).toBe('Shellborn');
    expect(lvl.levelTier).toBe('shellborn');
    expect(lvl.progress).toBe(0);
    expect(lvl.xpIntoLevel).toBe(0);
    expect(lvl.nextNeed).toBe(10000);
  });

  test('transitions tiers at defined thresholds', () => {
    LEVELS.forEach((tier, index) => {
      if (index === 0) return;
      const prev = deriveLevel(tier.min - 1);
      const cur = deriveLevel(tier.min);
      expect(cur.levelTier).toBe(tier.key);
      expect(cur.levelName).toBe(tier.name);
      expect(cur.xpIntoLevel).toBe(0);
      if (index === LEVELS.length - 1) {
        expect(cur.progress).toBe(1);
      } else {
        expect(cur.progress).toBe(0);
      }
      expect(prev.levelTier === tier.key).toBe(false);
    });
  });

  test('caps progress at the top tier', () => {
    const lvl = deriveLevel(300000);
    expect(lvl.levelName).toBe('Cowrie Ascendant');
    expect(lvl.progress).toBe(1);
    expect(lvl.nextNeed).toBeGreaterThan(0);
    expect(lvl.totalXP).toBe(300000);
  });
});
