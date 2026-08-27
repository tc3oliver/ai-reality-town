/**
 * Causal viewer-intervention consequence tracking (PRD 1.0 §13.13 Epic J, FR-J002 / ART-46).
 *
 * AC#1 — the projection names the winning viewer-triggered event, its direct effects, the
 * events downstream of those, and the indirect effects that cannot be confirmed.
 * AC#2 — it never labels all downstream outcomes as directly caused by the vote. The four
 * buckets are built from DIFFERENT evidence and are mutually exclusive, and the two that make a
 * causal claim (`direct`, `downstream`) are built ONLY from `causedByEventIds` edges that Canon
 * actually carries. Nothing is inferred to fill them.
 * AC#3 — every node carries `provenance.sourceEventIds`, and
 * {@link validateVoteConsequenceLinks} refuses a payload whose ids do not all resolve to
 * accepted events.
 *
 * ## The fact this design is built around
 *
 * `canonEvents.causedByEventIds` exists and is fully validated (`convex/canon/validators.ts`),
 * but every event the running system produces has it EMPTY: the vote-injected proposal writes
 * `causedByEventIds: []` (`simulation/worldDayLive.ts`) and the deterministic fake provider
 * always emits `[]`. Canon today is a set of isolated nodes.
 *
 * So this module does not infer causality, and it does not stamp any. On today's real data
 * `direct` and `downstream` come out EMPTY and everything the Director was told about the vote
 * lands in `uncertain` — which is the honest answer, and is what AC#2 asks for. The moment a
 * provider starts emitting real `causedByEventIds`, the same code reports them without changing.
 *
 * ## What each bucket is evidence of
 *
 *   - `trigger`  — basis `vote_idempotency_key`. The accepted event whose own `idempotencyKey`
 *                  carries {@link VIEWER_VOTE_IDEMPOTENCY_PREFIX}, cross-checked against the
 *                  vote ledger's `appliedEventId`. Read off Canon rather than off the side
 *                  table, so the attribution survives replay.
 *   - `direct`   — basis `canon_caused_by`, depth 1. An accepted event whose `causedByEventIds`
 *                  EXPLICITLY contains the trigger's id. A causal claim, made only where Canon
 *                  makes it.
 *   - `downstream` — basis `canon_caused_by`, depth ≥ 2. The transitive closure of the same
 *                  edges. Each node records the actual path it was reached by, so a reader can
 *                  check the claim rather than take it.
 *   - `uncertain` — basis `director_plan_context`. An event whose Scene's Director plan listed
 *                  the trigger in `viewerInterventionEventIds`, and which has NO causal edge to
 *                  the trigger set. This is context MEMBERSHIP — the Director was told the vote
 *                  had happened — and it is emphatically not a causal claim. It is the only
 *                  honest basis for 「尚無法確認的間接影響」.
 *
 * Pure module — no Convex imports, no clock, no randomness, no Canon mutation. Persistence and
 * the safety gate live in {@link ./voteConsequenceProjectionFunctions.ts}.
 */

import { VIEWER_VOTE_IDEMPOTENCY_PREFIX } from '../shared/environmentVoteCatalog';

export const VOTE_CONSEQUENCE_SCHEMA_VERSION = 1;
export const VOTE_CONSEQUENCE_MODEL_KIND = 'voteConsequence' as const;

const VOTE_CONSEQUENCE_BUCKETS = ['trigger', 'direct', 'downstream', 'uncertain'] as const;
export type VoteConsequenceBucket = (typeof VOTE_CONSEQUENCE_BUCKETS)[number];

/**
 * How many world days AFTER the trigger's own day this projection keeps looking for links, and
 * therefore how far back the pipeline re-runs it when a later event commits.
 *
 * Derived, not guessed. The `uncertain` bucket rests on `DirectorPlanContext.viewerInterventionEventIds`,
 * which `buildLiveWorldSnapshot` fills from `acceptedEvents.slice(-RECENT_EVENT_WINDOW)` —
 * `RECENT_EVENT_WINDOW = 10` (`convex/simulation/worldDayLive.ts`). A world day has five time
 * slots, so in normal operation — at least one accepted event per slot — those ten events span
 * about two world days: the trigger's own, and the one after it. Hence a lookahead of 1.
 *
 * Not imported from `simulation`: `publicRead` may not depend on it (see
 * `architecture/module-boundaries.json`), which is the same constraint that put
 * `VIEWER_VOTE_IDEMPOTENCY_PREFIX` in `shared`. `voteConsequenceProjection.test.ts` pins the
 * number so a change to either side is a decision rather than a drift.
 *
 * THIS IS A BOUND, NOT A PROOF. A world running far below one event per slot stretches the
 * Director's ten-event window across more days than this, and a `causedByEventIds` chain can in
 * principle cross any number of days once providers start emitting one. A link outside the
 * window is not reported — see `docs/vote-consequence-tracking.md` §5.
 */
export const VOTE_CONSEQUENCE_LOOKAHEAD_DAYS = 1;

/** What a link is evidence of. Never a free-text explanation — a reader has to be able to check it. */
export const VOTE_CONSEQUENCE_BASES = [
  'vote_idempotency_key',
  'canon_caused_by',
  'director_plan_context',
] as const;
export type VoteConsequenceBasis = (typeof VOTE_CONSEQUENCE_BASES)[number];

export type VoteConsequenceProvenance = {
  basis: VoteConsequenceBasis;
  /** Accepted-event ids that justify this link. Never empty; validated against Canon (AC#3). */
  sourceEventIds: string[];
};

/** One accepted event, as this builder needs it. Assembled by the Convex wiring. */
export type VoteConsequenceEventInput = {
  eventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  idempotencyKey: string;
  causedByEventIds: readonly string[];
  /** Already redacted by the ART-132 safety gate before it reaches here. */
  publicSummary: string | null;
  publicationStatus: 'published' | 'withheld';
  /** `metadata.sceneId`, or null for seed/system events no Scene produced. */
  sceneId: string | null;
};

export type VoteConsequenceNode = {
  eventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  publicSummary: string | null;
  publicationStatus: 'published' | 'withheld';
  bucket: VoteConsequenceBucket;
  /**
   * Causal distance from the trigger along real `causedByEventIds` edges: 0 for the trigger,
   * 1 for a direct effect, ≥ 2 downstream. `null` for `uncertain`, where there is no edge to
   * measure — a number there would be a claim about a relationship nothing recorded.
   */
  depth: number | null;
  /** The actual edge chain trigger → … → this event. Empty for `uncertain`. */
  path: string[];
  provenance: VoteConsequenceProvenance;
};

export type VoteConsequenceProjection = {
  schemaVersion: typeof VOTE_CONSEQUENCE_SCHEMA_VERSION;
  worldId: string;
  targetWorldDay: number;
  trigger: VoteConsequenceNode | null;
  direct: VoteConsequenceNode[];
  downstream: VoteConsequenceNode[];
  uncertain: VoteConsequenceNode[];
  /**
   * How many nodes rest on a real Canon causal edge (`direct` + `downstream`).
   *
   * Published as a number rather than left for the client to recount, because it is the value
   * that decides whether the view may say anything causal at all. Zero — today's production
   * shape — means the view states that Canon records no causal edge from the vote, instead of
   * rendering an empty list that reads like an absence of consequences.
   */
  explicitCausalEdgeCount: number;
  /** Every accepted-event id this payload rests on, for the read-model row's own provenance. */
  sourceEventIds: string[];
};

export class VoteConsequenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'VoteConsequenceError';
  }
}

const bySequence = (
  left: { sequenceNumber: number },
  right: { sequenceNumber: number },
): number => left.sequenceNumber - right.sequenceNumber;

function nodeFrom(
  event: VoteConsequenceEventInput,
  bucket: VoteConsequenceBucket,
  depth: number | null,
  path: readonly string[],
  provenance: VoteConsequenceProvenance,
): VoteConsequenceNode {
  // Explicit field allowlist, never a spread of the input: `VoteConsequenceEventInput` is
  // assembled from a Canon row and a spread would republish whatever a future field carries.
  return {
    eventId: event.eventId,
    sequenceNumber: event.sequenceNumber,
    worldDay: event.worldDay,
    timeSlot: event.timeSlot,
    eventType: event.eventType,
    publicSummary: event.publicSummary,
    publicationStatus: event.publicationStatus,
    bucket,
    depth,
    path: [...path],
    provenance: { basis: provenance.basis, sourceEventIds: [...provenance.sourceEventIds] },
  };
}

/**
 * The accepted event a viewer vote put into the world on `targetWorldDay`, or null.
 *
 * Selected off Canon's own `idempotencyKey` prefix, and cross-checked against the vote ledger's
 * `appliedEventId` when the ledger has one: the ledger records intent, Canon records what
 * happened, and only their agreement is evidence. A ledger that names an event Canon does not
 * have is ignored rather than trusted — this projection may only speak about accepted events.
 *
 * A day with more than one applied intervention resolves to the earliest by sequence number, so
 * the choice is deterministic. FR-J001 elects one winner per round, so this is a tie-break for
 * an operational edge case, not a design for multiple triggers.
 */
function selectTrigger(
  events: readonly VoteConsequenceEventInput[],
  targetWorldDay: number,
  appliedEventIds: readonly string[],
): VoteConsequenceEventInput | null {
  const candidates = events.filter((event) =>
    event.worldDay === targetWorldDay
    && event.idempotencyKey.startsWith(VIEWER_VOTE_IDEMPOTENCY_PREFIX));
  if (candidates.length === 0) return null;
  const applied = new Set(appliedEventIds);
  const confirmed = candidates.filter((event) => applied.has(event.eventId));
  return (confirmed.length > 0 ? confirmed : candidates)[0] ?? null;
}

/**
 * Build the consequence read model for one world-day's viewer intervention.
 *
 * Deterministic: every bucket is ordered by sequence number and every traversal choice is
 * broken by sequence number, so the same Canon produces byte-identical output and the read
 * model's content hash dedups instead of churning a new version on every commit.
 *
 * Returns a payload with a null trigger and four empty buckets when the day had no accepted
 * viewer intervention. That is a publishable answer, not a failure: the view has to be able to
 * say 「這一天沒有觀眾投票事件」 without the read 404-ing. It goes through the validator like
 * every other payload, so the guarantee "nothing is published unvalidated" has no exception.
 */
export function buildVoteConsequenceProjection(input: {
  worldId: string;
  targetWorldDay: number;
  events: readonly VoteConsequenceEventInput[];
  /**
   * The world's accepted-event ids, derived INDEPENDENTLY of `events` (AC#3).
   *
   * A separate argument on purpose. It used to be `events.map(e => e.eventId)`, computed inside
   * this function — which made `VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED` structurally unreachable,
   * because the validator was handed the builder's own input as the definition of "accepted".
   * The wiring now derives this from the `canonEvents` ROWS (`deriveEventId(worldId,
   * sequenceNumber)`), so if `events` were ever widened to carry something Canon has not
   * accepted — a proposed event, a refused one — the build fails instead of publishing it.
   */
  acceptedEventIds: readonly string[];
  /** `environmentVoteInterventions.appliedEventId` for the day. Cross-check only. */
  appliedEventIds: readonly string[];
  /** sceneId → the `viewerInterventionEventIds` that Scene's Director plan context listed. */
  contextInterventionEventIdsByScene: Readonly<Record<string, readonly string[]>>;
}): VoteConsequenceProjection {
  if (input.worldId.trim().length === 0) {
    throw new VoteConsequenceError('VOTE_CONSEQUENCE_INVALID', 'worldId must be non-empty');
  }
  if (!Number.isSafeInteger(input.targetWorldDay) || input.targetWorldDay < 0) {
    throw new VoteConsequenceError('VOTE_CONSEQUENCE_INVALID', 'targetWorldDay must be a non-negative integer');
  }

  const events = [...input.events].sort(bySequence);
  const empty: VoteConsequenceProjection = {
    schemaVersion: VOTE_CONSEQUENCE_SCHEMA_VERSION,
    worldId: input.worldId,
    targetWorldDay: input.targetWorldDay,
    trigger: null,
    direct: [],
    downstream: [],
    uncertain: [],
    explicitCausalEdgeCount: 0,
    sourceEventIds: [],
  };

  const triggerEvent = selectTrigger(events, input.targetWorldDay, input.appliedEventIds);
  if (triggerEvent === null) return validateVoteConsequenceLinks(empty, input.acceptedEventIds);

  const trigger = nodeFrom(triggerEvent, 'trigger', 0, [triggerEvent.eventId], {
    basis: 'vote_idempotency_key',
    sourceEventIds: [triggerEvent.eventId],
  });

  /** An event already placed in a bucket, and how it was reached. One bucket per event. */
  type Reached = { eventId: string; sequenceNumber: number; depth: number; path: string[] };
  const reached = new Set<string>([triggerEvent.eventId]);

  const direct: VoteConsequenceNode[] = [];
  const downstream: VoteConsequenceNode[] = [];

  // Breadth-first over EXPLICIT `causedByEventIds` edges only.
  //
  // Terminates on cycles without needing a depth cap: an event enters `reached` at most once
  // and is skipped forever after, so each round either consumes an unreached event or produces
  // an empty frontier. A → B → A therefore places B once and stops.
  //
  // The frontier carries each event's depth and path with it rather than being a list of ids
  // that then has to be looked back up — which is what removes the "parent is somehow not
  // reached" branch that could never fire.
  let frontier: Reached[] = [{
    eventId: triggerEvent.eventId,
    sequenceNumber: triggerEvent.sequenceNumber,
    depth: 0,
    path: [triggerEvent.eventId],
  }];
  while (frontier.length > 0) {
    const nextFrontier: Reached[] = [];
    for (const event of events) {
      if (reached.has(event.eventId)) continue;
      const causedBy = new Set(event.causedByEventIds);
      const parents = frontier.filter((entry) => causedBy.has(entry.eventId)).sort(bySequence);
      if (parents.length === 0) continue;
      // The earliest parent by sequence carries the path, so a diamond reports one stable
      // chain instead of whichever order the rows happened to arrive in.
      const primary = parents[0];
      const depth = primary.depth + 1;
      const path = [...primary.path, event.eventId];
      reached.add(event.eventId);
      nextFrontier.push({ eventId: event.eventId, sequenceNumber: event.sequenceNumber, depth, path });
      const node = nodeFrom(event, depth === 1 ? 'direct' : 'downstream', depth, path, {
        basis: 'canon_caused_by',
        sourceEventIds: parents.map((parent) => parent.eventId),
      });
      (depth === 1 ? direct : downstream).push(node);
    }
    frontier = nextFrontier;
  }

  /**
   * Context membership, and nothing more (AC#2).
   *
   * The Director was told this vote had happened while it planned the Scene this event came
   * from. That is a real, checkable fact about the pipeline, and it is NOT a causal edge — the
   * Director is told many things it does not act on. So these events get no depth, no path, and
   * a basis that says what they actually are.
   */
  const uncertain: VoteConsequenceNode[] = [];
  for (const event of events) {
    if (reached.has(event.eventId)) continue;
    if (event.sceneId === null) continue;
    const contextIds = input.contextInterventionEventIdsByScene[event.sceneId];
    if (contextIds === undefined || !contextIds.includes(triggerEvent.eventId)) continue;
    uncertain.push(nodeFrom(event, 'uncertain', null, [], {
      basis: 'director_plan_context',
      sourceEventIds: [triggerEvent.eventId],
    }));
  }

  const projection: VoteConsequenceProjection = {
    schemaVersion: VOTE_CONSEQUENCE_SCHEMA_VERSION,
    worldId: input.worldId,
    targetWorldDay: input.targetWorldDay,
    trigger,
    direct: direct.sort(bySequence),
    downstream: downstream.sort(bySequence),
    uncertain: uncertain.sort(bySequence),
    explicitCausalEdgeCount: direct.length + downstream.length,
    sourceEventIds: [...new Set([
      trigger.eventId,
      ...direct.map((node) => node.eventId),
      ...downstream.map((node) => node.eventId),
      ...uncertain.map((node) => node.eventId),
    ])],
  };

  return validateVoteConsequenceLinks(projection, input.acceptedEventIds);
}

/** Every node the payload carries, in bucket order. */
function allNodes(projection: VoteConsequenceProjection): VoteConsequenceNode[] {
  return [
    ...(projection.trigger === null ? [] : [projection.trigger]),
    ...projection.direct,
    ...projection.downstream,
    ...projection.uncertain,
  ];
}

/**
 * Refuse any payload that displays a link Canon does not support (AC#3).
 *
 * Modelled on `validateConsequenceSummaries` (`convex/story/consequenceSummary.ts`): a link is
 * only publishable when every id it names — the event itself, every step of its path, and every
 * id in its provenance — resolves to an ACCEPTED event. A projection that references a proposed,
 * refused or invented event is a defect, and failing the rebuild leaves the previous published
 * version serving rather than replacing it with an unsupported claim.
 *
 * Returns the payload unchanged on success, so `build` can end with `return validate(...)`.
 */
export function validateVoteConsequenceLinks(
  projection: VoteConsequenceProjection,
  acceptedEventIds: readonly string[],
): VoteConsequenceProjection {
  if (projection.schemaVersion !== VOTE_CONSEQUENCE_SCHEMA_VERSION) {
    throw new VoteConsequenceError('VOTE_CONSEQUENCE_INVALID', 'unsupported schema version');
  }
  const accepted = new Set(acceptedEventIds);
  const seen = new Set<string>();
  for (const node of allNodes(projection)) {
    if (!accepted.has(node.eventId)) {
      throw new VoteConsequenceError(
        'VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED',
        `consequence node is not an accepted event: ${node.eventId}`,
      );
    }
    if (seen.has(node.eventId)) {
      throw new VoteConsequenceError(
        'VOTE_CONSEQUENCE_DUPLICATE_BUCKET',
        `event appears in more than one bucket: ${node.eventId}`,
      );
    }
    seen.add(node.eventId);
    if (!(VOTE_CONSEQUENCE_BASES as readonly string[]).includes(node.provenance.basis)) {
      throw new VoteConsequenceError(
        'VOTE_CONSEQUENCE_INVALID',
        `unknown provenance basis: ${node.provenance.basis}`,
      );
    }
    if (node.provenance.sourceEventIds.length === 0) {
      throw new VoteConsequenceError(
        'VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED',
        `link carries no provenance: ${node.eventId}`,
      );
    }
    for (const sourceEventId of [...node.provenance.sourceEventIds, ...node.path]) {
      if (!accepted.has(sourceEventId)) {
        throw new VoteConsequenceError(
          'VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED',
          `link references an event that is not accepted: ${sourceEventId}`,
        );
      }
    }
  }
  return projection;
}
