import { useEffect, useMemo, useState } from 'react';
import ReduceMotionToggle from '../components/ReduceMotionToggle';
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
        questHistory: apiMe?.questHistory ?? [],
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

  const progressPercent = `${(me.levelProgress * 100).toFixed(1)}%`;
  const hasQuestHistory = useMemo(() => (me.questHistory || []).length > 0, [me.questHistory]);
  const hasSocials = useMemo(
    () =>
      Boolean(
        me.socials?.twitter?.connected || me.socials?.telegram?.connected || me.socials?.discord?.connected
      ),
    [me.socials]
  );

  if (!loaded) {
    return <div className="skeleton">Loading…</div>;
  }

  if (!me.wallet) {
    return (
      <div className="profile-page">
        <h1>Profile</h1>
        <p className="empty-state">Connect your wallet to personalize your profile and keep your XP in sync.</p>
        <button type="button" onClick={() => window.dispatchEvent(new Event('wallet:connect'))}>
          Connect wallet
        </button>
      </div>
    );
  }

  const totalXpLabel = me.totalXP.toLocaleString();
  const levelXpLabel = me.xp.toLocaleString();
  const nextXpLabel = me.nextXP > 0 ? me.nextXP.toLocaleString() : '∞';

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div>
          <h1>Profile</h1>
          <p className="page-subtitle">Keep track of your XP, socials, and referrals.</p>
        </div>
        <ReduceMotionToggle />
      </header>

      <section className="profile-summary">
        <h2>Progress</h2>
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
      </section>

      <section className="profile-referrals">
        <h2>Referrals</h2>
        {me.referralCount > 0 ? (
          <p>You have invited {me.referralCount} friend(s). Keep sharing to climb the leaderboard.</p>
        ) : (
          <p className="empty-state">No referral activity yet. Share your code from the Referrals page.</p>
        )}
      </section>

      <section className="profile-socials">
        <h2>Social connections</h2>
        {hasSocials ? (
          <ul>
            <li>Twitter: {me.twitterHandle ?? 'N/A'}</li>
            <li>Telegram: {me.telegramHandle ?? 'N/A'}</li>
            <li>Discord: {me.discordId ?? 'N/A'}</li>
          </ul>
        ) : (
          <p className="empty-state">Link Twitter, Telegram, or Discord to unlock gated quests.</p>
        )}
      </section>

      <section className="profile-history">
        <h2>Quest history</h2>
        {hasQuestHistory ? (
          <ul>
            {me.questHistory.map((q, idx) => (
              <li key={q?.id ?? idx}>{q?.title ?? 'Quest'} — {q?.status ?? 'Complete'}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No quest activity yet. Visit the Quests page to start earning XP.</p>
        )}
      </section>
    </div>
  );
}
