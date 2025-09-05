import { deriveLevel } from '../config/progression.js';

describe('deriveLevel', () => {
  test('handles negative xp', () => {
    const lvl = deriveLevel(-5);
    expect(lvl.levelName).toBe('Unranked');
    expect(lvl.progress).toBe(0);
  });

  test('caps at max xp', () => {
    const lvl = deriveLevel(300000);
    expect(lvl.levelName).toBe('Cowrie Ascendant');
    expect(lvl.progress).toBe(1);
  });
});
