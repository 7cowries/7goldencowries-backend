import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../lib/api';

const DEFAULT_STATUS = {
  tier: 'Free',
  subscriptionTier: 'Free',
  paid: false,
  canClaim: false,
  bonusXp: 0,
  claimedAt: null,
  lastPaymentAt: null,
};

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function Subscription() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const hydratedStatus = useMemo(() => ({
    ...DEFAULT_STATUS,
    ...(status ?? {}),
  }), [status]);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const payload = await fetchJson('/api/v1/subscription/status');
      setStatus({
        ...DEFAULT_STATUS,
        ...(payload ?? {}),
      });
    } catch (err) {
      console.error('subscription status failed', err);
      setError('Unable to load subscription status.');
      setStatus({ ...DEFAULT_STATUS });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const handleProfileUpdate = () => {
      loadStatus();
    };
    window.addEventListener('profile-updated', handleProfileUpdate);
    return () => {
      window.removeEventListener('profile-updated', handleProfileUpdate);
    };
  }, [loadStatus]);

  const handleClaim = useCallback(async () => {
    if (claiming || !hydratedStatus.canClaim) {
      return;
    }
    setClaiming(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await fetchJson('/api/v1/subscription/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (payload?.ok) {
        window.dispatchEvent(new Event('profile-updated'));
        setMessage('Subscription bonus claimed!');
        await loadStatus();
      } else {
        setError('Claim failed. Please try again.');
      }
    } catch (err) {
      console.error('subscription claim failed', err);
      setError('Claim failed. Please try again.');
    } finally {
      setClaiming(false);
    }
  }, [claiming, hydratedStatus.canClaim, loadStatus]);

  if (loading && !status) {
    return <div className="skeleton">Loading subscription…</div>;
  }

  return (
    <div className="subscription-page">
      <h1>Subscription</h1>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <dl>
        <div>
          <dt>Tier</dt>
          <dd>{hydratedStatus.subscriptionTier || hydratedStatus.tier}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{hydratedStatus.paid ? 'Active' : 'Locked'}</dd>
        </div>
        <div>
          <dt>Bonus XP</dt>
          <dd>{hydratedStatus.bonusXp?.toLocaleString?.() ?? hydratedStatus.bonusXp}</dd>
        </div>
        <div>
          <dt>Last Payment</dt>
          <dd>{formatDate(hydratedStatus.lastPaymentAt)}</dd>
        </div>
        <div>
          <dt>Claimed</dt>
          <dd>{formatDate(hydratedStatus.claimedAt)}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={handleClaim}
        disabled={!hydratedStatus.canClaim || claiming}
      >
        {claiming ? 'Claiming…' : hydratedStatus.canClaim ? 'Claim bonus' : 'Already claimed'}
      </button>
    </div>
  );
}
