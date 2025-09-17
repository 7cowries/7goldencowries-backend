import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';
import PaywallButton from './PaywallButton.jsx';

export default function PaymentGuard({ children }) {
  const [status, setStatus] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchJson('/api/v1/payments/status');
      setStatus({ paid: Boolean(response?.paid) });
    } catch (err) {
      console.error('payments status failed', err);
      setStatus({ paid: false });
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const handler = () => {
      loadStatus();
    };
    window.addEventListener('profile-updated', handler);
    return () => {
      window.removeEventListener('profile-updated', handler);
    };
  }, [loadStatus]);

  if (!status) {
    return <div className="skeleton">Checking subscription…</div>;
  }

  if (!status.paid) {
    return <PaywallButton onSuccess={loadStatus} />;
  }

  return <>{children}</>;
}
