const COMMENT_PREFIX = '7GC-SUB:';
const DEFAULT_SUBSCRIPTION_TIER = 'Tier 1';

export async function executePaywallPayment({
  tonConnectUI,
  receiver,
  minTon,
  fetcher,
  walletAddress,
  subscriptionTier = DEFAULT_SUBSCRIPTION_TIER,
  onProfileUpdated,
  onToast,
  now = () => Date.now(),
}) {
  if (!tonConnectUI) {
    onToast?.('Connect a TON wallet to continue.');
    return false;
  }
  try {
    const timestamp = now();
    const comment = `${COMMENT_PREFIX}${timestamp}`;
    const validUntil = Math.floor((timestamp + 2 * 60 * 1000) / 1000);
    const amountNano = Math.max(minTon, 0) * 1e9;
    const result = await tonConnectUI.sendTransaction({
      validUntil,
      messages: [
        {
          address: receiver,
          amount: Math.round(amountNano).toString(),
          stateInit: undefined,
          payload: undefined,
          comment,
        },
      ],
    });
    const txHash = result?.txHash || result?.hash || result?.boc;
    if (!txHash) {
      onToast?.('Payment cancelled.');
      return false;
    }
    const payload = await fetcher('/api/v1/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txHash,
        amount: minTon,
        to: receiver,
        comment,
        tier: subscriptionTier,
      }),
    });
    if (payload?.verified) {
      const subscribePayload = { tier: subscriptionTier };
      if (walletAddress) {
        subscribePayload.wallet = walletAddress;
      }
      try {
        await fetcher('/api/v1/subscription/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscribePayload),
        });
      } catch (subscribeErr) {
        console.warn('subscription subscribe failed', subscribeErr);
      }
      onProfileUpdated?.();
      onToast?.('Payment verified 🎉');
      return true;
    }
    onToast?.('Verification failed. Please try again.');
    return false;
  } catch (err) {
    console.error('payment flow failed', err);
    onToast?.('Payment cancelled.');
    return false;
  }
}

export default { executePaywallPayment };
