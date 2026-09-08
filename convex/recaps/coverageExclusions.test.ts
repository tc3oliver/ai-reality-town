/**
 * The operator's explicit, reviewable coverage exclusion (FR-G004 / PRD §16.2). ART-89.
 *
 * §16.2 reads 「至少 95% 的高重要度 Accepted Event 由已發布 recap 覆蓋，或帶有明確、可審查的排除理由」.
 * Every rule below is the second half of that clause, and every one of them is a REFUSAL rather
 * than a normalisation, because a stored bad exclusion has already shrunk the coverage denominator
 * by the time anyone reads it. `convex/quality/storyQuality.ts` reads these rows; its own suite
 * proves a blank reason does not shrink the denominator there. This suite proves a blank reason
 * never reaches storage in the first place.
 *
 * ART-166: this floor is also the reason the evaluator publishes no `EXCLUSION_WITHOUT_REASON`
 * finding code. `buildCoverageExclusion` is the only writer into `coverageExclusions`, and it
 * refuses anything below `MIN_EXCLUSION_REASON_LENGTH` after trimming — strictly stronger than
 * "not blank" — so no stored row could ever produce that code. The guarantee lives here, and a
 * report that claimed to detect it was claiming a check it could not perform.
 *
 * The assertions are on the error `code`, never the message. The code is what the Convex mutation
 * surfaces and what an operator UI branches on; a message is prose and may be reworded.
 */

import {
  CoverageExclusionError,
  MAX_EXCLUSION_REASON_LENGTH,
  MIN_EXCLUSION_REASON_LENGTH,
  buildCoverageExclusion,
  reconcileCoverageExclusion,
  type CoverageExclusionRecord,
  type CoverageExclusionRequest,
} from './coverageExclusions';

const WORLD_ID = 'mistwood-public';
const EVENT_ID = 'event-mistwood-42';
const OPERATOR = 'operator-qiu';
const CREATED_AT = 1_700_000_000_000;

const REASON = '這一段涉及未成年當事人，依編輯決議不進入公開摘要。';

const request = (overrides: Partial<CoverageExclusionRequest> = {}): CoverageExclusionRequest => ({
  worldId: WORLD_ID,
  worldDay: 3,
  eventId: EVENT_ID,
  reason: REASON,
  operatorId: OPERATOR,
  createdAt: CREATED_AT,
  ...overrides,
});

/**
 * The refused code, or a thrown assertion naming what came back instead — so a case that stops
 * refusing fails loudly rather than silently returning a record.
 */
const refusalCode = (overrides: Partial<CoverageExclusionRequest>): string => {
  try {
    const record = buildCoverageExclusion(request(overrides));
    throw new Error(`expected a refusal, got ${JSON.stringify(record)}`);
  } catch (error) {
    if (!(error instanceof CoverageExclusionError)) throw error;
    return error.code;
  }
};

describe('FR-G004 coverage exclusion: the reason is the whole point', () => {
  it('stores the trimmed reason, and the identity the operator declared it under', () => {
    const record = buildCoverageExclusion(request({ reason: `  \n${REASON}\t ` }));

    expect(record).toEqual({
      schemaVersion: 1,
      worldId: WORLD_ID,
      worldDay: 3,
      eventId: EVENT_ID,
      reason: REASON,
      operatorId: OPERATOR,
      createdAt: CREATED_AT,
    });
    // Trimmed, not merely stored: the stored text is what a reviewer reads.
    expect(record.reason).not.toContain('\n');
    expect(record.reason).not.toContain('\t');
  });

  for (const [label, reason] of [
    ['empty', ''],
    ['whitespace only', '   \n\t  '],
    ['shorter than the minimum', 'x'.repeat(MIN_EXCLUSION_REASON_LENGTH - 1)],
  ] as const) {
    it(`refuses a reason that is ${label}`, () => {
      expect(refusalCode({ reason })).toBe('COVERAGE_EXCLUSION_INVALID');
    });
  }

  it('measures the minimum against the trimmed text, not the padding', () => {
    const short = 'x'.repeat(MIN_EXCLUSION_REASON_LENGTH - 1);

    // Padded to well over the minimum, and still refused: whitespace is not a justification.
    expect(refusalCode({ reason: `${' '.repeat(20)}${short}${' '.repeat(20)}` }))
      .toBe('COVERAGE_EXCLUSION_INVALID');
    expect(buildCoverageExclusion(request({ reason: `  ${'x'.repeat(MIN_EXCLUSION_REASON_LENGTH)}  ` })).reason)
      .toHaveLength(MIN_EXCLUSION_REASON_LENGTH);
  });

  it('refuses a reason over the maximum, and accepts one exactly at it', () => {
    expect(refusalCode({ reason: 'x'.repeat(MAX_EXCLUSION_REASON_LENGTH + 1) }))
      .toBe('COVERAGE_EXCLUSION_INVALID');
    expect(buildCoverageExclusion(request({ reason: 'x'.repeat(MAX_EXCLUSION_REASON_LENGTH) })).reason)
      .toHaveLength(MAX_EXCLUSION_REASON_LENGTH);
  });
});

describe('FR-G004 coverage exclusion: the row must name a world, an event and an operator', () => {
  const identityFields: readonly (readonly [string, Partial<CoverageExclusionRequest>, Partial<CoverageExclusionRequest>])[] = [
    ['worldId', { worldId: '' }, { worldId: '   ' }],
    ['eventId', { eventId: '' }, { eventId: '   ' }],
    ['operatorId', { operatorId: '' }, { operatorId: '   ' }],
  ];

  for (const [field, missing, blank] of identityFields) {
    it(`refuses a missing ${field}`, () => {
      expect(refusalCode(missing)).toBe('COVERAGE_EXCLUSION_INVALID');
      // Whitespace is not a name either — an unattributable exclusion is not reviewable.
      expect(refusalCode(blank)).toBe('COVERAGE_EXCLUSION_INVALID');
    });
  }

  for (const [label, worldDay] of [
    ['fractional', 1.5],
    ['negative', -1],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ] as const) {
    it(`refuses a ${label} world day`, () => {
      expect(refusalCode({ worldDay })).toBe('COVERAGE_EXCLUSION_INVALID');
    });
  }

  it('accepts world day 0, the world’s first day', () => {
    expect(buildCoverageExclusion(request({ worldDay: 0 })).worldDay).toBe(0);
  });

  it('refuses a creation time that is not a finite number', () => {
    expect(refusalCode({ createdAt: Number.NaN })).toBe('COVERAGE_EXCLUSION_INVALID');
  });
});

describe('FR-G004 coverage exclusion: append-only, one row per event', () => {
  const stored = (reason: string): CoverageExclusionRecord =>
    buildCoverageExclusion(request({ reason }));

  it('treats a re-declaration of the same reason as a no-op', () => {
    // A retried operator action must not create a second reason for one omission.
    expect(reconcileCoverageExclusion(stored(REASON), stored(REASON))).toEqual({ deduplicated: true });
  });

  it('deduplicates against the trimmed text, so whitespace is not a new decision', () => {
    expect(reconcileCoverageExclusion(stored(REASON), buildCoverageExclusion(request({ reason: `  ${REASON}  ` }))))
      .toEqual({ deduplicated: true });
  });

  it('refuses a second, different reason for an already-excluded event', () => {
    const different = '這一段的排除理由已由編輯會議改寫。';

    // The record of why something was left out of the public account is not editable in place,
    // for the same reason accepted Canon is not.
    let code: string | null = null;
    try {
      reconcileCoverageExclusion(stored(REASON), stored(different));
    } catch (error) {
      if (!(error instanceof CoverageExclusionError)) throw error;
      code = error.code;
    }
    expect(code).toBe('COVERAGE_EXCLUSION_CONFLICT');
  });

  it('distinguishes a conflict from an invalid declaration by code alone', () => {
    // An operator UI branches on these: one means "say it differently", the other means
    // "this decision is already recorded and needs a superseding process".
    expect(refusalCode({ reason: '' })).toBe('COVERAGE_EXCLUSION_INVALID');
    expect(() => reconcileCoverageExclusion(stored(REASON), stored('這是另一個完全不同的理由。')))
      .toThrow(CoverageExclusionError);
  });
});
