import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';

type SocialRecord = {
  connected: boolean;
  handle?: string;
  username?: string;
  id?: string;
};

type ProfileState = {
  wallet: string | null;
  authed: boolean;
  totalXP: number;
  xp: number;
  nextXP: number;
  levelName: string;
  levelSymbol: string;
  levelTier: string;
  levelProgress: number;
  tier: string;
  twitterHandle: string | null;
  telegramHandle: string | null;
  discordId: string | null;
  socials: {
    twitter: SocialRecord;
    telegram: SocialRecord;
    discord: SocialRecord;
  };
  questHistory: any[];
  referralCount: number;
};

const DEFAULT_ME: ProfileState = {
  wallet: null,
  authed: false,
  totalXP: 0,
  xp: 0,
  nextXP: 10000,
  levelName: 'Shellborn',
  levelSymbol: '🐚',
  levelTier: 'shellborn',
  levelProgress: 0,
  tier: 'Free',
  twitterHandle: null,
  telegramHandle: null,
  discordId: null,
  socials: {
    twitter: { connected: false },
    telegram: { connected: false },
    discord: { connected: false },
  },
  questHistory: [],
  referralCount: 0,
};

export default function Profile() {
  const [me, setMe] = useState<ProfileState>(DEFAULT_ME);
  const [loaded, setLoaded] = useState(false);

  async function loadMe() {
    try {
      const apiMe = await fetchJson('/api/users/me');
      setMe({
        ...DEFAULT_ME,
        ...apiMe,
        socials: {
          ...DEFAULT_ME.socials,
          ...(apiMe?.socials ?? {}),
        },
      });
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

  const totalXpLabel = me.totalXP.toLocaleString();
  const levelXpLabel = me.xp.toLocaleString();
  const nextXpLabel = me.nextXP > 0 ? me.nextXP.toLocaleString() : '∞';
  const progressPercent = `${(me.levelProgress * 100).toFixed(1)}%`;

  return (
    <div>
      <h1>Profile</h1>
      <p>Wallet: {me.wallet}</p>
      <p>Authed: {me.authed ? 'Yes' : 'No'}</p>
      <p>Total XP: {totalXpLabel}</p>
      <p>
        Level XP: {levelXpLabel} / {nextXpLabel}
      </p>
      <p>
        Level: {me.levelSymbol} {me.levelName} ({me.levelTier})
      </p>
      <p>Progress: {progressPercent}</p>
      <p>Tier: {me.tier}</p>
      <p>Referral Count: {me.referralCount}</p>
      <p>Twitter: {me.twitterHandle ?? 'N/A'}</p>
      <p>Telegram: {me.telegramHandle ?? 'N/A'}</p>
      <p>Discord: {me.discordId ?? 'N/A'}</p>
    </div>
  );
}
