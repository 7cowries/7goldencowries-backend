import { jest } from '@jest/globals';

describe('fetchJson', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('uses configured base URL for relative paths', async () => {
    process.env.REACT_APP_API_URL = 'https://api.example.com/v1';
    const { fetchJson } = await import('../lib/api.js');
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    await fetchJson('/status');
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/status', expect.any(Object));
  });

  it('deduplicates inflight requests with identical payloads', async () => {
    process.env.REACT_APP_API_URL = '';
    const { fetchJson } = await import('../lib/api.js');

    let resolve;
    const responsePromise = new Promise((res) => {
      resolve = () =>
        res({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true }),
        });
    });

    fetch.mockReturnValue(responsePromise);

    const req1 = fetchJson('/me', { method: 'GET' });
    const req2 = fetchJson('/me', { method: 'GET' });
    expect(fetch).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all([req1, req2]);
  });
});
