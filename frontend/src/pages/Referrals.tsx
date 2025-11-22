import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchJson } from '../lib/api.js';

type ReferralSummary = {
  code?: string;
  invitedCount?: number;
};

export default function Referrals() {
  const [summary, setSummary] = useState<ReferralSummary>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJson('/api/referrals/me');
      setSummary({
        code: payload?.code,
        invitedCount: payload?.invitedCount ?? payload?.results?.[0]?.invitedCount ?? 0,
      });
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? 'Connect your wallet to generate a referral code.'
          : 'Unable to load referrals right now.';
      setError(message);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = async () => {
    if (!summary.code) return;
    try {
      await navigator.clipboard?.writeText?.(summary.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const inviteCount = summary.invitedCount ?? 0;

  return (
    <div className="referrals-page">
      <h1>Referrals</h1>
      <p className="page-subtitle">
        Share your code to earn XP when friends join. You keep full visibility into how many invites landed.
      </p>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading referrals…</p>}

      {!loading && !error && !summary.code && (
        <div className="empty-state">
          <h2>No referral code yet</h2>
          <p>Connect your wallet to mint a code and start inviting friends.</p>
          <button type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && summary.code && (
        <div className="referral-card">
          <dl>
            <div>
              <dt>Your code</dt>
              <dd className="referral-code">{summary.code}</dd>
            </div>
            <div>
              <dt>Invited friends</dt>
              <dd>{inviteCount}</dd>
            </div>
          </dl>
          <div className="referral-actions">
            <button type="button" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy code'}
            </button>
            <button type="button" onClick={load}>
              Refresh
            </button>
          </div>
          {inviteCount === 0 && (
            <p className="empty-state">
              Nobody has joined with your code yet. Share it with friends to climb the leaderboard together.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
