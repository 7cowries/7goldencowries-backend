import { useCallback, useMemo, useState } from 'react';
import {
  TonConnectButton,
  useTonConnectUI,
  useTonWallet,
} from '@tonconnect/ui-react';
import { fetchJson } from '../lib/api';
import { executePaywallPayment } from '../lib/paywall.js';

const RECEIVE_ADDRESS =
  process.env.REACT_APP_TON_RECEIVE_ADDRESS || 'EQ_PLACEHOLDER_RECEIVER';
const MIN_TON = Number(
  process.env.REACT_APP_TON_MIN_PAYMENT_TON ||
    process.env.REACT_APP_TON_MIN_TON ||
    '0'
);

function showToast(message) {
  if (typeof window !== 'undefined') {
    const maybeToast = window.toast;
    if (typeof maybeToast === 'function') {
      maybeToast(message);
      return;
    }
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message } }));
    }
  }
  // eslint-disable-next-line no-console
  console.log('[toast]', message);
}

function useSafeTonConnectUI() {
  try {
    return useTonConnectUI();
  } catch (err) {
    return [null, () => {}];
  }
}

function useSafeTonWallet() {
  try {
    return useTonWallet();
  } catch (err) {
    return null;
  }
}

export default function PaywallButton({ onSuccess }) {
  const [tonConnectUI] = useSafeTonConnectUI();
  const wallet = useSafeTonWallet();
  const [submitting, setSubmitting] = useState(false);

  const receiver = useMemo(() => RECEIVE_ADDRESS, []);

  const handlePayment = useCallback(async () => {
    if (!tonConnectUI) {
      showToast('Connect a TON wallet to continue.');
      return;
    }
    try {
      setSubmitting(true);
      await executePaywallPayment({
        tonConnectUI,
        receiver,
        minTon: MIN_TON,
        fetcher: fetchJson,
        onProfileUpdated: () => {
          window.dispatchEvent(new Event('profile-updated'));
          onSuccess?.();
        },
        onToast: showToast,
      });
    } catch (err) {
      console.error('ton transfer cancelled', err);
      showToast('Payment cancelled.');
    } finally {
      setSubmitting(false);
    }
  }, [receiver, onSuccess, tonConnectUI]);

  return (
    <div className="paywall">
      <TonConnectButton className="ton-connect-button" />
      <button onClick={handlePayment} disabled={!wallet || submitting}>
        {submitting ? 'Processing…' : 'Unlock with TON'}
      </button>
    </div>
  );
}
