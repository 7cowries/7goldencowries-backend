import { deriveLevel } from '../config/progression.js';

describe('deriveLevel', () => {
  test('handles low or negative xp as Shellborn', () => {
    const lvl = deriveLevel(-5);
    expect(lvl.levelName).toBe('Shellborn');
    expect(lvl.level).toBe(1);
    expect(lvl.levelSymbol).toBe('🐚');
    expect(lvl.progress).toBe(0);
    expect(lvl.nextNeed).toBe(100);
  });

  test('caps at max xp', () => {
    const lvl = deriveLevel(300000);
    expect(lvl.levelName).toBe('Cowrie Ascendant');
    expect(lvl.level).toBe(7);
    expect(lvl.levelSymbol).toBe('🌅');
    expect(lvl.progress).toBe(1);
    expect(lvl.nextNeed).toBeNull();
  });

  test('reports remaining xp to the next level', () => {
    const lvl = deriveLevel(250);
    expect(lvl.level).toBe(2);
    expect(lvl.nextNeed).toBe(150);
  });
});
