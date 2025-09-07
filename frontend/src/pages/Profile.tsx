import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';

const DEFAULT_ME = {
  wallet: null as string | null,
  xp: 0,
  level: 'Shellborn',
  levelName: 'Shellborn',
  levelSymbol: '🐚',
  nextXP: 100,
  twitterHandle: null as string | null,
  telegramId: null as string | null,
  discordId: null as string | null,
  subscriptionTier: 'Free',
  questHistory: [] as any[],
};

export default function Profile() {
  const [me, setMe] = useState<typeof DEFAULT_ME>(DEFAULT_ME);
  const [loaded, setLoaded] = useState(false);

  async function loadMe() {
    try {
      const apiMe = await fetchJson('/api/users/me');
      setMe({ ...DEFAULT_ME, ...apiMe });
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      const wallet = localStorage.getItem('wallet');
      if (wallet) {
        try {
          await fetchJson('/api/session/bind-wallet', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ wallet }),
          });
        } catch {}
      }
      if (!cancelled) {
        await loadMe();
      }
    }
    fetchAll();
    function handleChange() {
      fetchAll();
    }
    window.addEventListener('wallet:changed', handleChange);
    return () => {
      cancelled = true;
      window.removeEventListener('wallet:changed', handleChange);
    };
  }, []);

  if (!loaded) {
    return <div className="skeleton">Loading...</div>;
  }

  if (!me.wallet) {
    return (
      <div>
        <p>Connect wallet to view your profile</p>
        <button>Connect Wallet</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Profile</h1>
      <p>Wallet: {me.wallet ?? ''}</p>
      <p>XP: {me.xp ?? 0}</p>
      <p>Level: {me.level ?? 'Shellborn'}</p>
      <p>Level Symbol: {me.levelSymbol ?? '🐚'}</p>
      <p>Next XP: {me.nextXP ?? 100}</p>
      <p>Subscription: {me.subscriptionTier ?? 'Free'}</p>
      <p>Twitter: {me.twitterHandle ?? 'N/A'}</p>
      <p>Telegram: {me.telegramId ?? 'N/A'}</p>
      <p>Discord: {me.discordId ?? 'N/A'}</p>
    </div>
  );
}
