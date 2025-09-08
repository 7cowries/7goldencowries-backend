import { inferVendor } from '../utils/vendor.js';

describe('vendor inference', () => {
  test('detects twitter', () => {
    expect(inferVendor('https://twitter.com/A/status/1')).toBe('twitter');
    expect(inferVendor('https://x.com/A/status/1')).toBe('twitter');
  });

  test('detects telegram', () => {
    expect(inferVendor('https://t.me/test')).toBe('telegram');
  });

  test('detects discord', () => {
    expect(inferVendor('https://discord.gg/abc')).toBe('discord');
    expect(inferVendor('https://discord.com/invite/abc')).toBe('discord');
  });

  test('falls back to link', () => {
    expect(inferVendor('https://example.com')).toBe('link');
  });
});
