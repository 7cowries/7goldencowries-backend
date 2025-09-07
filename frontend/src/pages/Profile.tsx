import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';

const DEFAULT_ME = {
  anon: true,
  wallet: null as string | null,
  xp: 0,
  level: 1,
  levelSymbol: 'Shellborn',
  nextXP: 100,
  subscriptionTier: 'Free',
  socials: {
    twitterHandle: null as string | null,
    telegramId: null as string | null,
    discordId: null as string | null,
    discordGuildMember: false,
  },
  referral_code: null as string | null,
};

export default function Profile() {
  const [me, setMe] = useState<typeof DEFAULT_ME>(DEFAULT_ME);
  const [loaded, setLoaded] = useState(false);

  async function loadMe() {
    try {
      const apiMe = await fetchJson('/api/users/me');
      const merged = {
        ...DEFAULT_ME,
        ...apiMe,
        socials: {
          ...DEFAULT_ME.socials,
          ...(apiMe?.socials ?? {}),
        },
      };
      setMe(merged);
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
    return <div>Loading...</div>;
  }

  if (me.anon) {
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
      <p>Level: {me.level ?? 1}</p>
      <p>Level Symbol: {me.levelSymbol ?? 'Shellborn'}</p>
      <p>Next XP: {me.nextXP ?? 100}</p>
      <p>Subscription: {me.subscriptionTier ?? 'Free'}</p>
      <p>Twitter: {me.socials?.twitterHandle ?? 'N/A'}</p>
      <p>Telegram: {me.socials?.telegramId ?? 'N/A'}</p>
      <p>Discord: {me.socials?.discordId ?? 'N/A'}</p>
      <p>Referral Code: {me.referral_code ?? 'N/A'}</p>
    </div>
  );
}
