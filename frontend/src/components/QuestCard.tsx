import React from 'react';
import type { ClaimUiState } from '../lib/questClaims.js';
import { getInitialClaimUiState } from '../lib/questClaims.js';

export interface Quest {
  id: number;
  title: string;
  url?: string;
  xp: number;
  category?: string;
  requirement?: string | null;
  proofStatus?: string | null;
}

interface Props {
  quest: Quest;
  onSubmitProof?: (quest: Quest) => void;
  onClaim?: (quest: Quest) => void;
  claimState?: ClaimUiState;
}

const QuestCard: React.FC<Props> = ({ quest, onSubmitProof, onClaim, claimState }) => {
  const state: ClaimUiState = claimState || getInitialClaimUiState();
  const claimDisabled =
    state.status === 'loading' || state.status === 'gated' || state.status === 'claimed';
  const claimTooltip =
    state.status === 'gated'
      ? state.tooltip || 'Submit a proof to unlock this quest.'
      : state.status === 'error'
      ? state.tooltip || undefined
      : undefined;
  const claimLabel =
    state.status === 'claimed'
      ? 'Claimed'
      : state.status === 'loading'
      ? 'Claiming…'
      : 'Claim';
  const claimClassNames = ['claim-btn'];
  if (state.status === 'gated') claimClassNames.push('claim-btn--gated');
  if (state.status === 'claimed') claimClassNames.push('claim-btn--claimed');

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
      <button
        className={claimClassNames.join(' ')}
        onClick={() => onClaim && onClaim(quest)}
        disabled={claimDisabled}
        title={claimTooltip}
        aria-disabled={claimDisabled}
        data-claim-status={state.status}
      >
        {claimLabel}
      </button>
      <button onClick={() => onSubmitProof && onSubmitProof(quest)}>
        Submit proof
      </button>
    </div>
  );
};

export default QuestCard;
