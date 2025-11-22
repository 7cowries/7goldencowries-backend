import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchJson } from '../lib/api.js';

type TokenSaleStats = {
  contributions?: number;
  totalTON?: number;
  avgTON?: number;
  recent?: Array<{ id: number; wallet: string; amountTON: number; referral?: string; memo?: string; createdAt?: string }>;
};

type ContributionForm = {
  amountTON: string;
  referral?: string;
  memo?: string;
};

export default function TokenSale() {
  const [stats, setStats] = useState<TokenSaleStats>({});
  const [loadingStats, setLoadingStats] = useState(true);
  const [form, setForm] = useState<ContributionForm>({ amountTON: '' });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const payload = await fetchJson('/token-sale/stats');
      setStats(payload || {});
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 401
        ? 'Sign in to view token sale stats.'
        : 'Unable to load token sale stats right now.';
      setError(msg);
      setStats({});
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const wallet = localStorage.getItem('wallet') || undefined;
      const payload = await fetchJson('/token-sale/contribute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, wallet, amountTON: Number(form.amountTON) }),
      });
      if (payload?.ok !== false) {
        setMessage('Contribution recorded. Thank you for supporting the sale!');
        setForm({ amountTON: '', memo: '', referral: '' });
        loadStats();
      } else {
        setError('Contribution failed. Please check your entry and try again.');
      }
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 400
        ? 'Please enter a valid TON amount.'
        : 'Unable to submit right now.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const contributionCount = stats.contributions ?? 0;
  const hasRecent = (stats.recent?.length ?? 0) > 0;

  return (
    <div className="token-sale-page">
      <h1>Token Sale</h1>
      <p className="page-subtitle">
        Contribute TON directly without pop-up overlays. Track recent contributions and totals in one place.
      </p>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="token-sale-form">
        <h2>Contribute</h2>
        <form onSubmit={handleSubmit}>
          <label>
            TON Amount
            <input
              type="number"
              min="0"
              step="0.01"
              name="amountTON"
              value={form.amountTON}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Referral (optional)
            <input
              type="text"
              name="referral"
              value={form.referral ?? ''}
              onChange={handleChange}
              placeholder="Friend's code"
            />
          </label>
          <label>
            Memo (optional)
            <textarea
              name="memo"
              value={form.memo ?? ''}
              onChange={handleChange}
              placeholder="Note for the team"
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit contribution'}
          </button>
        </form>
      </section>

      <section className="token-sale-stats">
        <h2>Stats</h2>
        {loadingStats && <p>Loading stats…</p>}
        {!loadingStats && contributionCount === 0 && !hasRecent && (
          <div className="empty-state">
            <h3>No contributions yet</h3>
            <p>Be the first to support the token sale. Your contribution will appear here instantly.</p>
          </div>
        )}
        {!loadingStats && contributionCount > 0 && (
          <dl>
            <div>
              <dt>Total TON contributed</dt>
              <dd>{stats.totalTON ?? 0}</dd>
            </div>
            <div>
              <dt>Average contribution</dt>
              <dd>{stats.avgTON ?? 0}</dd>
            </div>
            <div>
              <dt>Contributions</dt>
              <dd>{contributionCount}</dd>
            </div>
          </dl>
        )}
        {!loadingStats && hasRecent && (
          <div className="recent-contributions">
            <h3>Recent activity</h3>
            <ul>
              {stats.recent?.map((item) => (
                <li key={item.id}>
                  <div className="contribution-wallet">{item.wallet || 'Anonymous'}</div>
                  <div className="contribution-amount">{item.amountTON} TON</div>
                  {item.referral && <div className="contribution-referral">Referral: {item.referral}</div>}
                  {item.memo && <div className="contribution-memo">“{item.memo}”</div>}
                  {item.createdAt && <div className="contribution-date">{new Date(item.createdAt).toLocaleString()}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
