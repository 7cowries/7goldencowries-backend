import { jest } from '@jest/globals';
import { executePaywallPayment } from '../lib/paywall.js';

describe('executePaywallPayment', () => {
  it('verifies payment and emits profile update once', async () => {
    const sendTransaction = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    const fetcher = jest.fn().mockResolvedValue({ verified: true });
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

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
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
    });
    expect(body.comment).toMatch(/^7GC-SUB:/);
    expect(onProfileUpdated).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith('Payment verified 🎉');
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
