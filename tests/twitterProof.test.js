import { jest } from '@jest/globals';
import { parseTweetUrl, verifyTwitterProof } from '../lib/twitterProof.js';

describe('twitter proof helpers', () => {
  test('parses tweet URLs', () => {
    expect(parseTweetUrl('https://x.com/test/status/12345')).toEqual({ username: 'test', tweetId: '12345' });
    expect(parseTweetUrl('https://twitter.com/abc/status/999')).toEqual({ username: 'abc', tweetId: '999' });
    expect(parseTweetUrl('https://x.com/abc/')).toBeNull();
  });

  test('verifies by quote and hashtag', async () => {
    process.env.X_TARGET_TWEET_URL = 'https://x.com/7goldencowries/status/1';
    process.env.X_REQUIRED_HASHTAG = '#7GC';
    process.env.X_TARGET_HANDLE = 'tester';
    const user = { twitter_username: 'Tester' };
    const url = 'https://x.com/Tester/status/1';
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ html: `<blockquote><a href="https://x.com/7goldencowries/status/1">Quote</a> #7GC</blockquote>` })
    });
    const ok = await verifyTwitterProof({ user, quest: {}, url }, fakeFetch);
    expect(ok.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalled();
  });

  test('rejects when username mismatches', async () => {
    const user = { twitter_username: 'alice' };
    const url = 'https://x.com/bob/status/2';
    const fakeFetch = jest.fn();
    const res = await verifyTwitterProof({ user, quest: {}, url }, fakeFetch);
    expect(res.ok).toBe(false);
  });
});
