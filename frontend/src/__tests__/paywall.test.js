import { jest } from '@jest/globals';
import { executePaywallPayment } from '../lib/paywall.js';

describe('executePaywallPayment', () => {
  it('verifies payment, attempts subscribe, and emits profile update once', async () => {
    const sendTransaction = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ verified: true })
      .mockResolvedValueOnce({ sessionUrl: 'https://checkout.example/sub' });
    const onProfileUpdated = jest.fn();
    const onToast = jest.fn();

    await executePaywallPayment({
      tonConnectUI: { sendTransaction },
      receiver: 'EQReceiver',
      minTon: 12,
      fetcher,
      walletAddress: 'EQWallet123',
      onProfileUpdated,
      onToast,
      now: () => 1700000000000,
    });

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/v1/payments/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    );
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({
      txHash: '0xabc',
      amount: 12,
      to: 'EQReceiver',
      tier: 'Tier 1',
    });
    expect(body.comment).toMatch(/^7GC-SUB:/);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/subscription/subscribe',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    );
    const subscribeBody = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(subscribeBody).toEqual({ wallet: 'EQWallet123', tier: 'Tier 1' });
    expect(onProfileUpdated).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith('Payment verified 🎉');
  });

  it('continues when subscribe fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const sendTransaction = jest.fn().mockResolvedValue({ txHash: '0xdef' });
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ verified: true })
      .mockRejectedValueOnce(new Error('subscribe failed'));
    const onProfileUpdated = jest.fn();
    const onToast = jest.fn();

    await executePaywallPayment({
      tonConnectUI: { sendTransaction },
      receiver: 'EQReceiver',
      minTon: 12,
      fetcher,
      onProfileUpdated,
      onToast,
      now: () => 1700000000000,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onProfileUpdated).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith('Payment verified 🎉');
    warnSpy.mockRestore();
  });

  it('shows cancellation toast when transaction missing', async () => {
    const sendTransaction = jest.fn().mockResolvedValue({});
    const fetcher = jest.fn();
    const onToast = jest.fn();

    const result = await executePaywallPayment({
      tonConnectUI: { sendTransaction },
      receiver: 'EQReceiver',
      minTon: 5,
      fetcher,
      onToast,
      now: () => 1700000000000,
    });

    expect(result).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith('Payment cancelled.');
  });
});
