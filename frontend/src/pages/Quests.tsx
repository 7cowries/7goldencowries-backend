import React, { useEffect, useState } from 'react';
import QuestCard, { Quest } from '../components/QuestCard';
import type { ClaimUiState } from '../lib/questClaims.js';
import { getInitialClaimUiState, mapClaimResponseToUi } from '../lib/questClaims.js';

const categories = ['All', 'Daily', 'Social', 'Partner', 'Insider', 'Onchain'];

const QuestsPage: React.FC = () => {
  const [wallet, setWallet] = useState('');
  const [quests, setQuests] = useState<Quest[]>([]);
  const [tab, setTab] = useState('All');
  const [claimStates, setClaimStates] = useState<Record<number, ClaimUiState>>({});

  useEffect(() => {
    setWallet(localStorage.getItem('wallet') || '');
    const onWalletChanged = () => setWallet(localStorage.getItem('wallet') || '');
    window.addEventListener('wallet-changed', onWalletChanged);
    return () => window.removeEventListener('wallet-changed', onWalletChanged);
  }, []);

  useEffect(() => {
    fetch('/api/quests')
      .then((r) => r.json())
      .then((data) => {
        const qs = Array.isArray(data) ? data : data.quests || [];
        setQuests(qs);
      })
      .catch(() => {});
  }, []);

  const filtered = quests.filter((q) =>
    tab === 'All' ? true : (q.category || 'All') === tab
  );

  const setClaimState = (questId: number, state: ClaimUiState) => {
    setClaimStates((prev) => ({ ...prev, [questId]: state }));
  };

  const getClaimState = (questId: number): ClaimUiState => {
    return claimStates[questId] || getInitialClaimUiState();
  };

  const handleClaim = async (quest: Quest) => {
    if (!wallet) {
      setClaimState(quest.id, {
        status: 'error',
        tooltip: 'Connect your wallet to claim quests.',
      });
      return;
    }

    setClaimState(quest.id, { status: 'loading' });

    try {
      const res = await fetch(`/api/quests/${quest.id}/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questId: quest.id }),
      });
      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      const uiState = mapClaimResponseToUi(payload);
      setClaimState(quest.id, { ...uiState, shouldOpenProof: false });
      if (uiState.shouldOpenProof) {
        window.dispatchEvent(
          new CustomEvent('quest:proof-required', {
            detail: { questId: quest.id, quest },
          })
        );
      }
    } catch (err) {
      setClaimState(quest.id, {
        status: 'error',
        tooltip: 'Unable to reach the server. Please try again.',
      });
    }
  };

  return (
    <div>
      <div className="tabs">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={tab === c ? 'active' : ''}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="quests-list">
        {filtered.length ? (
          filtered.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              onClaim={handleClaim}
              claimState={getClaimState(q.id)}
            />
          ))
        ) : (
          <p>No quests yet</p>
        )}
      </div>
    </div>
  );
};

export default QuestsPage;
