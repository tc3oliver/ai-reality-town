/**
 * The durable record of what Canon validation decided about each Proposed Event (ART-90).
 *
 * Two pure decisions live in this module, and the rejection rate is wrong in a different way if
 * either is:
 *
 *  - {@link proposalSceneId} attributes a verdict to the scene that proposed it. A proposal whose
 *    scene cannot be named is still counted, but it can no longer be traced back, so the fallback
 *    and the `null` case are both asserted rather than assumed;
 *  - {@link reconcileValidationOutcome} decides whether a re-recorded verdict is the SAME verdict.
 *    A retried slot re-derives every key and re-records every verdict, so treating agreement as a
 *    conflict would fail ordinary retries, and treating disagreement as agreement would silently
 *    overwrite the more interesting of two verdicts.
 *
 * Every failure case asserts the stable `code`, never the message: the message is prose for an
 * operator and is free to change, and a test that pins it would fail on a rewording while a test
 * that pins the code fails only on a behaviour change.
 */

import {
  ValidationOutcomeError,
  VALIDATION_OUTCOMES,
  VALIDATION_STAGES,
  proposalSceneId,
  reconcileValidationOutcome,
} from './validationOutcome';

/** Run `fn` and return the error it threw, so a case can assert on the code rather than the text. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, and it returned');
}

describe('ART-90 validationOutcome: the stage and outcome vocabularies', () => {
  it('names exactly the two gates and the two verdicts the rate divides by', () => {
    expect(VALIDATION_STAGES).toEqual(['structural', 'canon']);
    expect(VALIDATION_OUTCOMES).toEqual(['accepted', 'rejected']);
  });
});

describe('ART-90 proposalSceneId: attributing a verdict to the scene that proposed it', () => {
  it('prefers the sceneId the proposal stamped into its metadata', () => {
    expect(proposalSceneId({
      idempotencyKey: 'group-1:scene:9:event:1',
      metadata: { sceneId: 'group-1:scene:1' },
    })).toBe('group-1:scene:1');
  });

  it('falls back to the idempotency key prefix when there is no metadata to read', () => {
    expect(proposalSceneId({ idempotencyKey: 'group-1:scene:1:event:1' })).toBe('group-1:scene:1');
    expect(proposalSceneId({ idempotencyKey: 'group-1:scene:1:event:2', metadata: {} }))
      .toBe('group-1:scene:1');
    // Only the FIRST `:event:` splits the key, so a scene id that contains the marker is not
    // truncated at the wrong boundary.
    expect(proposalSceneId({ idempotencyKey: 'group-1:scene:1:event:1:event:2' }))
      .toBe('group-1:scene:1');
  });

  it('falls back when the metadata sceneId is present but is not a usable string', () => {
    expect(proposalSceneId({ idempotencyKey: 'group-1:scene:1:event:1', metadata: { sceneId: '' } }))
      .toBe('group-1:scene:1');
    expect(proposalSceneId({ idempotencyKey: 'group-1:scene:1:event:1', metadata: { sceneId: 42 } }))
      .toBe('group-1:scene:1');
    expect(proposalSceneId({ idempotencyKey: 'group-1:scene:1:event:1', metadata: { sceneId: null } }))
      .toBe('group-1:scene:1');
  });

  it('returns null when neither a metadata sceneId nor a key prefix names a scene', () => {
    // No `:event:` marker at all: the whole key is the prefix, which names no scene.
    expect(proposalSceneId({ idempotencyKey: 'remediation:retcon:evt-1' })).toBeNull();
    expect(proposalSceneId({ idempotencyKey: 'remediation:retcon:evt-1', metadata: { origin: 'operator' } }))
      .toBeNull();
    // A key that BEGINS with the marker has an empty prefix, which is not a scene id either.
    expect(proposalSceneId({ idempotencyKey: ':event:1' })).toBeNull();
    expect(proposalSceneId({ idempotencyKey: '' })).toBeNull();
  });
});

describe('ART-90 reconcileValidationOutcome: a retry re-records, it does not re-decide', () => {
  const stored = (overrides: Partial<{ outcome: string; errorCode: string | null }> = {}) => ({
    idempotencyKey: 'group-1:scene:1:event:1',
    stage: 'canon',
    outcome: 'rejected',
    errorCode: 'TELEPORTATION_NOT_ALLOWED',
    ...overrides,
  });

  it('deduplicates when the retry re-derived the verdict already stored', () => {
    expect(reconcileValidationOutcome(stored(), {
      outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED',
    })).toEqual({ deduplicated: true });

    // An acceptance carries no code, and two nulls agree.
    expect(reconcileValidationOutcome(
      stored({ outcome: 'accepted', errorCode: null }),
      { outcome: 'accepted', errorCode: null },
    )).toEqual({ deduplicated: true });
  });

  it('refuses a retry that reached a different OUTCOME for the same proposal', () => {
    const error = thrownBy(() => reconcileValidationOutcome(stored(), {
      outcome: 'accepted', errorCode: null,
    }));
    expect(error).toBeInstanceOf(ValidationOutcomeError);
    expect((error as ValidationOutcomeError).code).toBe('VALIDATION_OUTCOME_CONFLICT');

    const reversed = thrownBy(() => reconcileValidationOutcome(
      stored({ outcome: 'accepted', errorCode: null }),
      { outcome: 'rejected', errorCode: 'UNKNOWN_LOCATION_REFERENCE' },
    ));
    expect((reversed as ValidationOutcomeError).code).toBe('VALIDATION_OUTCOME_CONFLICT');
  });

  it('refuses a retry that reached the same outcome for a different REASON', () => {
    const error = thrownBy(() => reconcileValidationOutcome(stored(), {
      outcome: 'rejected', errorCode: 'UNKNOWN_LOCATION_REFERENCE',
    }));
    expect(error).toBeInstanceOf(ValidationOutcomeError);
    expect((error as ValidationOutcomeError).code).toBe('VALIDATION_OUTCOME_CONFLICT');

    // A rejection that acquired a code, or lost one, is the same kind of conflict.
    expect((thrownBy(() => reconcileValidationOutcome(
      stored({ errorCode: null }), { outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED' },
    )) as ValidationOutcomeError).code).toBe('VALIDATION_OUTCOME_CONFLICT');
  });

  it('carries no proposal content into the conflict it reports', () => {
    const error = thrownBy(() => reconcileValidationOutcome(stored(), {
      outcome: 'accepted', errorCode: null,
    })) as ValidationOutcomeError;

    expect(error.name).toBe('ValidationOutcomeError');
    // The key and the stage are identifiers, and they are all an operator is given.
    expect(error.message).toContain('group-1:scene:1:event:1');
    expect(error.message).toContain('canon');
  });
});
