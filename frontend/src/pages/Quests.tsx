import React, { useEffect, useState } from 'react';
import QuestCard, { Quest } from '../components/QuestCard';

const categories = ['All', 'Daily', 'Social', 'Partner', 'Insider', 'Onchain'];

const QuestsPage: React.FC = () => {
  const [wallet, setWallet] = useState('');
  const [quests, setQuests] = useState<Quest[]>([]);
  const [tab, setTab] = useState('All');
  const [error, setError] = useState('');

  useEffect(() => {
    setWallet(localStorage.getItem('wallet') || '');
    const onWalletChanged = () => setWallet(localStorage.getItem('wallet') || '');
    window.addEventListener('wallet-changed', onWalletChanged);
    return () => window.removeEventListener('wallet-changed', onWalletChanged);
  }, []);

  const API_URL = process.env.REACT_APP_API_URL || '';
  useEffect(() => {
    fetch(`${API_URL}/api/quests`)
      .then((r) => r.json())
      .then((data) => {
        const qs = Array.isArray(data) ? data : data.quests || [];
        setQuests(qs);
      })
      .catch(() => setError('Failed to load quests'));
  }, [API_URL]);

  const filtered = quests.filter((q) =>
    tab === 'All' ? true : (q.category || 'All') === tab
  );

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
        {error ? (
          <p className="error">{error}</p>
        ) : filtered.length ? (
          filtered.map((q) => <QuestCard key={q.id} quest={q} />)
        ) : (
          <p>No quests yet</p>
        )}
      </div>
    </div>
  );
};

export default QuestsPage;
