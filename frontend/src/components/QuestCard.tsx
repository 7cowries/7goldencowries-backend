import React from 'react';

export interface Quest {
  id: number;
  title: string;
  url?: string;
  xp: number;
  category?: string;
}

interface Props {
  quest: Quest;
  onSubmitProof?: (quest: Quest) => void;
}

const QuestCard: React.FC<Props> = ({ quest, onSubmitProof }) => {
  return (
    <div className="quest-card">
      <h3>{quest.title}</h3>
      {quest.url ? (
        <a
          className="start-btn"
          href={quest.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Start
        </a>
      ) : (
        <button className="start-btn" disabled title="Coming soon">
          Start
        </button>
      )}
      <button onClick={() => onSubmitProof && onSubmitProof(quest)}>
        Submit proof
      </button>
    </div>
  );
};

export default QuestCard;
