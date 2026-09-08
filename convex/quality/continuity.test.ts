/**
 * The Continuity evaluator (FR-M002 Continuity Score; PRD §16.2 Canon targets). ART-58.
 *
 * Every fixture here is a SEEDED Mistwood world, not `emptyProjection`: the origin is the same
 * `initialSnapshot` the world import builds, and the rule context carries the same seeded
 * character, location, item and organization sets the commit pipeline loads. That is not
 * decoration. Against an empty projection `validateCanon` skips the unknown-destination,
 * inactive-destination and capacity checks, and the evaluator's location check has no seed
 * placement to compare a participant against — so a fixture that started from empty would report
 * a clean world while measuring almost nothing (CLAUDE.md §9, `resolveWorldBaseline`).
 *
 * The rule context deliberately omits `characterPersonas`. Persona anchors are absent-means-inert,
 * and including them would make every finding in this file depend on FR-B003's deviation assessor
 * — a different feature, with its own tests — rather than on the continuity checks under test.
 *
 * Each case asserts three things, because any one of them can be right while the others are wrong:
 * the finding code and its severity, the metric numerator/denominator the finding rolls up into,
 * and the score component that metric drives.
 */

import {
  CONTINUITY_FINDING_CODES,
  MIN_SECRET_NEEDLE_LENGTH,
  SEVERE_CANON_CODES,
  evaluateContinuityDay,
  evaluateContinuityWindow,
  summarizeContinuity,
  type ContinuityDayEvidence,
  type ContinuityDayReport,
  type FoldOrigin,
  type PublicationEvidence,
  type SecretEvidence,
} from './continuity';
import type { EvaluationReport, QualityFinding } from './evaluator';
import type { AcceptedEvent, CanonRuleContext, StateChange } from '../canon/model';
import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { replayWorldEvents } from '../canon/replay';
import { cloneProjection, projectionIntegrityHash } from '../canon/snapshots';
import { buildWorldImportPlan } from '../canon/worldConfig';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { deriveEventId } from '../shared/ids';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;

const YINGXUE = 'lin-yingxue';
const WENRUI = 'gao-wenrui';
const PEILAN = 'pei-lan';

const PAPER = 'mistwood-paper';
const HALL = 'mistwood-hall';
const SQUARE = 'mistwood-square';
const MILL = 'mistwood-mill';

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active);

const seedLocation = (characterId: string): string => {
  const character = mistwoodCharacterSeed.characters.find(({ id }) => id === characterId);
  if (!character) throw new Error(`unknown seed character ${characterId}`);
  return character.initialLocationId;
};

const seedConnections = (locationId: string): readonly string[] => {
  const location = mistwoodWorldConfiguration.locations.find(({ id }) => id === locationId);
  if (!location) throw new Error(`unknown seed location ${locationId}`);
  return location.connectedLocationIds;
};

/**
 * The world's rule context as the commit pipeline loads it, mirroring the long-run harness.
 * `initialCharacterLocations` and `initialCharacterAlive` are what let the evaluator say where a
 * participant was BEFORE they ever moved, and whether they started alive.
 */
const ruleContext = (): CanonRuleContext => ({
  worldId: WORLD_ID,
  rules: mistwoodWorldConfiguration.immutableRules,
  characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
  locationIds: activeLocations.map(({ id }) => id),
  itemIds: mistwoodCharacterSeed.assets.map(({ id }) => id),
  organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
  initialCharacterAlive: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id }) => [id, true])),
  initialItemOwners: Object.fromEntries(mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => [id, ownerCharacterId])),
  initialCharacterLocations: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id, initialLocationId }) => [id, initialLocationId])),
  locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
});

/** The seeded `initial` snapshot the world import writes — locations and organizations, no events. */
const seededProjection = () => buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot.projection;

const origin = (): FoldOrigin => ({
  kind: 'initial_snapshot',
  ref: 'snapshot:initial',
  projection: seededProjection(),
  lastSequenceNumber: -1,
});

const memoryFormed = (characterId: string): StateChange => ({
  type: 'character_memory_formed',
  characterId,
  content: 'They spoke about the mill-channel repair vote.',
  interpretation: 'Routine civic business.',
  importance: 0.2,
  emotionalWeight: 0,
  confidence: 0.9,
  visibility: 'private',
});

const moved = (characterId: string, fromLocationId: string, toLocationId: string): StateChange =>
  ({ type: 'character_location_changed', characterId, fromLocationId, toLocationId });

const died = (characterId: string): StateChange =>
  ({ type: 'character_life_changed', characterId, alive: false, reason: 'A fall in the archive stair.' });

const revived = (characterId: string): StateChange =>
  ({ type: 'character_life_changed', characterId, alive: true, reason: 'The record named the wrong resident.' });

/**
 * One accepted event. Ids are DERIVED from `(worldId, sequenceNumber)` exactly as the commit step
 * derives them, so a fixture cannot invent an event identity the running system could not produce.
 */
const acceptedEvent = (input: Partial<AcceptedEvent> & { sequenceNumber: number }): AcceptedEvent => ({
  schemaVersion: 1,
  worldId: WORLD_ID,
  idempotencyKey: `mistwood-scene-${input.sequenceNumber}`,
  proposedBy: { type: 'director' },
  worldDay: 0,
  timeSlot: 'morning',
  eventType: 'conversation',
  locationId: HALL,
  participantIds: [WENRUI, PEILAN],
  causedByEventIds: [],
  stateChanges: [memoryFormed(WENRUI)],
  eventId: deriveEventId(WORLD_ID, input.sequenceNumber),
  acceptedAt: 1_700_000_000_000 + input.sequenceNumber,
  validationVersion: CANON_VALIDATION_VERSION,
  traceId: `trace-${input.sequenceNumber}`,
  ...input,
});

const dayEvidence = (overrides: Partial<ContinuityDayEvidence> = {}): ContinuityDayEvidence => ({
  worldId: WORLD_ID,
  worldDay: 0,
  origin: origin(),
  events: [],
  ruleContext: ruleContext(),
  snapshot: null,
  publications: [],
  secrets: [],
  ...overrides,
});

const summarizeDay = (day: ContinuityDayReport): EvaluationReport => summarizeContinuity({
  worldId: WORLD_ID,
  fromWorldDay: day.worldDay,
  toWorldDay: day.worldDay,
  days: [day],
  scanLimitReached: false,
});

const codes = (findings: readonly QualityFinding[]): string[] => findings.map(({ code }) => code);

const metricOf = (report: EvaluationReport, key: string) => {
  const observation = report.metrics.find((entry) => entry.key === key);
  if (!observation) throw new Error(`report carries no metric '${key}'`);
  return observation;
};

const componentOf = (report: EvaluationReport, key: string) => {
  const component = report.score?.components.find((entry) => entry.key === key);
  if (!component) throw new Error(`report carries no score component '${key}'`);
  return component;
};

const findingOf = (findings: readonly QualityFinding[], code: string): QualityFinding => {
  const found = findings.find((entry) => entry.code === code);
  if (!found) throw new Error(`findings carry no '${code}': ${JSON.stringify(codes(findings))}`);
  return found;
};

/** The fold the running system would have persisted for these events, as a snapshot hash. */
const foldHash = (events: readonly AcceptedEvent[]): string =>
  projectionIntegrityHash(replayWorldEvents(cloneProjection(origin().projection), structuredClone([...events])));

describe('the Mistwood fixture matches the seed it claims to come from', () => {
  it('places its characters where the seed places them', () => {
    expect(seedLocation(YINGXUE)).toBe(PAPER);
    expect(seedLocation(WENRUI)).toBe(HALL);
    expect(seedLocation(PEILAN)).toBe(HALL);
  });

  it('uses a genuinely unconnected pair for the teleport case', () => {
    expect(seedConnections(PAPER)).toContain(HALL);
    expect(seedConnections(HALL)).toContain(SQUARE);
    expect(seedConnections(HALL)).not.toContain(MILL);
  });
});

describe('FR-M002 continuity: a clean day', () => {
  const cleanDay = (): ContinuityDayReport => evaluateContinuityDay(dayEvidence({
    events: [
      acceptedEvent({ sequenceNumber: 0 }),
      acceptedEvent({ sequenceNumber: 1, timeSlot: 'afternoon', stateChanges: [memoryFormed(PEILAN)] }),
    ],
  }));

  it('reports no findings and a measured zero on every event-denominated metric', () => {
    const day = cleanDay();

    expect(day.findings).toEqual([]);
    expect(day.counts).toEqual({
      acceptedEvents: 2,
      eventsWithSevereConflict: 0,
      eventsWithDeceasedAppearance: 0,
      eventsWithLocationConflict: 0,
      replayConsistent: null,
      publicationsExamined: 0,
      publicationsLeaking: 0,
    });

    const report = summarizeDay(day);
    for (const key of ['severe_canon_conflicts', 'deceased_character_appearances', 'character_location_conflicts']) {
      const observation = metricOf(report, key);
      expect(observation.numerator).toBe(0);
      expect(observation.denominator).toBe(2);
      expect(observation.status).toBe('measured');
      expect(observation.rate).toBe(0);
      expect(observation.meetsTarget).toBe(true);
    }
  });

  it('excludes replay rather than scoring it, when the day carries no snapshot', () => {
    const report = summarizeDay(cleanDay());
    const replay = metricOf(report, 'replay_consistency');

    expect(replay.status).toBe('no_observations');
    expect(replay.rate).toBeNull();
    expect(replay.denominator).toBe(0);
    expect(replay.excluded).toBe(1);
    expect(replay.excludedReason).not.toBeNull();
    expect(componentOf(report, 'replay_integrity').value).toBeNull();
  });

  it('scores 1 over the measured components only', () => {
    const report = summarizeDay(cleanDay());

    expect(report.score?.value).toBe(1);
    // 0.3 canon + 0.15 deceased + 0.15 location. Replay and secrets measured nothing.
    expect(report.score?.weightMeasured).toBe(0.6);
    expect(report.score?.weightTotal).toBe(1);
    expect(report.coverage.worldDaysEvaluated).toEqual([0]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([]);
  });
});

describe('FR-M002 continuity: a window with no evidence at all', () => {
  const emptyWindow = (): EvaluationReport => evaluateContinuityWindow({
    worldId: WORLD_ID,
    fromWorldDay: 0,
    toWorldDay: 2,
    origin: origin(),
    ruleContext: ruleContext(),
    secrets: [],
    eventsByDay: new Map(),
    snapshotByDay: new Map(),
    publicationsByDay: new Map(),
    scanLimitReached: false,
  });

  it('reports every metric as unmeasured, and nothing as 0%', () => {
    const report = emptyWindow();

    expect(report.metrics).toHaveLength(5);
    for (const observation of report.metrics) {
      expect(observation.status).toBe('no_observations');
      expect(observation.rate).toBeNull();
      // The guard this module exists for: an empty world must not report 「嚴重 Canon 衝突 0」
      // or 「Replay 一致率 100%」 and pass a §16.2 gate having measured nothing.
      expect(observation.rate).not.toBe(0);
      expect(observation.meetsTarget).toBeNull();
      expect(observation.denominator).toBe(0);
    }
  });

  it('reports a null score and names the days it had no evidence for', () => {
    const report = emptyWindow();

    expect(report.score?.value).toBeNull();
    expect(report.score?.status).toBe('no_observations');
    expect(report.score?.weightMeasured).toBe(0);
    expect(report.coverage.worldDaysEvaluated).toEqual([]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([0, 1, 2]);
    expect(report.findings).toEqual([]);
  });
});

describe('FR-M002 continuity: deceased appearance', () => {
  const death = acceptedEvent({
    sequenceNumber: 0,
    eventType: 'world_event',
    participantIds: [PEILAN],
    stateChanges: [died(PEILAN)],
  });

  it('flags a later event whose participant was dead at its start', () => {
    const appearance = acceptedEvent({
      sequenceNumber: 1,
      timeSlot: 'afternoon',
      participantIds: [WENRUI, PEILAN],
      stateChanges: [memoryFormed(WENRUI)],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [death, appearance] }));

    const finding = findingOf(day.findings, 'DECEASED_CHARACTER_APPEARANCE');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe(appearance.eventId);
    expect(finding.worldDay).toBe(0);
    expect(finding.evidence).toContainEqual({ kind: 'accepted_event', id: PEILAN });
    // The death itself is not an appearance: the participant was alive when it started.
    expect(day.findings.filter((entry) => entry.code === 'DECEASED_CHARACTER_APPEARANCE')).toHaveLength(1);

    expect(day.counts.eventsWithDeceasedAppearance).toBe(1);
    expect(day.counts.acceptedEvents).toBe(2);

    const report = summarizeDay(day);
    const deceased = metricOf(report, 'deceased_character_appearances');
    expect(deceased.numerator).toBe(1);
    expect(deceased.denominator).toBe(2);
    expect(deceased.rate).toBe(0.5);
    expect(deceased.meetsTarget).toBe(false);
    expect(componentOf(report, 'deceased_integrity').value).toBe(0.5);
  });

  it('does not flag an event that revives the character it names', () => {
    const revival = acceptedEvent({
      sequenceNumber: 1,
      timeSlot: 'afternoon',
      participantIds: [PEILAN],
      stateChanges: [revived(PEILAN)],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [death, revival] }));

    expect(codes(day.findings)).not.toContain('DECEASED_CHARACTER_APPEARANCE');
    expect(day.counts.eventsWithDeceasedAppearance).toBe(0);
    // Canon separately refuses a resurrection outside a superseding remediation, so the day is not
    // clean — which is what proves the deceased check RAN and chose not to fire, rather than the
    // event having been skipped altogether.
    expect(codes(day.findings)).toContain('SEVERE_CANON_CONFLICT');

    const report = summarizeDay(day);
    expect(metricOf(report, 'deceased_character_appearances').numerator).toBe(0);
    expect(metricOf(report, 'deceased_character_appearances').denominator).toBe(2);
    expect(componentOf(report, 'deceased_integrity').value).toBe(1);
  });
});

describe('FR-M002 continuity: character location', () => {
  it('flags a participant who is not at the event location and was not moved there', () => {
    const misplaced = acceptedEvent({
      sequenceNumber: 0,
      locationId: SQUARE,
      participantIds: [YINGXUE],
      stateChanges: [memoryFormed(YINGXUE)],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [misplaced] }));

    const finding = findingOf(day.findings, 'CHARACTER_LOCATION_CONFLICT');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe(misplaced.eventId);
    expect(finding.evidence).toContainEqual({ kind: 'accepted_event', id: YINGXUE });
    expect(finding.detail).toContain(PAPER);
    expect(finding.detail).toContain(SQUARE);
    expect(day.counts.eventsWithLocationConflict).toBe(1);

    const report = summarizeDay(day);
    const location = metricOf(report, 'character_location_conflicts');
    expect(location.numerator).toBe(1);
    expect(location.denominator).toBe(1);
    expect(location.meetsTarget).toBe(false);
    expect(componentOf(report, 'location_integrity').value).toBe(0);
  });

  it('does not flag the same event when it carries the movement that puts them there', () => {
    const arrival = acceptedEvent({
      sequenceNumber: 0,
      locationId: SQUARE,
      participantIds: [YINGXUE],
      stateChanges: [moved(YINGXUE, PAPER, SQUARE), memoryFormed(YINGXUE)],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [arrival] }));

    expect(day.findings).toEqual([]);
    expect(day.counts.eventsWithLocationConflict).toBe(0);

    const report = summarizeDay(day);
    expect(metricOf(report, 'character_location_conflicts').numerator).toBe(0);
    expect(componentOf(report, 'location_integrity').value).toBe(1);
  });

  it('flags a character moved twice inside one time slot', () => {
    const first = acceptedEvent({
      sequenceNumber: 0,
      locationId: HALL,
      participantIds: [YINGXUE],
      stateChanges: [moved(YINGXUE, PAPER, HALL)],
    });
    const second = acceptedEvent({
      sequenceNumber: 1,
      locationId: SQUARE,
      participantIds: [YINGXUE],
      stateChanges: [moved(YINGXUE, HALL, SQUARE)],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [first, second] }));

    const finding = findingOf(day.findings, 'CHARACTER_DOUBLE_MOVEMENT');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe(second.eventId);
    expect(finding.detail).toContain(`0:${second.timeSlot}`);
    expect(day.counts.eventsWithLocationConflict).toBe(1);

    const report = summarizeDay(day);
    expect(metricOf(report, 'character_location_conflicts').numerator).toBe(1);
    expect(metricOf(report, 'character_location_conflicts').denominator).toBe(2);
    expect(componentOf(report, 'location_integrity').value).toBe(0.5);
  });
});

describe('FR-M002 continuity: severe versus minor Canon conflicts', () => {
  it('reports a severe Canon code with the validation reference it came from', () => {
    const placed = acceptedEvent({
      sequenceNumber: 0,
      locationId: HALL,
      participantIds: [YINGXUE],
      stateChanges: [moved(YINGXUE, PAPER, HALL)],
    });
    // Hall does not connect to the mill, and Canon has already placed her at the hall, so this
    // second movement is a teleport rather than a first placement.
    const teleport = acceptedEvent({
      sequenceNumber: 1,
      timeSlot: 'afternoon',
      locationId: MILL,
      participantIds: [YINGXUE],
      stateChanges: [moved(YINGXUE, HALL, MILL)],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [placed, teleport] }));

    const finding = findingOf(day.findings, 'SEVERE_CANON_CONFLICT');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe(teleport.eventId);
    expect(finding.evidence).toContainEqual({
      kind: 'validation',
      id: `${teleport.eventId}:revalidation`,
      code: 'TELEPORTATION_NOT_ALLOWED',
      worldDay: 0,
    });
    expect(finding.detail).toContain('TELEPORTATION_NOT_ALLOWED');
    expect(finding.detail).toContain(CANON_VALIDATION_VERSION);
    expect(SEVERE_CANON_CODES.has('TELEPORTATION_NOT_ALLOWED')).toBe(true);

    expect(day.counts.eventsWithSevereConflict).toBe(1);
    const report = summarizeDay(day);
    const severe = metricOf(report, 'severe_canon_conflicts');
    expect(severe.numerator).toBe(1);
    expect(severe.denominator).toBe(2);
    expect(severe.meetsTarget).toBe(false);
    expect(componentOf(report, 'canon_integrity').value).toBe(0.5);
  });

  it('counts a non-severe Canon code as a minor conflict outside 嚴重 Canon 衝突', () => {
    // A private relationship change carrying a public summary. Canon refuses it, but it is a
    // disclosure-shaped fault: the accepted history it produces can still be true.
    const disclosure = acceptedEvent({
      sequenceNumber: 0,
      publicSummary: 'The mayor and the council chair spoke in the hall.',
      stateChanges: [{
        type: 'relationship_changed',
        sourceCharacterId: WENRUI,
        targetCharacterId: PEILAN,
        trustDelta: -2,
        affectionDelta: 0,
        resentmentDelta: 1,
        reason: 'The guarantee came up again.',
      }],
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [disclosure] }));

    const finding = findingOf(day.findings, 'CANON_CONFLICT');
    expect(finding.severity).toBe('minor');
    expect(finding.evidence).toContainEqual({
      kind: 'validation',
      id: `${disclosure.eventId}:revalidation`,
      code: 'PRIVATE_RELATIONSHIP_DISCLOSURE',
      worldDay: 0,
    });
    expect(SEVERE_CANON_CODES.has('PRIVATE_RELATIONSHIP_DISCLOSURE')).toBe(false);
    expect(codes(day.findings)).not.toContain('SEVERE_CANON_CONFLICT');

    // The point of the split: a minor conflict is REPORTED but does not move 嚴重 Canon 衝突,
    // whose §16.2 target is exactly 0.
    expect(day.counts.eventsWithSevereConflict).toBe(0);
    const report = summarizeDay(day);
    const severe = metricOf(report, 'severe_canon_conflicts');
    expect(severe.numerator).toBe(0);
    expect(severe.denominator).toBe(1);
    expect(severe.meetsTarget).toBe(true);
    expect(componentOf(report, 'canon_integrity').value).toBe(1);
    expect(report.findings).toHaveLength(1);
  });

  it('fixes the severity of every finding code it can emit', () => {
    expect(CONTINUITY_FINDING_CODES.SEVERE_CANON_CONFLICT).toBe('severe');
    expect(CONTINUITY_FINDING_CODES.CANON_CONFLICT).toBe('minor');
    expect(Object.entries(CONTINUITY_FINDING_CODES)
      .filter(([, severity]) => severity === 'minor')
      .map(([code]) => code)).toEqual(['CANON_CONFLICT']);
  });
});

describe('FR-M002 continuity: append-only invariants', () => {
  /**
   * A gap INSIDE the day. The reducer refuses the event that skips ahead (`SEQUENCE_GAP`), and the
   * first version of the evaluator let that throw past it — so the one finding written for this
   * evidence was unreachable on it. Now the refusal is a finding and the day is still reported.
   */
  it('reports a within-day sequence gap instead of throwing on it', () => {
    const day = evaluateContinuityDay(dayEvidence({
      events: [acceptedEvent({ sequenceNumber: 0 }), acceptedEvent({ sequenceNumber: 2, timeSlot: 'afternoon' })],
    }));

    expect(codes(day.findings)).toEqual(expect.arrayContaining(['SEQUENCE_NOT_DENSE', 'REPLAY_FOLD_FAILED']));
    const refused = findingOf(day.findings, 'REPLAY_FOLD_FAILED');
    expect(refused.subjectId).toBe(deriveEventId(WORLD_ID, 2));
    expect(refused.evidence.some((ref) => ref.kind === 'replay' && ref.code === 'SEQUENCE_GAP')).toBe(true);
    expect(day.counts.acceptedEvents).toBe(2);
    expect(day.counts.eventsWithSevereConflict).toBe(1);
    // The day was folded without the refused event, deterministically: no nondeterminism finding.
    expect(codes(day.findings)).not.toContain('REPLAY_NONDETERMINISTIC');
  });

  /** The day's first event does not continue the origin the evidence declares. */
  it('flags a day whose events do not continue the declared origin sequence', () => {
    const day = evaluateContinuityDay(dayEvidence({
      origin: { ...origin(), kind: 'daily_snapshot', ref: 'snapshot:day-0', lastSequenceNumber: 0 },
      events: [acceptedEvent({ sequenceNumber: 0 }), acceptedEvent({ sequenceNumber: 1, timeSlot: 'afternoon' })],
    }));

    const finding = findingOf(day.findings, 'SEQUENCE_NOT_DENSE');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe(deriveEventId(WORLD_ID, 0));
    expect(finding.detail).toContain('expected sequence 1');
    expect(day.findings.filter((entry) => entry.code === 'SEQUENCE_NOT_DENSE')).toHaveLength(1);

    expect(day.counts.eventsWithSevereConflict).toBe(1);
    expect(metricOf(summarizeDay(day), 'severe_canon_conflicts').numerator).toBe(1);
  });

  it('flags a second accepted event carrying an idempotency key already used in the day', () => {
    const first = acceptedEvent({ sequenceNumber: 0, idempotencyKey: 'mistwood-scene-repeat' });
    const replayed = acceptedEvent({
      sequenceNumber: 1,
      timeSlot: 'afternoon',
      idempotencyKey: 'mistwood-scene-repeat',
    });
    const day = evaluateContinuityDay(dayEvidence({ events: [first, replayed] }));

    const finding = findingOf(day.findings, 'DUPLICATE_IDEMPOTENCY_KEY');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe(replayed.eventId);
    expect(day.counts.eventsWithSevereConflict).toBe(1);
    expect(metricOf(summarizeDay(day), 'severe_canon_conflicts').numerator).toBe(1);
    expect(componentOf(summarizeDay(day), 'canon_integrity').value).toBe(0.5);
  });
});

describe('FR-M002 continuity: replay against the stored daily snapshot', () => {
  const events = (): AcceptedEvent[] => [
    acceptedEvent({ sequenceNumber: 0 }),
    acceptedEvent({ sequenceNumber: 1, timeSlot: 'afternoon', stateChanges: [memoryFormed(PEILAN)] }),
  ];

  it('is consistent when the fold reproduces the snapshot the system stored', () => {
    const day = evaluateContinuityDay(dayEvidence({
      events: events(),
      snapshot: { ref: 'snapshot:day-0', lastSequenceNumber: 1, projectionHash: foldHash(events()) },
    }));

    expect(day.findings).toEqual([]);
    expect(day.counts.replayConsistent).toBe(true);
    expect(day.foldDigest).toBe(foldHash(events()));

    const report = summarizeDay(day);
    const replay = metricOf(report, 'replay_consistency');
    expect(replay.numerator).toBe(1);
    expect(replay.denominator).toBe(1);
    expect(replay.rate).toBe(1);
    expect(replay.meetsTarget).toBe(true);
    expect(replay.excluded).toBe(0);
    expect(componentOf(report, 'replay_integrity').value).toBe(1);
  });

  it('flags a snapshot whose projection hash the fold does not reproduce', () => {
    const day = evaluateContinuityDay(dayEvidence({
      events: events(),
      snapshot: { ref: 'snapshot:day-0', lastSequenceNumber: 1, projectionHash: 'fnv1a32:deadbeef' },
    }));

    const finding = findingOf(day.findings, 'REPLAY_SNAPSHOT_MISMATCH');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe('snapshot:day-0');
    expect(finding.evidence).toContainEqual({ kind: 'snapshot', id: 'snapshot:day-0', worldDay: 0 });
    expect(finding.detail).toContain('fnv1a32:deadbeef');
    expect(day.counts.replayConsistent).toBe(false);

    const report = summarizeDay(day);
    const replay = metricOf(report, 'replay_consistency');
    expect(replay.numerator).toBe(0);
    expect(replay.denominator).toBe(1);
    expect(replay.rate).toBe(0);
    expect(replay.meetsTarget).toBe(false);
    expect(componentOf(report, 'replay_integrity').value).toBe(0);
  });

  it('flags a snapshot claiming a sequence the day did not end on', () => {
    const day = evaluateContinuityDay(dayEvidence({
      events: events(),
      snapshot: { ref: 'snapshot:day-0', lastSequenceNumber: 7, projectionHash: foldHash(events()) },
    }));

    const finding = findingOf(day.findings, 'REPLAY_SNAPSHOT_SEQUENCE_MISMATCH');
    expect(finding.severity).toBe('severe');
    expect(finding.detail).toContain('snapshot claims sequence 7');
    expect(codes(day.findings)).not.toContain('REPLAY_SNAPSHOT_MISMATCH');
    expect(day.counts.replayConsistent).toBe(false);
    expect(metricOf(summarizeDay(day), 'replay_consistency').numerator).toBe(0);
    expect(metricOf(summarizeDay(day), 'replay_consistency').denominator).toBe(1);
  });
});

describe('FR-M002 continuity: unsourced secret leaks', () => {
  const seedSecret = mistwoodCharacterSeed.secrets[0];
  const secretEvidence: SecretEvidence[] = [{ secretId: seedSecret.id, content: seedSecret.content }];

  const publication = (overrides: Partial<PublicationEvidence> = {}): PublicationEvidence => ({
    ref: 'publication:day-0',
    text: `晨間快報：${seedSecret.content}`,
    citedEventIds: [],
    ...overrides,
  });

  it('flags a publication carrying a seeded secret that nothing it cites made public', () => {
    const day = evaluateContinuityDay(dayEvidence({
      events: [acceptedEvent({ sequenceNumber: 0 })],
      publications: [publication()],
      secrets: secretEvidence,
    }));

    const finding = findingOf(day.findings, 'UNSOURCED_SECRET_LEAK');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe('publication:day-0');
    expect(finding.evidence).toContainEqual({ kind: 'publication', id: 'publication:day-0', worldDay: 0 });
    expect(finding.evidence).toContainEqual({ kind: 'accepted_event', id: seedSecret.id, code: 'secret' });
    expect(day.counts.publicationsExamined).toBe(1);
    expect(day.counts.publicationsLeaking).toBe(1);

    const report = summarizeDay(day);
    const leaks = metricOf(report, 'unsourced_secret_leaks');
    expect(leaks.numerator).toBe(1);
    expect(leaks.denominator).toBe(1);
    expect(leaks.meetsTarget).toBe(false);
    expect(componentOf(report, 'secret_integrity').value).toBe(0);
  });

  it('never copies the needle it searched for into the report', () => {
    const report = summarizeDay(evaluateContinuityDay(dayEvidence({
      events: [acceptedEvent({ sequenceNumber: 0 })],
      publications: [publication()],
      secrets: secretEvidence,
    })));

    // The report is shown to an operator without a second redaction pass, so a leak report that
    // quoted the leak would be the same disclosure it exists to refuse.
    expect(JSON.stringify(report).includes(seedSecret.content)).toBe(false);
    expect(JSON.stringify(report)).toContain(seedSecret.id);
  });

  it('accepts a publication whose cited event made the content public', () => {
    const disclosure = acceptedEvent({
      sequenceNumber: 0,
      eventType: 'discovery',
      locationId: PAPER,
      participantIds: [YINGXUE],
      stateChanges: [{
        type: 'fact_created',
        subjectType: 'character',
        subjectId: YINGXUE,
        predicate: 'disclosed-at-the-council-session',
        value: seedSecret.content,
        visibility: 'public',
      }],
    });
    const day = evaluateContinuityDay(dayEvidence({
      events: [disclosure],
      publications: [publication({ citedEventIds: [disclosure.eventId] })],
      secrets: secretEvidence,
    }));

    expect(codes(day.findings)).not.toContain('UNSOURCED_SECRET_LEAK');
    expect(day.counts.publicationsLeaking).toBe(0);

    const report = summarizeDay(day);
    const leaks = metricOf(report, 'unsourced_secret_leaks');
    expect(leaks.numerator).toBe(0);
    expect(leaks.denominator).toBe(1);
    expect(leaks.rate).toBe(0);
    expect(leaks.meetsTarget).toBe(true);
    expect(componentOf(report, 'secret_integrity').value).toBe(1);
  });

  it('flags a private fact value that a publication reproduces with no public source', () => {
    const privateValue = 'The inspection ledger sits in station locker fourteen.';
    const privateFact = acceptedEvent({
      sequenceNumber: 0,
      eventType: 'discovery',
      locationId: PAPER,
      participantIds: [YINGXUE],
      stateChanges: [{
        type: 'fact_created',
        subjectType: 'character',
        subjectId: YINGXUE,
        predicate: 'holds-note',
        value: privateValue,
        visibility: 'private',
      }],
    });
    const day = evaluateContinuityDay(dayEvidence({
      events: [privateFact],
      // The publication cites the event, but a PRIVATE fact does not source anything.
      publications: [publication({ text: `晨間快報：${privateValue}`, citedEventIds: [privateFact.eventId] })],
      secrets: [],
    }));

    const finding = findingOf(day.findings, 'UNSOURCED_SECRET_LEAK');
    const factRef = finding.evidence.find((entry) => entry.code === 'private_fact');
    expect(factRef).toBeDefined();
    expect(factRef?.id).toContain(privateFact.eventId);
    expect(day.counts.publicationsLeaking).toBe(1);
    expect(metricOf(summarizeDay(day), 'unsourced_secret_leaks').numerator).toBe(1);
    expect(JSON.stringify(summarizeDay(day)).includes(privateValue)).toBe(false);
  });

  it('ignores needles shorter than the minimum length, and scans at the boundary', () => {
    const shortNeedle = 'x'.repeat(MIN_SECRET_NEEDLE_LENGTH - 1);
    const boundaryNeedle = 'y'.repeat(MIN_SECRET_NEEDLE_LENGTH);
    const scan = (needle: string): ContinuityDayReport => evaluateContinuityDay(dayEvidence({
      events: [acceptedEvent({ sequenceNumber: 0 })],
      publications: [publication({ text: `晨間快報：${needle} 已確認。`, citedEventIds: [] })],
      secrets: [{ secretId: 'secret-short', content: needle }],
    }));

    expect(codes(scan(shortNeedle).findings)).not.toContain('UNSOURCED_SECRET_LEAK');
    expect(scan(shortNeedle).counts.publicationsLeaking).toBe(0);
    expect(codes(scan(boundaryNeedle).findings)).toContain('UNSOURCED_SECRET_LEAK');
    expect(scan(boundaryNeedle).counts.publicationsLeaking).toBe(1);
  });
});

describe('FR-M002 continuity: chaining days across a window', () => {
  const dayZeroMove = (): AcceptedEvent => acceptedEvent({
    sequenceNumber: 0,
    worldDay: 0,
    locationId: HALL,
    participantIds: [YINGXUE],
    stateChanges: [moved(YINGXUE, PAPER, HALL)],
  });

  const window = (dayOne: AcceptedEvent): EvaluationReport => evaluateContinuityWindow({
    worldId: WORLD_ID,
    fromWorldDay: 0,
    toWorldDay: 1,
    origin: origin(),
    ruleContext: ruleContext(),
    secrets: [],
    eventsByDay: new Map([[0, [dayZeroMove()]], [1, [dayOne]]]),
    snapshotByDay: new Map(),
    publicationsByDay: new Map(),
    scanLimitReached: false,
  });

  const dayOneAt = (locationId: string): AcceptedEvent => acceptedEvent({
    sequenceNumber: 1,
    worldDay: 1,
    locationId,
    participantIds: [YINGXUE],
    stateChanges: [memoryFormed(YINGXUE)],
  });

  it('carries day 0 movements into day 0+1, so the day-1 scene at the new location is clean', () => {
    const report = window(dayOneAt(HALL));

    expect(report.findings).toEqual([]);
    expect(report.coverage.worldDaysEvaluated).toEqual([0, 1]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([]);
    expect(metricOf(report, 'character_location_conflicts').numerator).toBe(0);
    expect(metricOf(report, 'character_location_conflicts').denominator).toBe(2);
  });

  it('flags the day-1 scene held at the location day 0 moved the character away from', () => {
    const report = window(dayOneAt(PAPER));

    const finding = findingOf(report.findings, 'CHARACTER_LOCATION_CONFLICT');
    expect(finding.worldDay).toBe(1);
    expect(finding.subjectId).toBe(deriveEventId(WORLD_ID, 1));
    expect(finding.detail).toContain(HALL);
    expect(metricOf(report, 'character_location_conflicts').numerator).toBe(1);
    expect(metricOf(report, 'character_location_conflicts').denominator).toBe(2);
    expect(componentOf(report, 'location_integrity').value).toBe(0.5);
  });

  it('gives one digest to two evaluations of the same evidence', () => {
    expect(window(dayOneAt(HALL)).digest).toBe(window(dayOneAt(HALL)).digest);
    expect(window(dayOneAt(PAPER)).digest).not.toBe(window(dayOneAt(HALL)).digest);
  });
});
