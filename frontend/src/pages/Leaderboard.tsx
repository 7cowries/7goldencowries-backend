import { useEffect, useState } from 'react';
import { ApiError, fetchJson } from '../lib/api.js';

type LeaderboardEntry = {
  rank: number;
  wallet: string;
  totalXP: number;
  progress: number;
  levelTier?: string;
  twitterHandle?: string | null;
};

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      try {
        const payload = await fetchJson('/api/leaderboard');
        if (!cancelled) {
          setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
        }
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 401
            ? 'Log in to see the leaderboard.'
            : 'Unable to load the leaderboard.';
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="leaderboard-page">
      <h1>Leaderboard</h1>
      <p className="page-subtitle">
        Track who is earning the most XP across quests and referrals.
      </p>
      {error && <p className="error">{error}</p>}
      {loading && <p>Loading leaderboard…</p>}
      {!loading && entries.length === 0 && !error && (
        <div className="empty-state">
          <h2>No scores yet</h2>
          <p>
            Once players start completing quests, their wallets will appear here with
            ranks and XP totals. Claim your first quest to set the pace.
          </p>
        </div>
      )}
      {!loading && entries.length > 0 && (
        <ol className="leaderboard-list">
          {entries.map((entry) => (
            <li key={entry.wallet}>
              <div className="leaderboard-rank">#{entry.rank}</div>
              <div className="leaderboard-wallet">{entry.wallet}</div>
              <div className="leaderboard-meta">
                <span className="xp">{entry.totalXP.toLocaleString()} XP</span>
                <span className="tier">{entry.levelTier || 'Adventurer'}</span>
                {typeof entry.progress === 'number' && (
                  <span className="progress">{Math.round(entry.progress * 100)}% to next</span>
                )}
                {entry.twitterHandle && (
                  <span className="social">@{entry.twitterHandle}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
