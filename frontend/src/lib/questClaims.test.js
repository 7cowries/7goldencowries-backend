import { isProofRequiredError, mapClaimResponseToUi } from './questClaims.js';

describe('questClaims helpers', () => {
  test('maps proof-required error to gated state', () => {
    const state = mapClaimResponseToUi({ ok: false, error: 'proof-required' });
    expect(state.status).toBe('gated');
    expect(state.shouldOpenProof).toBe(true);
    expect(typeof state.tooltip).toBe('string');
    expect(state.tooltip).toContain('proof');
  });

  test('supports legacy proof_required errors', () => {
    const state = mapClaimResponseToUi({ ok: false, error: 'proof_required' });
    expect(state.status).toBe('gated');
    expect(isProofRequiredError('proof_required')).toBe(true);
  });
});
