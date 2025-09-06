import { normalizeTweetUrl, proofToken, extractTweetTextFromHtml } from '../lib/proof.js';

describe('proof helpers', () => {
  test('normalize tweet url', () => {
    const r = normalizeTweetUrl('https://twitter.com/Alice/status/123?utm=1');
    expect(r).toEqual({ url: 'https://x.com/Alice/status/123', handle: 'Alice', tweetId: '123' });
    expect(() => normalizeTweetUrl('https://example.com')).toThrow();
    expect(() => normalizeTweetUrl('https://x.com/abc/')).toThrow();
  });

  test('proof token stable', () => {
    process.env.PROOF_SECRET = 's';
    const t1 = proofToken('w', 1);
    const t2 = proofToken('w', 1);
    expect(t1).toHaveLength(10);
    expect(t1).toBe(t2);
  });

  test('extract tweet text', () => {
    const html = '<p>Hello &amp; world</p><div>more\ntext</div>';
    const txt = extractTweetTextFromHtml(html);
    expect(txt).toBe('Hello & world more text');
  });
});
