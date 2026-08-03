import {
  buildDeepRecap,
  buildMachineSummary,
  countChineseCharacters,
  deriveFactId,
  QUICK_RECAP_MAX,
  QUICK_RECAP_MIN,
  RecapFormatError,
  STANDARD_RECAP_MAX,
  STANDARD_RECAP_MIN,
  validateRecapFormats,
  type MachineSummary,
  type RecapFormats,
} from './recapFormats';
import type { AcceptedEvent } from '../canon/model';

function fixtureEvent(over: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    schemaVersion: 1,
    worldId: 'w1',
    idempotencyKey: 'k-e1',
    proposedBy: { type: 'character', id: 'a' },
    worldDay: 1,
    timeSlot: 'morning',
    eventType: 'social_encounter' as AcceptedEvent['eventType'],
    locationId: 'loc-1',
    participantIds: ['a', 'b'],
    causedByEventIds: [],
    publicSummary: '朋友在廣場相遇',
    stateChanges: [],
    eventId: 'e1',
    acceptedAt: 1_000,
    sequenceNumber: 1,
    validationVersion: 1,
    traceId: 't1',
    ...over,
  } as AcceptedEvent;
}

const cjk = (n: number): string => '今'.repeat(n);

function validFormats(over: Partial<RecapFormats> = {}): RecapFormats {
  const events = [fixtureEvent()];
  return {
    schemaVersion: 1,
    quickRecap: cjk(100),
    standardRecap: cjk(600),
    deepRecap: buildDeepRecap(events),
    machineSummary: buildMachineSummary(events),
    sourceEventIds: ['e1'],
    ...over,
  };
}

describe('countChineseCharacters', () => {
  it('counts only CJK ideographs', () => {
    expect(countChineseCharacters('你好世界')).toBe(4);
    expect(countChineseCharacters('hello 你好 world')).toBe(2);
    expect(countChineseCharacters('')).toBe(0);
    expect(countChineseCharacters('123 abc')).toBe(0);
  });
});

describe('validateRecapFormats — Quick Recap length (AC#1)', () => {
  it('accepts 80 and 150 中文字', () => {
    expect(() => validateRecapFormats(validFormats({ quickRecap: cjk(80) }), [fixtureEvent()])).not.toThrow();
    expect(() => validateRecapFormats(validFormats({ quickRecap: cjk(150) }), [fixtureEvent()])).not.toThrow();
  });
  it('rejects below 80', () => {
    expect(() => validateRecapFormats(validFormats({ quickRecap: cjk(79) }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
  it('rejects above 150', () => {
    expect(() => validateRecapFormats(validFormats({ quickRecap: cjk(151) }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
});

describe('validateRecapFormats — Standard Recap length (AC#2)', () => {
  it('accepts 400 and 800 中文字', () => {
    expect(() => validateRecapFormats(validFormats({ standardRecap: cjk(400) }), [fixtureEvent()])).not.toThrow();
    expect(() => validateRecapFormats(validFormats({ standardRecap: cjk(800) }), [fixtureEvent()])).not.toThrow();
  });
  it('rejects below 400 and above 800', () => {
    expect(() => validateRecapFormats(validFormats({ standardRecap: cjk(399) }), [fixtureEvent()])).toThrow(RecapFormatError);
    expect(() => validateRecapFormats(validFormats({ standardRecap: cjk(801) }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
});

describe('validateRecapFormats — Deep Recap (AC#3)', () => {
  it('rejects an empty deep recap', () => {
    expect(() => validateRecapFormats(validFormats({ deepRecap: '   ' }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
  it('accepts a non-empty causal event list', () => {
    expect(() => validateRecapFormats(validFormats({ deepRecap: buildDeepRecap([fixtureEvent()]) }), [fixtureEvent()])).not.toThrow();
  });
});

describe('validateRecapFormats — Machine Summary (AC#4)', () => {
  const base = (): MachineSummary => buildMachineSummary([fixtureEvent()]);
  it('accepts the seven required fields', () => {
    expect(() => validateRecapFormats(validFormats({ machineSummary: base() }), [fixtureEvent()])).not.toThrow();
  });
  it('rejects a missing required field', () => {
    const missing = { ...base() } as Partial<MachineSummary>;
    delete missing.whatChanged;
    expect(() => validateRecapFormats(validFormats({ machineSummary: missing as MachineSummary }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
  it('rejects an unknown field', () => {
    expect(() => validateRecapFormats(validFormats({ machineSummary: { ...base(), extra: ['x'] } as MachineSummary }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
  it('rejects a non-array field', () => {
    expect(() => validateRecapFormats(validFormats({ machineSummary: { ...base(), whoIsAffected: 'a' as unknown as string[] } }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
});

describe('validateRecapFormats — Traceability (AC#5)', () => {
  it('rejects a sourceEventId that is not an accepted event', () => {
    expect(() => validateRecapFormats(validFormats({ sourceEventIds: ['e1', 'phantom'] }), [fixtureEvent()])).toThrow(RecapFormatError);
  });
  it('accepts when every sourceEventId is accepted', () => {
    expect(() => validateRecapFormats(validFormats({ sourceEventIds: ['e1'] }), [fixtureEvent()])).not.toThrow();
  });
  it('rejects an unknown top-level field', () => {
    expect(() => validateRecapFormats({ ...validFormats(), extra: 1 }, [fixtureEvent()])).toThrow(RecapFormatError);
  });
});

describe('buildMachineSummary', () => {
  it('derives whatChanged/whyItHappened/whoIsAffected/requiredPriorFacts from accepted events', () => {
    const events = [
      fixtureEvent({ eventId: 'e1', publicSummary: '朋友相遇', causedByEventIds: [], participantIds: ['a', 'b'] }),
      fixtureEvent({
        eventId: 'e2', publicSummary: '廣場衝突', sequenceNumber: 2, causedByEventIds: ['e1'], participantIds: ['b', 'c'],
        stateChanges: [{ type: 'fact_created', subjectType: 'world', subjectId: 'w1', predicate: 'mood', value: 'tense', visibility: 'public' }],
      }),
    ];
    const summary = buildMachineSummary(events, { newQuestions: ['誰引發了衝突？'], storyArcProgress: [{ arcId: 'arc-1', progress: '升溫' }] });
    expect(summary.whatChanged).toEqual(['朋友相遇', '廣場衝突']);
    expect(summary.whyItHappened).toEqual(['e1']);
    expect(summary.whoIsAffected).toEqual(['a', 'b', 'c']);
    expect(summary.requiredPriorFacts).toEqual([deriveFactId('e2', 0)]);
    expect(summary.newQuestions).toEqual(['誰引發了衝突？']);
    expect(summary.storyArcProgress).toEqual([{ arcId: 'arc-1', progress: '升溫' }]);
  });
});

describe('buildDeepRecap', () => {
  it('composes a causal event list including participants and causes', () => {
    const deep = buildDeepRecap([
      fixtureEvent({ eventId: 'e1', publicSummary: '朋友相遇', participantIds: ['a', 'b'] }),
      fixtureEvent({ eventId: 'e2', publicSummary: '廣場衝突', participantIds: ['b', 'c'], causedByEventIds: ['e1'] }),
    ]);
    expect(deep).toContain('朋友相遇');
    expect(deep).toContain('廣場衝突');
    expect(deep).toContain('起因：e1');
  });
  it('returns an empty string for no events', () => {
    expect(buildDeepRecap([])).toBe('');
  });
});

describe('recap format round-trip', () => {
  it('validate accepts the bounds documented in FR-G003', () => {
    expect(QUICK_RECAP_MIN).toBe(80);
    expect(QUICK_RECAP_MAX).toBe(150);
    expect(STANDARD_RECAP_MIN).toBe(400);
    expect(STANDARD_RECAP_MAX).toBe(800);
  });
});
