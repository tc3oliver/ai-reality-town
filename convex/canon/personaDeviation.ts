/**
 * Persona-deviation detection and character summaries (FR-B003 / ART-11).
 *
 * ## Decision: detection is STRUCTURAL, never a reading of the persona prose
 *
 * A seeded persona is mostly free text — `personalityTraits`, `values`, `behaviorRules`,
 * `publicGoal`, `fear`. The obvious implementation compares that text against the event's
 * `reason` and `publicSummary` strings and decides whether the character "acted out of
 * character". That was rejected outright. It would be a second, unversioned classifier whose
 * verdict nobody can reproduce, it would drift the moment a seed is reworded, and — decisively —
 * the strings it would judge are written by the very provider whose output is being judged. A
 * provider that learns the phrasing walks straight through the gate. `docs/proposed-event-review.md`
 * already names that failure mode for rejection reasons ("never reads, parses, or pattern-matches
 * a free-text error message"); the same rule applies here.
 *
 * So a deviation is only ever detected from data Canon can check itself: the character's own
 * projected state (FR-B001), their projected directional relationships (FR-B002), and the seeded
 * structural anchors — `occupation` and `organizationIds`. Every signal below is a comparison
 * between two values the world already holds. None of them can be talked out of.
 *
 * The cost is honest and worth stating: this cannot see a character betraying a `behaviorRule` in
 * dialogue alone. Nothing in Canon records that, and inventing it here would be asserting a world
 * fact nobody accepted. What Canon *does* record is when someone abandons their trade, walks out
 * on their faction, or inverts how they feel about another person — and those are precisely the
 * "重大行動" (major actions) the requirement is about.
 *
 * ## Decision: an LLM cannot declare its own deviation away
 *
 * The alternative shape was a `personaDeviation` field on the proposal, filled in by the proposer.
 * That makes AC#1 a claim rather than a guarantee: an unflagged proposal would prove only that the
 * proposer did not flag it. Detection here is computed FROM the proposal, never read OFF it, so a
 * proposal cannot suppress its own flag. Justifications are held to the same rule — each one is a
 * second structured state change in the SAME event, not an assertion about it.
 *
 * ## Decision: flags and summaries are a PROJECTION, not a table
 *
 * A flag is a pure function of (accepted event, prior projection, seeded anchor), so it is
 * recomputable at any time and replays exactly. Storing it would create a second record that can
 * disagree with Canon, would need back-filling onto existing history, and would have to be kept
 * consistent across snapshot restore. {@link buildCharacterSummaries} derives it instead, which is
 * why this task changes no table and does not bump the snapshot version.
 *
 * ## Privacy
 *
 * A summary is INTERNAL. Its flags carry the structured detail of who a character turned on and how
 * far — the same class of information `RelationshipHistoryEntry` is already marked private for.
 * Nothing here may be projected into a public read model; `personaDeviation.boundary.test.ts` pins
 * that.
 *
 * Pure module: no Convex, no clock, no randomness. Identical input always yields identical output.
 */

import { RELATIONSHIP_MAX, RELATIONSHIP_MIN } from '../shared/constants';
import { relationshipKey } from '../shared/ids';
import { isSupersedingEventType, type TimeSlot } from './eventTypes';
import type { AcceptedEvent, ProposedEvent, StateChange, WorldProjection } from './model';
import { reduceWorldEvent } from './reducer';

/**
 * The seeded persona fields a deviation is measured against.
 *
 * `occupation` and `organizationIds` are the only two the detector reads, because they are the only
 * two the projection also tracks — a comparison needs both halves. `personalityTraits` and `values`
 * ride along so a summary is readable on its own: a character summary that cannot say who the
 * character started as is not a summary. `privateProfile`, `privateGoal`, `fear` and `behaviorRules`
 * are deliberately absent — nothing here uses them, and copying private seed text into a derived
 * structure widens its blast radius for no gain.
 */
export type PersonaAnchor = {
  characterId: string;
  occupation: string;
  organizationIds: readonly string[];
  personalityTraits: readonly string[];
  values: readonly string[];
};

/**
 * Relationship dimensions whose SIGN carries meaning, so that crossing zero is a reversal.
 *
 * `familiarity` is excluded. The seed bounds it to 0..100 (`characterSeed.ts`) because knowing
 * someone is a quantity, not a direction: "negative familiarity" has no reading, so a sign flip in
 * it would be an artefact of the reducer's shared clamp rather than a fact about anyone.
 */
export const PERSONA_SIGNED_RELATIONSHIP_DIMENSIONS = [
  'trust', 'affection', 'resentment', 'fear', 'dependency',
] as const;
export type PersonaRelationshipDimension = (typeof PERSONA_SIGNED_RELATIONSHIP_DIMENSIONS)[number];

/**
 * How far one event must move a relationship dimension before it counts as a major action.
 *
 * The dimensions run -100..100, so this is a fifth of the full range inside a single scene. Below
 * it a relationship is drifting, which is what relationships are supposed to do; at or above it the
 * world is asserting that someone changed their mind about another person in one moment. The
 * existing producers move relationships by 1–5 per scene (`fakeProvider`, `fakeSceneNarrator`,
 * `mistwoodFixture`), so ordinary play never approaches this.
 */
export const PERSONA_SIGNIFICANT_RELATIONSHIP_SWING = 40;

/**
 * How important a subjective memory must be to count as a growth/breakdown marker.
 *
 * `importance` is validated to 0..1 (`validators.ts`). 0.7 asks for a memory the world itself
 * treated as formative rather than merely notable — ART-25 memories are formed constantly, and a
 * lower bar would let any recorded memory launder any reversal.
 */
export const PERSONA_MARKER_MIN_MEMORY_IMPORTANCE = 0.7;

/**
 * `reversal` inverts who the character was; `deviation` strains it.
 *
 * The distinction is what AC#2's two arms hang on, so it is structural rather than a judgement
 * call: a reversal is a state crossing an anchor (leaving your trade, leaving your faction, or
 * inverting the sign of how you feel about someone), and a deviation is a large move that stays on
 * the same side of it.
 */
export type PersonaDeviationSeverity = 'deviation' | 'reversal';

/**
 * A detected departure from persona. A typed union rather than a `{ kind, detail }` bag, for the
 * same reason `StateChange` is one: each variant's evidence is different, and a reader of a flag
 * should not have to guess which keys are populated.
 */
export type PersonaDeviationSignal =
  | {
      kind: 'occupation_abandoned';
      severity: 'reversal';
      /** The occupation the character held, which is also their seeded anchor. */
      from: string;
      to: string;
    }
  | {
      kind: 'seeded_organization_left';
      severity: 'reversal';
      /** Seeded memberships this event drops, sorted so a rebuild is identical. */
      organizationIds: string[];
    }
  | {
      kind: 'relationship_polarity_reversed';
      severity: 'reversal';
      targetCharacterId: string;
      dimension: PersonaRelationshipDimension;
      from: number;
      to: number;
    }
  | {
      kind: 'relationship_swing';
      severity: 'deviation';
      targetCharacterId: string;
      dimension: PersonaRelationshipDimension;
      from: number;
      to: number;
    };

/**
 * The four supports FR-B003 requires behind a deviating major action, each narrowed to something
 * Canon can witness inside the same event:
 *
 * - `emotional_change` (明確情緒變化) — a `character_state_changed` on `emotion` for this character.
 *   Canon already refuses a no-op state change, so its presence means the emotion really moved.
 * - `major_event_cause` (重大事件原因) — a cited `causedByEventIds` entry that this character was a
 *   participant in. Citing *any* accepted event is a bar a provider clears by naming the last thing
 *   that happened; requiring the cause to have materially involved the character is not.
 * - `goal_conflict` (目標衝突) — an adversarial relationship change (trust down or resentment up)
 *   toward a co-participant, recorded by a DIFFERENT state change than the one that raised the
 *   signal. Without that exclusion a trust reversal would justify itself, because a trust reversal
 *   is itself trust going down. This is a narrowing of the PRD bullet, and it is stated as one:
 *   Canon cannot see two goals colliding, only two people's standing changing over it.
 * - `growth_or_breakdown` (角色成長或崩潰標記) — a `character_memory_formed` for this character at or
 *   above {@link PERSONA_MARKER_MIN_MEMORY_IMPORTANCE}. This is ART-25's own mechanism for exactly
 *   the marker the requirement names.
 *
 * Any ONE of them supports the action. The PRD lists alternatives, not a conjunction — a character
 * can break under a single blow without also changing jobs over it.
 */
export const PERSONA_JUSTIFICATIONS = [
  'emotional_change', 'major_event_cause', 'goal_conflict', 'growth_or_breakdown',
] as const;
export type PersonaJustification = (typeof PERSONA_JUSTIFICATIONS)[number];

/**
 * What Canon should do about one character's deviation in one event.
 *
 * `flag` commits and records. `reject` and `review` both refuse the proposal — the difference is
 * the stable code the operator sees, not whether the event enters Canon.
 */
export type PersonaDeviationOutcome = 'flag' | 'review' | 'reject';

export type PersonaDeviationAssessment = {
  characterId: string;
  severity: PersonaDeviationSeverity;
  signals: PersonaDeviationSignal[];
  justifications: PersonaJustification[];
  outcome: PersonaDeviationOutcome;
};

/** A recorded high-importance deviation, positioned in world time by the event that carried it. */
export type PersonaDeviationFlag = {
  characterId: string;
  eventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: TimeSlot;
  severity: PersonaDeviationSeverity;
  signals: PersonaDeviationSignal[];
  justifications: PersonaJustification[];
  /** True when this flag revised who the character is; see {@link isPersonaTurningPoint}. */
  turningPoint: boolean;
};

/**
 * Who a character was, and every accepted moment that changed them.
 *
 * Deliberately does NOT restate current occupation, location or emotion: FR-B001's
 * `characterStates` already projects those from the same events, and a second copy would be a
 * second thing to keep true.
 */
export type CharacterSummary = {
  characterId: string;
  anchor: PersonaAnchor;
  /**
   * 1 for the seeded persona, incremented once per turning point. AC#3's "the summary was
   * refreshed" is observable from this number alone, without diffing the flag list.
   */
  version: number;
  /** Every flagged deviation, oldest first. */
  flags: PersonaDeviationFlag[];
  /** The event that last revised this summary, or null while the seeded anchor still stands. */
  lastTurningPointEventId: string | null;
};

/** Context a persona assessment needs beyond the projection. */
export type PersonaAssessmentContext = {
  /** Seeded anchors by character id. A character with no anchor is never assessed. */
  anchors: Record<string, PersonaAnchor>;
  /**
   * `eventId -> participants` for already-accepted events, used to decide whether a cited cause
   * materially involved the deviating character. Absent means no cause can be corroborated, so
   * `major_event_cause` never fires — a caller that cannot prove the link must not assume it.
   */
  eventParticipants?: Record<string, readonly string[]>;
};

const NEUTRAL = 0;

function clampRelationship(value: number): number {
  if (value < RELATIONSHIP_MIN) return RELATIONSHIP_MIN;
  if (value > RELATIONSHIP_MAX) return RELATIONSHIP_MAX;
  return value;
}

function relationshipDelta(
  change: Extract<StateChange, { type: 'relationship_changed' }>,
  dimension: PersonaRelationshipDimension,
): number {
  switch (dimension) {
    case 'trust': return change.trustDelta;
    case 'affection': return change.affectionDelta;
    case 'resentment': return change.resentmentDelta;
    case 'fear': return change.fearDelta ?? 0;
    case 'dependency': return change.dependencyDelta ?? 0;
  }
}

function asString(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: string | boolean | string[] | undefined): string[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** Signals raised by one state change for one anchored character. */
function signalsForChange(
  change: StateChange,
  characterId: string,
  anchor: PersonaAnchor,
  projection: WorldProjection,
): PersonaDeviationSignal[] {
  if (change.type === 'character_state_changed' && change.characterId === characterId) {
    if (change.field === 'occupation') {
      const current = projection.characterStates[characterId]?.occupation ?? anchor.occupation;
      const next = asString(change.toValue);
      // Only a departure FROM the anchor counts. Once a character has already left their seeded
      // trade the anchor is spent, and re-flagging every later job move would turn the flag into a
      // change log — the requirement is about departing from persona, not about churn.
      if (next !== undefined && current === anchor.occupation && next !== anchor.occupation) {
        return [{ kind: 'occupation_abandoned', severity: 'reversal', from: current, to: next }];
      }
      return [];
    }
    if (change.field === 'organization_memberships') {
      const current = projection.characterStates[characterId]?.organizationMemberships
        ?? [...anchor.organizationIds];
      const next = asStringArray(change.toValue);
      if (next === undefined) return [];
      const dropped = anchor.organizationIds
        .filter((id) => current.includes(id) && !next.includes(id))
        .slice()
        .sort();
      return dropped.length === 0
        ? []
        : [{ kind: 'seeded_organization_left', severity: 'reversal', organizationIds: dropped }];
    }
    return [];
  }

  if (change.type === 'relationship_changed' && change.sourceCharacterId === characterId) {
    const prior = projection.relationships[relationshipKey(characterId, change.targetCharacterId)];
    const signals: PersonaDeviationSignal[] = [];
    for (const dimension of PERSONA_SIGNED_RELATIONSHIP_DIMENSIONS) {
      const delta = relationshipDelta(change, dimension);
      if (Math.abs(delta) < PERSONA_SIGNIFICANT_RELATIONSHIP_SWING) continue;
      const from = prior?.[dimension] ?? NEUTRAL;
      const to = clampRelationship(from + delta);
      // A first-ever relationship starts at neutral, so it has no polarity to invert. Recording one
      // at -60 is a strong characterisation, not a reversal of anything.
      const inverted = from !== NEUTRAL && to !== NEUTRAL && (from > 0) !== (to > 0);
      signals.push(inverted
        ? {
            kind: 'relationship_polarity_reversed', severity: 'reversal',
            targetCharacterId: change.targetCharacterId, dimension, from, to,
          }
        : {
            kind: 'relationship_swing', severity: 'deviation',
            targetCharacterId: change.targetCharacterId, dimension, from, to,
          });
    }
    return signals;
  }

  return [];
}

function justificationsFor(
  event: ProposedEvent,
  characterId: string,
  signalChangeIndexes: ReadonlySet<number>,
  context: PersonaAssessmentContext,
): PersonaJustification[] {
  const participants = new Set(event.participantIds);
  const found = new Set<PersonaJustification>();

  for (const [index, change] of event.stateChanges.entries()) {
    if (change.type === 'character_state_changed'
      && change.characterId === characterId && change.field === 'emotion') {
      found.add('emotional_change');
    }
    if (change.type === 'character_memory_formed'
      && change.characterId === characterId
      && change.importance >= PERSONA_MARKER_MIN_MEMORY_IMPORTANCE) {
      found.add('growth_or_breakdown');
    }
    if (change.type === 'relationship_changed'
      && change.sourceCharacterId === characterId
      && !signalChangeIndexes.has(index)
      && participants.has(change.targetCharacterId)
      && (change.trustDelta < 0 || change.resentmentDelta > 0)) {
      found.add('goal_conflict');
    }
  }

  const causes = context.eventParticipants;
  if (causes && event.causedByEventIds.some((id) => (causes[id] ?? []).includes(characterId))) {
    found.add('major_event_cause');
  }

  // Emitted in declaration order rather than discovery order, so the same event always produces
  // the same list and a stored comparison never depends on state-change ordering.
  return PERSONA_JUSTIFICATIONS.filter((justification) => found.has(justification));
}

/**
 * A flag revises who the character IS — rather than only recording a hard moment — when it
 * inverted an anchor, or when the world itself recorded the moment as formative.
 *
 * A large same-sign relationship swing is flagged but is not a turning point: trusting someone you
 * already trusted rather more is a big move within the character, not a new character.
 */
export function isPersonaTurningPoint(assessment: PersonaDeviationAssessment): boolean {
  return assessment.severity === 'reversal'
    || assessment.justifications.includes('growth_or_breakdown');
}

/**
 * Assess one proposed or accepted event against the seeded personas and the projection as it
 * stands BEFORE that event.
 *
 * Returns one assessment per deviating character, ordered by character id so that two runs over
 * the same history produce identical output.
 *
 * Superseding remediation events (`correction`, `retcon`) are exempt, for the reason `validateCanon`
 * already exempts them from the forward-only transition rules: they restate what the record should
 * have said. Judging a correction as a persona deviation would report that the character changed
 * when in fact only the account of them was fixed. The exemption lives here rather than in the gate
 * so the gate and the summary can never disagree about it.
 */
export function assessPersonaDeviations(
  event: ProposedEvent,
  projection: WorldProjection,
  context: PersonaAssessmentContext,
): PersonaDeviationAssessment[] {
  if (isSupersedingEventType(event.eventType)) return [];

  const signalsByCharacter = new Map<string, PersonaDeviationSignal[]>();
  const indexesByCharacter = new Map<string, Set<number>>();

  for (const characterId of [...new Set(event.participantIds)].sort()) {
    const anchor = context.anchors[characterId];
    if (!anchor) continue;
    for (const [index, change] of event.stateChanges.entries()) {
      const signals = signalsForChange(change, characterId, anchor, projection);
      if (signals.length === 0) continue;
      signalsByCharacter.set(characterId, [...(signalsByCharacter.get(characterId) ?? []), ...signals]);
      indexesByCharacter.set(characterId, (indexesByCharacter.get(characterId) ?? new Set()).add(index));
    }
  }

  const assessments: PersonaDeviationAssessment[] = [];
  for (const [characterId, signals] of signalsByCharacter) {
    const severity: PersonaDeviationSeverity =
      signals.some((signal) => signal.severity === 'reversal') ? 'reversal' : 'deviation';
    const justifications = justificationsFor(
      event, characterId, indexesByCharacter.get(characterId) ?? new Set(), context,
    );
    const outcome: PersonaDeviationOutcome = justifications.length > 0
      ? 'flag'
      : severity === 'reversal' ? 'reject' : 'review';
    assessments.push({ characterId, severity, signals, justifications, outcome });
  }
  return assessments;
}

/**
 * Build a summary per anchored character by folding accepted events.
 *
 * Mirrors `replayWorldEvents`: same starting projection, no reordering, no filtering, no mutation
 * of the inputs. Each event is assessed against the projection as it stood before that event —
 * the same view the commit gate had — so a rebuilt summary always agrees with the decision that
 * was actually made.
 *
 * History committed before this gate existed can contain deviations with no justification. They are
 * recorded as flags with an empty `justifications` list rather than dropped or retro-rejected:
 * accepted history is never re-judged, and a summary that hid them would be the less honest of the
 * two options.
 */
export function buildCharacterSummaries(
  initialProjection: WorldProjection,
  events: readonly AcceptedEvent[],
  anchors: Record<string, PersonaAnchor>,
): Record<string, CharacterSummary> {
  const summaries: Record<string, CharacterSummary> = Object.fromEntries(
    Object.entries(anchors).map(([characterId, anchor]) => [characterId, {
      characterId,
      anchor,
      version: 1,
      flags: [],
      lastTurningPointEventId: null,
    }]),
  );

  const eventParticipants: Record<string, readonly string[]> = {};
  let projection = initialProjection;
  for (const event of events) {
    const assessments = assessPersonaDeviations(event, projection, { anchors, eventParticipants });
    for (const assessment of assessments) {
      const summary = summaries[assessment.characterId];
      if (!summary) continue;
      const turningPoint = isPersonaTurningPoint(assessment);
      summary.flags.push({
        characterId: assessment.characterId,
        eventId: event.eventId,
        sequenceNumber: event.sequenceNumber,
        worldDay: event.worldDay,
        timeSlot: event.timeSlot,
        severity: assessment.severity,
        signals: assessment.signals,
        justifications: assessment.justifications,
        turningPoint,
      });
      if (turningPoint) {
        summary.version += 1;
        summary.lastTurningPointEventId = event.eventId;
      }
    }
    eventParticipants[event.eventId] = event.participantIds;
    projection = reduceWorldEvent(projection, event);
  }

  return summaries;
}

/**
 * Read a {@link PersonaAnchor} out of an untyped seeded character payload.
 *
 * Returns null rather than throwing when the payload is unusable. A world seeded by an older
 * bundle, or not seeded at all, must leave the gate inert rather than make every commit fail:
 * refusing to validate is a far worse failure than not detecting a deviation, and FR-B003 is a
 * quality gate rather than an integrity one.
 */
export function personaAnchorFromSeed(characterId: string, payload: unknown): PersonaAnchor | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const occupation = record.occupation;
  if (typeof occupation !== 'string' || occupation.length === 0) return null;
  const strings = (value: unknown): string[] => (Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []);
  return {
    characterId,
    occupation,
    organizationIds: strings(record.organizationIds),
    personalityTraits: strings(record.personalityTraits),
    values: strings(record.values),
  };
}
