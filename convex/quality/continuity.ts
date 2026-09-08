/**
 * The Continuity evaluator (FR-M002 Continuity Score; PRD §16.2 Canon targets). ART-58.
 *
 * Pure: no Convex, no clock, no randomness, no I/O. It is handed one world day's EVIDENCE and
 * returns what it found; `summarizeContinuity` folds any number of day reports into the
 * §16.2 metrics and the Continuity Score. The Convex operator query and the long-run harness both
 * call exactly these two functions, so a number an operator reads and a number the 90-day gate
 * asserts are the same computation over different evidence — not two implementations that agree
 * on the fixture and nowhere else.
 *
 * ## The five §16.2 targets, and how each is measured
 *
 * | PRD name | numerator | denominator | target |
 * | --- | --- | --- | --- |
 * | 嚴重 Canon 衝突 | severe findings | accepted events | 0 (`atMost`) |
 * | Event Replay 一致率 | days whose fold digest equals the stored daily snapshot AND whose second independent fold equals the first | days carrying a daily snapshot | 100% |
 * | 無來源秘密洩漏 | publications containing a secret or private-fact value with no cited public source | publications examined | 0 |
 * | 死者不合理出場 | events with a participant who was dead at the event's start and is not revived by it | accepted events | 0 |
 * | 角色位置衝突 | events whose participants are not at the event's location after its own movements, plus characters moved twice in one slot | accepted events | 0 |
 *
 * Every check is INDEPENDENT of the code that accepted the event. The Canon re-validation re-runs
 * `validateEventStructure` and `validateCanon` against the projection as it stood before each
 * event; the deceased and location checks fold the projection themselves rather than trusting a
 * validator's verdict; the replay check compares a fresh fold against what the running system
 * persisted. A validator handed its own input is a tautology (CLAUDE.md §9), so none of these is.
 *
 * ## What "severe" means
 *
 * PRD §16.2 says 嚴重 Canon 衝突 = 0 and defines nothing further. {@link SEVERE_CANON_CODES} is
 * the definition: a Canon error code is severe when an accepted event carrying it means the
 * accepted HISTORY contradicts the world — a dead character acting, a teleport, a movement from a
 * place the character was not, an unknown reference, a broken sequence, a reused idempotency key,
 * a rumor that became a fact. Codes about review thresholds and relationship deltas are real
 * conflicts too, and are counted, but as `minor`: they are about degree, not about whether the
 * world's history can be true. The split is versioned with the evaluator.
 *
 * ## The origin of a day's fold, and why it is named
 *
 * A day is evaluated by folding its accepted events onto the projection the world had at the
 * day's start. Where that projection came from is part of the evidence: the seeded `initial`
 * snapshot (or nothing, for an unseeded world), or the previous day's `daily` snapshot. The
 * replay check then means something precise — "the snapshot the system wrote for day D equals
 * day D's events folded onto the snapshot it wrote for day D-1" — which is exactly the
 * snapshot-resume-versus-full-replay divergence a resume path can hide. A caller folding from
 * genesis across many days gets the full-replay proof instead; either way `origin.kind` says which.
 *
 * ## Privacy
 *
 * Secret contents and private fact values enter as NEEDLES and leave as counts and ids. A finding
 * names the publication, the secret id or the fact id, and the cited event ids that failed to
 * source it. No needle is ever placed in a finding, a metric or a digest input.
 */

import type { AcceptedEvent, CanonRuleContext, ProposedEvent, WorldProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { cloneProjection, projectionIntegrityHash } from '../canon/snapshots';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { isSupersedingEventType } from '../canon/eventTypes';
import { deriveEventId } from '../shared/ids';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { CanonError, type CanonErrorCode } from '../shared/errors';
import {
  composeScore,
  dedupeFindings,
  finishReport,
  observeMetric,
  uniqueDays,
  type EvaluationReport,
  type EvaluatorDefinition,
  type EvidenceRef,
  type FindingSeverity,
  type MetricDefinition,
  type QualityFinding,
} from './evaluator';

export const CONTINUITY_EVALUATOR_ID = 'continuity';
export const CONTINUITY_EVALUATOR_VERSION = 1;

/** Shortest secret or private value the leak scan looks for; shorter strings are ambient text. */
export const MIN_SECRET_NEEDLE_LENGTH = 4;

// --- finding codes ----------------------------------------------------------

export const CONTINUITY_FINDING_CODES = {
  /** An accepted event re-validation returned a severe Canon code (see {@link SEVERE_CANON_CODES}). */
  SEVERE_CANON_CONFLICT: 'severe',
  /** An accepted event re-validation returned a non-severe Canon code. */
  CANON_CONFLICT: 'minor',
  /** Sequence numbers inside the day are not dense and ascending. */
  SEQUENCE_NOT_DENSE: 'severe',
  /** Two accepted events carry one idempotency key. */
  DUPLICATE_IDEMPOTENCY_KEY: 'severe',
  /** A participant was dead at the event's start and the event does not revive them. */
  DECEASED_CHARACTER_APPEARANCE: 'severe',
  /** After the event's own movements, a participant is not at the event's location. */
  CHARACTER_LOCATION_CONFLICT: 'severe',
  /** One character was moved by two accepted events in one time slot. */
  CHARACTER_DOUBLE_MOVEMENT: 'severe',
  /** The fold over the day's events does not reproduce the stored daily snapshot. */
  REPLAY_SNAPSHOT_MISMATCH: 'severe',
  /** The stored daily snapshot claims a different last sequence number from the day's last event. */
  REPLAY_SNAPSHOT_SEQUENCE_MISMATCH: 'severe',
  /** Two independent folds of the same events disagree: the reducer is not deterministic. */
  REPLAY_NONDETERMINISTIC: 'severe',
  /**
   * The reducer refused an accepted event outright (a sequence gap or repeat at the fold), so the
   * projection could not be advanced by it. The event is skipped and the day is evaluated on what
   * remains; the evaluator reports rather than throws, because a metric that throws stops the
   * pipeline it measures.
   */
  REPLAY_FOLD_FAILED: 'severe',
  /** A publication contains a secret or private value that no cited event made public. */
  UNSOURCED_SECRET_LEAK: 'severe',
} as const satisfies Record<string, FindingSeverity>;

export type ContinuityFindingCode = keyof typeof CONTINUITY_FINDING_CODES;

/**
 * Canon codes that make an accepted event a SEVERE conflict. Versioned with the evaluator; a
 * change here is a change to what 嚴重 Canon 衝突 means and must bump the version.
 */
export const SEVERE_CANON_CODES: ReadonlySet<CanonErrorCode> = new Set<CanonErrorCode>([
  'IMMUTABLE_WORLD_RULE_VIOLATION',
  'DEAD_CHARACTER_ACTION',
  'TELEPORTATION_NOT_ALLOWED',
  'LOCATION_PRECONDITION_FAILED',
  'CHARACTER_ALREADY_MOVED_THIS_SLOT',
  'DUPLICATE_CHARACTER_MOVEMENT',
  'UNKNOWN_CHARACTER_REFERENCE',
  'UNKNOWN_LOCATION_REFERENCE',
  'UNKNOWN_ITEM_REFERENCE',
  'UNKNOWN_EVENT_REFERENCE',
  'UNKNOWN_ORGANIZATION_REFERENCE',
  'SEQUENCE_CONFLICT',
  'SEQUENCE_GAP',
  'DUPLICATE_SEQUENCE',
  'DUPLICATE_IDEMPOTENCY_KEY',
  'INVALID_LIFE_STATE_CHANGE',
  'ITEM_OWNERSHIP_CONFLICT',
  'KNOWLEDGE_SOURCE_MISSING',
  'RUMOR_CANNOT_BECOME_FACT',
  'RUMOR_SOURCE_NOT_HELD',
  'PARTICIPANT_MISMATCH',
  'INVALID_EVENT_SHAPE',
  'UNSUPPORTED_SCHEMA_VERSION',
  'INVALID_FACT_SUBJECT',
  'CHARACTER_STATE_PRECONDITION_FAILED',
]);

// --- definition -------------------------------------------------------------

const METRIC_SEVERE_CONFLICTS: MetricDefinition = {
  key: 'severe_canon_conflicts',
  prdName: '嚴重 Canon 衝突',
  numerator: 'accepted events carrying at least one severe finding (re-validation, sequence, idempotency, deceased, location)',
  denominator: 'accepted events in the window',
  target: 0,
  direction: 'atMost',
};
const METRIC_REPLAY: MetricDefinition = {
  key: 'replay_consistency',
  prdName: 'Event Replay 一致率',
  numerator: 'world days whose fold digest equals the stored daily snapshot and whose second independent fold equals the first',
  denominator: 'world days carrying a daily snapshot',
  target: 1,
  direction: 'atLeast',
};
const METRIC_SECRET_LEAKS: MetricDefinition = {
  key: 'unsourced_secret_leaks',
  prdName: '無來源秘密洩漏',
  numerator: 'publications containing a secret or private-fact value with no cited event that made it public',
  denominator: 'publications examined',
  target: 0,
  direction: 'atMost',
};
const METRIC_DECEASED: MetricDefinition = {
  key: 'deceased_character_appearances',
  prdName: '死者不合理出場',
  numerator: 'accepted events with a participant who was dead at the event start and is not revived by it',
  denominator: 'accepted events in the window',
  target: 0,
  direction: 'atMost',
};
const METRIC_LOCATION: MetricDefinition = {
  key: 'character_location_conflicts',
  prdName: '角色位置衝突',
  numerator: 'accepted events whose participants are not at the event location after its own movements, or that move a character already moved in that slot',
  denominator: 'accepted events in the window',
  target: 0,
  direction: 'atMost',
};

export const CONTINUITY_EVALUATOR: EvaluatorDefinition = {
  evaluatorId: CONTINUITY_EVALUATOR_ID,
  version: CONTINUITY_EVALUATOR_VERSION,
  metrics: [METRIC_SEVERE_CONFLICTS, METRIC_REPLAY, METRIC_SECRET_LEAKS, METRIC_DECEASED, METRIC_LOCATION],
  score: {
    key: 'continuity_score',
    prdName: 'Continuity Score',
    components: [
      { key: 'canon_integrity', metricKey: METRIC_SEVERE_CONFLICTS.key, weight: 0.3, transform: 'complement' },
      { key: 'replay_integrity', metricKey: METRIC_REPLAY.key, weight: 0.25, transform: 'rate' },
      { key: 'secret_integrity', metricKey: METRIC_SECRET_LEAKS.key, weight: 0.15, transform: 'complement' },
      { key: 'deceased_integrity', metricKey: METRIC_DECEASED.key, weight: 0.15, transform: 'complement' },
      { key: 'location_integrity', metricKey: METRIC_LOCATION.key, weight: 0.15, transform: 'complement' },
    ],
  },
  findingCodes: CONTINUITY_FINDING_CODES,
};

// --- evidence ---------------------------------------------------------------

export type FoldOriginKind = 'genesis' | 'initial_snapshot' | 'daily_snapshot';

/** The projection the world had at the day's start, and where it came from. */
export type FoldOrigin = {
  kind: FoldOriginKind;
  /** The snapshot id or `genesis`. */
  ref: string;
  projection: WorldProjection;
  lastSequenceNumber: number;
};

/** The stored daily snapshot for the evaluated day — the running system's own claim. */
export type SnapshotEvidence = {
  ref: string;
  lastSequenceNumber: number;
  projectionHash: string;
};

/** Public text the world published for the day, with the accepted events it cites. */
export type PublicationEvidence = {
  /** `contentRef` or the row's own stable ref. */
  ref: string;
  text: string;
  citedEventIds: readonly string[];
};

/** A world secret as a needle. Never copied into a finding. */
export type SecretEvidence = { secretId: string; content: string };

export type ContinuityDayEvidence = {
  worldId: string;
  worldDay: number;
  origin: FoldOrigin;
  /** The day's accepted events, ascending by sequence number. */
  events: readonly AcceptedEvent[];
  /** The world's rule context, as the commit pipeline loads it. `null` for an unseeded world. */
  ruleContext: CanonRuleContext | null;
  snapshot: SnapshotEvidence | null;
  publications: readonly PublicationEvidence[];
  secrets: readonly SecretEvidence[];
};

// --- day report -------------------------------------------------------------

export type ContinuityDayCounts = {
  acceptedEvents: number;
  eventsWithSevereConflict: number;
  eventsWithDeceasedAppearance: number;
  eventsWithLocationConflict: number;
  /** `null` when the day carries no snapshot to compare against. */
  replayConsistent: boolean | null;
  publicationsExamined: number;
  publicationsLeaking: number;
};

export type ContinuityDayReport = {
  worldId: string;
  worldDay: number;
  originKind: FoldOriginKind;
  originRef: string;
  /** Digest of the projection after the fold — the next day's origin, and the replay evidence. */
  foldDigest: string;
  counts: ContinuityDayCounts;
  findings: readonly QualityFinding[];
  /** The folded projection, so a caller chaining days does not fold twice. Not part of any digest. */
  endProjection: WorldProjection;
};

/**
 * Fold one event, or report why it could not be folded.
 *
 * The reducer raises a `CanonError` on a sequence gap or repeat — exactly the evidence
 * `SEQUENCE_NOT_DENSE` describes — so the fold must not be allowed to throw past the evaluator.
 * On refusal the projection is returned unchanged and the code is surfaced to the caller.
 */
function foldOne(projection: WorldProjection, event: AcceptedEvent): { next: WorldProjection; refused: string | null } {
  try {
    return { next: replayWorldEvents(projection, [event]), refused: null };
  } catch (error) {
    return { next: projection, refused: error instanceof CanonError ? error.error.code : 'REPLAY_FOLD_THREW' };
  }
}

/** Fold a whole day the way {@link evaluateContinuityDay} does, skipping refused events. */
function foldAll(origin: WorldProjection, events: readonly AcceptedEvent[]): WorldProjection {
  let projection = cloneProjection(origin);
  for (const event of events) projection = foldOne(projection, event).next;
  return projection;
}

const acceptedAsProposed = (event: AcceptedEvent): ProposedEvent => ({
  schemaVersion: event.schemaVersion, worldId: event.worldId, idempotencyKey: event.idempotencyKey,
  proposedBy: event.proposedBy, worldDay: event.worldDay, timeSlot: event.timeSlot, eventType: event.eventType,
  locationId: event.locationId, participantIds: [...event.participantIds],
  causedByEventIds: [...event.causedByEventIds], publicSummary: event.publicSummary,
  stateChanges: structuredClone(event.stateChanges), metadata: event.metadata,
});

const eventRef = (event: AcceptedEvent, code?: string): EvidenceRef => ({
  kind: 'accepted_event', id: event.eventId, worldDay: event.worldDay, ...(code ? { code } : {}),
});

/** The needles a leak scan looks for: secret contents and private fact values, by id. */
function privateNeedles(
  secrets: readonly SecretEvidence[],
  projection: WorldProjection,
): Array<{ id: string; needle: string; kind: 'secret' | 'private_fact' }> {
  const needles: Array<{ id: string; needle: string; kind: 'secret' | 'private_fact' }> = [];
  for (const secret of secrets) {
    if (secret.content.length >= MIN_SECRET_NEEDLE_LENGTH) needles.push({ id: secret.secretId, needle: secret.content, kind: 'secret' });
  }
  for (const fact of projection.facts) {
    if (fact.visibility !== 'private' || typeof fact.value !== 'string') continue;
    if (fact.value.length >= MIN_SECRET_NEEDLE_LENGTH) needles.push({ id: fact.factId, needle: fact.value, kind: 'private_fact' });
  }
  return needles;
}

/** Whether one of the cited events made `needle` public through a public fact. */
function sourcedByCitedEvent(needle: string, cited: readonly AcceptedEvent[]): boolean {
  return cited.some((event) => event.stateChanges.some((change) =>
    change.type === 'fact_created' && change.visibility === 'public'
    && typeof change.value === 'string' && change.value.includes(needle)));
}

/**
 * Evaluate one world day. Pure and total: malformed evidence yields findings, not throws, because
 * a metric that throws is a metric that stops the pipeline it is measuring. The first version
 * broke that promise — `replayWorldEvents` raises on a sequence gap, which is the exact evidence
 * `SEQUENCE_NOT_DENSE` exists to describe — and the fold is now guarded (`foldOne`).
 */
export function evaluateContinuityDay(evidence: ContinuityDayEvidence): ContinuityDayReport {
  const { worldId, worldDay, origin, events, ruleContext, snapshot, publications, secrets } = evidence;
  const findings: QualityFinding[] = [];
  const severeEvents = new Set<string>();
  const deceasedEvents = new Set<string>();
  const locationEvents = new Set<string>();

  const push = (code: ContinuityFindingCode, subjectId: string, evidenceRefs: EvidenceRef[], detail: string) => {
    findings.push({ code, severity: CONTINUITY_FINDING_CODES[code], subjectId, worldDay, evidence: evidenceRefs, detail });
  };

  // Everything an event may legally reference: every accepted event before it, by derived id.
  // Ids are derived from `(worldId, sequenceNumber)`, so the set is exact without reading rows.
  const knownEventIds: string[] = [];
  for (let sequence = 0; sequence <= origin.lastSequenceNumber; sequence += 1) {
    knownEventIds.push(deriveEventId(worldId, sequence));
  }
  const alive = (projection: WorldProjection, characterId: string): boolean =>
    projection.characterAlive[characterId] ?? ruleContext?.initialCharacterAlive?.[characterId] ?? true;

  let projection = cloneProjection(origin.projection);
  const seenKeys = new Set<string>();
  const movedThisSlot = new Map<string, Set<string>>();
  let expectedSequence = origin.lastSequenceNumber + 1;

  for (const event of events) {
    const refs = [eventRef(event)];
    // --- append-only invariants ---------------------------------------------
    if (event.sequenceNumber !== expectedSequence) {
      push('SEQUENCE_NOT_DENSE', event.eventId, refs,
        `expected sequence ${expectedSequence}, accepted log carries ${event.sequenceNumber}`);
      severeEvents.add(event.eventId);
    }
    expectedSequence = event.sequenceNumber + 1;
    if (seenKeys.has(event.idempotencyKey)) {
      push('DUPLICATE_IDEMPOTENCY_KEY', event.eventId, refs, 'idempotency key was accepted twice inside the day');
      severeEvents.add(event.eventId);
    }
    seenKeys.add(event.idempotencyKey);

    // --- independent re-validation ------------------------------------------
    const proposed = acceptedAsProposed(event);
    const structural = validateEventStructure(proposed);
    const canon = structural ?? validateCanon(proposed, projection, {
      ...(ruleContext ?? { worldId, rules: [] }),
      knownEventIds,
    });
    if (canon) {
      const severe = SEVERE_CANON_CODES.has(canon.code);
      push(severe ? 'SEVERE_CANON_CONFLICT' : 'CANON_CONFLICT', event.eventId,
        [eventRef(event, canon.code), { kind: 'validation', id: `${event.eventId}:revalidation`, code: canon.code, worldDay }],
        `re-validation under ${CANON_VALIDATION_VERSION} returned ${canon.code}${canon.path ? ` at ${canon.path}` : ''}`);
      if (severe) severeEvents.add(event.eventId);
    }

    // --- deceased appearance (independent of the validator) -----------------
    if (!isSupersedingEventType(event.eventType)) {
      for (const characterId of event.participantIds) {
        if (alive(projection, characterId)) continue;
        const revived = event.stateChanges.some((change) =>
          change.type === 'character_life_changed' && change.characterId === characterId && change.alive);
        if (revived) continue;
        push('DECEASED_CHARACTER_APPEARANCE', event.eventId, [eventRef(event), { kind: 'accepted_event', id: characterId }],
          `participant ${characterId} was dead at the start of ${event.eventId}`);
        deceasedEvents.add(event.eventId);
        severeEvents.add(event.eventId);
      }
    }

    // --- fold -----------------------------------------------------------------
    const { next, refused } = foldOne(projection, event);
    if (refused !== null) {
      push('REPLAY_FOLD_FAILED', event.eventId, [eventRef(event, refused), { kind: 'replay', id: `${worldId}:${worldDay}`, worldDay, code: refused }],
        `the reducer refused ${event.eventId} with ${refused}; the day was folded without it`);
      severeEvents.add(event.eventId);
    }

    // --- location conflict (independent of the validator) -------------------
    const slotKey = `${event.worldDay}:${event.timeSlot}`;
    const moved = movedThisSlot.get(slotKey) ?? new Set<string>();
    for (const change of event.stateChanges) {
      if (change.type !== 'character_location_changed') continue;
      if (moved.has(change.characterId)) {
        push('CHARACTER_DOUBLE_MOVEMENT', event.eventId, [eventRef(event), { kind: 'accepted_event', id: change.characterId }],
          `${change.characterId} was moved twice in slot ${slotKey}`);
        locationEvents.add(event.eventId);
        severeEvents.add(event.eventId);
      }
      moved.add(change.characterId);
    }
    movedThisSlot.set(slotKey, moved);
    if (event.locationId !== undefined && !isSupersedingEventType(event.eventType)) {
      for (const characterId of event.participantIds) {
        // Canon places a character on their first movement; before that the seed says where they
        // are. A character neither Canon nor the seed has placed has no location to conflict with.
        const where = next.characterLocations[characterId] ?? ruleContext?.initialCharacterLocations?.[characterId];
        if (where === undefined || where === event.locationId) continue;
        push('CHARACTER_LOCATION_CONFLICT', event.eventId, [eventRef(event), { kind: 'accepted_event', id: characterId }],
          `participant ${characterId} is at ${where} after ${event.eventId}, which took place at ${event.locationId}`);
        locationEvents.add(event.eventId);
        severeEvents.add(event.eventId);
      }
    }

    knownEventIds.push(event.eventId);
    projection = next;
  }

  // --- replay consistency ---------------------------------------------------
  const foldDigest = projectionIntegrityHash(projection);
  const secondFold = foldAll(origin.projection, structuredClone([...events]));
  const secondDigest = projectionIntegrityHash(secondFold);
  let replayConsistent: boolean | null = null;
  if (secondDigest !== foldDigest) {
    push('REPLAY_NONDETERMINISTIC', `${worldId}:${worldDay}`, [{ kind: 'replay', id: `${worldId}:${worldDay}`, worldDay }],
      `two folds of the same ${events.length} events produced ${foldDigest} and ${secondDigest}`);
    replayConsistent = snapshot ? false : null;
  }
  if (snapshot) {
    const lastSequence = events.length > 0 ? events[events.length - 1].sequenceNumber : origin.lastSequenceNumber;
    const snapshotRef: EvidenceRef = { kind: 'snapshot', id: snapshot.ref, worldDay };
    if (snapshot.lastSequenceNumber !== lastSequence) {
      push('REPLAY_SNAPSHOT_SEQUENCE_MISMATCH', snapshot.ref, [snapshotRef],
        `snapshot claims sequence ${snapshot.lastSequenceNumber}; the day's last accepted event is ${lastSequence}`);
      replayConsistent = false;
    } else if (snapshot.projectionHash !== foldDigest) {
      push('REPLAY_SNAPSHOT_MISMATCH', snapshot.ref, [snapshotRef, { kind: 'replay', id: `${worldId}:${worldDay}`, worldDay }],
        `fold from ${origin.kind} ${origin.ref} produced ${foldDigest}; stored snapshot carries ${snapshot.projectionHash}`);
      replayConsistent = false;
    } else if (replayConsistent === null) {
      replayConsistent = true;
    }
  }

  // --- unsourced secret leaks -----------------------------------------------
  const needles = privateNeedles(secrets, projection);
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  let publicationsLeaking = 0;
  for (const publication of publications) {
    const cited = publication.citedEventIds.flatMap((eventId) => {
      const event = eventsById.get(eventId);
      return event ? [event] : [];
    });
    let leaked = false;
    for (const { id, needle, kind } of needles) {
      if (!publication.text.includes(needle)) continue;
      if (sourcedByCitedEvent(needle, cited)) continue;
      leaked = true;
      push('UNSOURCED_SECRET_LEAK', publication.ref,
        [{ kind: 'publication', id: publication.ref, worldDay }, { kind: 'accepted_event', id, code: kind }],
        `${kind} ${id} appears in ${publication.ref} and none of its ${publication.citedEventIds.length} cited events made it public`);
    }
    if (leaked) publicationsLeaking += 1;
  }

  return {
    worldId, worldDay, originKind: origin.kind, originRef: origin.ref, foldDigest,
    counts: {
      acceptedEvents: events.length,
      eventsWithSevereConflict: severeEvents.size,
      eventsWithDeceasedAppearance: deceasedEvents.size,
      eventsWithLocationConflict: locationEvents.size,
      replayConsistent,
      publicationsExamined: publications.length,
      publicationsLeaking,
    },
    findings: dedupeFindings(findings),
    endProjection: projection,
  };
}

// --- window summary ---------------------------------------------------------

export type ContinuitySummaryInput = {
  worldId: string;
  fromWorldDay: number;
  toWorldDay: number;
  days: readonly ContinuityDayReport[];
  scanLimitReached: boolean;
};

/** Fold day reports into the §16.2 metrics and the Continuity Score. */
export function summarizeContinuity(input: ContinuitySummaryInput): EvaluationReport {
  const days = [...input.days].sort((left, right) => left.worldDay - right.worldDay);
  const evaluatedDays = uniqueDays(days.map(({ worldDay }) => worldDay));
  const inWindow = days.filter(({ worldDay }) => worldDay >= input.fromWorldDay && worldDay <= input.toWorldDay);

  const acceptedEvents = inWindow.reduce((total, day) => total + day.counts.acceptedEvents, 0);
  const severe = inWindow.reduce((total, day) => total + day.counts.eventsWithSevereConflict, 0);
  const deceased = inWindow.reduce((total, day) => total + day.counts.eventsWithDeceasedAppearance, 0);
  const location = inWindow.reduce((total, day) => total + day.counts.eventsWithLocationConflict, 0);
  const daysWithSnapshot = inWindow.filter((day) => day.counts.replayConsistent !== null);
  const daysConsistent = daysWithSnapshot.filter((day) => day.counts.replayConsistent === true);
  const daysWithoutSnapshot = inWindow.length - daysWithSnapshot.length;
  const publications = inWindow.reduce((total, day) => total + day.counts.publicationsExamined, 0);
  const leaking = inWindow.reduce((total, day) => total + day.counts.publicationsLeaking, 0);

  const metrics = [
    observeMetric(METRIC_SEVERE_CONFLICTS, severe, acceptedEvents),
    observeMetric(METRIC_REPLAY, daysConsistent.length, daysWithSnapshot.length, daysWithoutSnapshot,
      daysWithoutSnapshot === 0 ? null : 'world days with accepted events but no daily snapshot to replay against'),
    observeMetric(METRIC_SECRET_LEAKS, leaking, publications),
    observeMetric(METRIC_DECEASED, deceased, acceptedEvents),
    observeMetric(METRIC_LOCATION, location, acceptedEvents),
  ];

  const allDays: number[] = [];
  for (let day = input.fromWorldDay; day <= input.toWorldDay; day += 1) allDays.push(day);
  const evaluatedSet = new Set(evaluatedDays);

  return finishReport({
    evaluatorId: CONTINUITY_EVALUATOR_ID,
    evaluatorVersion: CONTINUITY_EVALUATOR_VERSION,
    worldId: input.worldId,
    window: { fromWorldDay: input.fromWorldDay, toWorldDay: input.toWorldDay },
    metrics,
    score: composeScore(CONTINUITY_EVALUATOR.score!, metrics),
    findings: dedupeFindings(inWindow.flatMap((day) => day.findings)),
    coverage: {
      worldDaysEvaluated: evaluatedDays.filter((day) => day >= input.fromWorldDay && day <= input.toWorldDay),
      worldDaysWithoutEvidence: allDays.filter((day) => !evaluatedSet.has(day)),
      scanLimitReached: input.scanLimitReached,
    },
  });
}

/**
 * Evaluate consecutive days, chaining each day's folded projection into the next day's origin.
 *
 * `daysAreConsecutive` is not assumed: a day absent from `evidenceByDay` (no accepted events) is
 * skipped and the projection carries across it unchanged — a quiet day cannot break the chain,
 * and it is reported by `summarizeContinuity` as a day without evidence rather than as a fault.
 */
export function evaluateContinuityWindow(input: {
  worldId: string;
  fromWorldDay: number;
  toWorldDay: number;
  origin: FoldOrigin;
  ruleContext: CanonRuleContext | null;
  secrets: readonly SecretEvidence[];
  eventsByDay: ReadonlyMap<number, readonly AcceptedEvent[]>;
  snapshotByDay: ReadonlyMap<number, SnapshotEvidence>;
  publicationsByDay: ReadonlyMap<number, readonly PublicationEvidence[]>;
  scanLimitReached: boolean;
}): EvaluationReport {
  const days: ContinuityDayReport[] = [];
  let origin = input.origin;
  for (let worldDay = input.fromWorldDay; worldDay <= input.toWorldDay; worldDay += 1) {
    const events = input.eventsByDay.get(worldDay);
    if (!events || events.length === 0) continue;
    const report = evaluateContinuityDay({
      worldId: input.worldId, worldDay, origin, events,
      ruleContext: input.ruleContext,
      snapshot: input.snapshotByDay.get(worldDay) ?? null,
      publications: input.publicationsByDay.get(worldDay) ?? [],
      secrets: input.secrets,
    });
    days.push(report);
    origin = {
      kind: origin.kind, ref: origin.ref, projection: report.endProjection,
      lastSequenceNumber: events[events.length - 1].sequenceNumber,
    };
  }
  return summarizeContinuity({
    worldId: input.worldId, fromWorldDay: input.fromWorldDay, toWorldDay: input.toWorldDay,
    days, scanLimitReached: input.scanLimitReached,
  });
}
