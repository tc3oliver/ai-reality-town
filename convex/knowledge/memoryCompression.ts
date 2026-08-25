/**
 * Long-term memory compression (FR-E004 / RISK-003 / ART-27).
 *
 * ## Decision: compression is an INDEX, not a replacement
 *
 * The obvious reading of "compress old memories" is a job that rewrites stored memory rows into
 * summaries and deletes the originals. That design cannot satisfy AC#1 and AC#4 structurally —
 * it can only promise them, and a promise is exactly what a half-finished delete violates.
 *
 * There is nothing to delete here. `characterMemories` is not a table: it is a projection
 * replayed from the append-only Accepted Event log (`character_memory_formed` in
 * `canon/reducer.ts`). So this module is a pure function from that projection to a derived
 * digest, and it never writes. AC#1 ("原始 Event 仍保留") and AC#4 ("壓縮失敗不得刪除原始記憶")
 * become properties of the shape of the code rather than of its discipline: there is no code
 * path — successful or thrown — that could remove a source, because none of them can write.
 *
 * ## What "lossless" is defined to mean, precisely
 *
 * A digest sentence cannot reproduce the prose of the twelve memories it summarizes, so a claim
 * of "lossless" that meant *byte recovery from the digest alone* would be false. The claim this
 * module actually makes, and that `memoryCompression.lossless.test.ts` checks by machine, is
 * three properties:
 *
 * 1. **Exact partition.** `retainedMemories` and the union of every digest's `sourceMemoryIds`
 *    are disjoint and together cover the input memory id set exactly. Nothing is dropped,
 *    duplicated, or invented.
 * 2. **Round trip.** `expandCompressedMemories(compress(m), m)` returns the input records
 *    verbatim. The digest is an index over Canon, so the corpus it indexes is always the
 *    recovery path — and that corpus is a replay, so it is always reproducible.
 * 3. **Recall preservation.** Retrieving over `retainedMemories` returns every retained memory
 *    the *uncompressed* corpus would have returned, at the same or better rank, for every limit.
 *    Because `retainedMemories` contains every memory at or above
 *    {@link HIGH_IMPORTANCE_RETENTION}, AC#3 ("壓縮後角色仍能回想高重要度事件") follows from it.
 *
 * **What is lost, stated plainly:** an old, low-importance memory stops being retrievable
 * *verbatim by the cognition path*. That is the compression — claiming otherwise would mean
 * claiming the module does nothing. It is acceptable because the loss is confined to the
 * retrieval corpus, not to the record: the memory id survives in a digest, and property 2 turns
 * that id back into the exact record on demand.
 *
 * ## Decision: digest text is a template, never model output
 *
 * `summary` is built by a format string from numbers this module computed. A summarizing LLM
 * would read better and would break two invariants at once: a provider would be *producing*
 * cognition state rather than proposing an event for Canon to accept, and the same corpus would
 * stop compressing to the same digest, so the recall and partition properties would no longer be
 * checkable. Pure module: no Convex, no clock, no randomness, no network.
 *
 * ## Decision: the caller passes a narrowed event context
 *
 * Relationship, arc and location digests need facts a `CharacterMemoryRecord` does not carry —
 * who else was there, which arc the event belongs to, where it happened. Reading them here would
 * mean importing the Accepted Event log and the story projection, and `knowledge` may not depend
 * on `story` at all (`architecture/module-boundaries.json`). So the caller supplies them, the
 * same shape of contract `retrieveAuthorizedMemories` already uses for `arcRelevantEventIds`.
 *
 * The contract is deliberately *exact* rather than permissive: a context for an event this
 * character has no memory of is rejected, not ignored. Ignoring it would be safe for the output
 * but would let a caller hand over event metadata for events the character never witnessed and
 * never learn they had done so. Rejecting makes the narrowing checkable at the boundary.
 */

import type { CharacterMemoryRecord, TimeSlot } from '../canon/model';
import { CanonError, canonError } from '../shared/errors';

const SLOT_ORDER: Record<TimeSlot, number> = {
  morning: 0,
  noon: 1,
  afternoon: 2,
  evening: 3,
  night: 4,
};

const SLOTS_PER_DAY = 5;

/**
 * Importance at or above which a memory is never folded, however old it is.
 *
 * AC#3 requires that a compressed character can still recall high-importance events, so "high
 * importance" has to be a number somewhere. Any number is a judgement; what keeps the guarantee
 * honest is that this constant is the *only* place it is written down and the parity suite reads
 * it rather than restating it, so the checked property tracks whatever the world tunes it to.
 *
 * 0.7 on the 0..1 scale Canon validates: above the midpoint by enough that a merely notable
 * event still folds, below the ceiling so that "important" does not come to mean "singular".
 */
export const HIGH_IMPORTANCE_RETENTION = 0.7;

/**
 * How many folded memories must share an interpretation before it counts as a stable belief.
 *
 * Two is a coincidence — the same phrasing twice is how a character describes one incident and
 * its immediate aftermath. Three is the smallest count that can show a pattern across separate
 * occasions, which is what 穩定信念 names: not something believed strongly, something believed
 * repeatedly.
 */
export const STABLE_BELIEF_MIN_SUPPORT = 3;

/** The five FR-E004 digest kinds, in the order they are emitted. */
export const MEMORY_DIGEST_KINDS = [
  'impression', 'belief', 'relationship', 'arc', 'location',
] as const;
export type MemoryDigestKind = (typeof MEMORY_DIGEST_KINDS)[number];

/**
 * The Accepted Event facts a memory does not carry, narrowed by the caller to exactly the events
 * this character remembers.
 */
export type MemoryEventContext = {
  eventId: string;
  /** Every participant of the event, including the remembering character. */
  participantCharacterIds: readonly string[];
  locationId?: string;
  /** Story arcs the event belongs to. Passed in because `knowledge` may not import `story`. */
  arcIds?: readonly string[];
};

export type MemoryCompressionRequest = {
  characterId: string;
  now: { worldDay: number; timeSlot: TimeSlot };
  /** Memories younger than this many world days stay verbatim regardless of importance. */
  horizonDays: number;
  eventContexts: readonly MemoryEventContext[];
};

/**
 * One compressed view of a set of folded memories.
 *
 * Every aggregate is a plain statistic over `sourceMemoryIds`, so a reader who distrusts the
 * digest can recompute it from the expansion rather than take it on faith.
 */
export type MemoryDigest = {
  digestId: string;
  kind: MemoryDigestKind;
  /** Character id, other character id, arc id, location id, or the belief's interpretation. */
  subject: string;
  /** Deterministic template text. Never model output. */
  summary: string;
  memoryCount: number;
  meanImportance: number;
  peakImportance: number;
  meanConfidence: number;
  /** Signed: the direction of the feeling is the point of an impression. */
  meanEmotionalWeight: number;
  firstWorldDay: number;
  lastWorldDay: number;
  /** Sorted and unique. The union of these across digests is the folded set exactly. */
  sourceMemoryIds: string[];
  /** Sorted and unique. The Accepted Events the folded memories came from. */
  sourceEventIds: string[];
};

export type MemoryCompressionResult = {
  characterId: string;
  horizonDays: number;
  candidateCount: number;
  /** Kept verbatim and in input order; this is the corpus cognition retrieves from. */
  retainedMemories: CharacterMemoryRecord[];
  /** Sorted. Disjoint from `retainedMemories`; recoverable via {@link expandCompressedMemories}. */
  foldedMemoryIds: string[];
  digests: MemoryDigest[];
};

function invalidInput(message: string, details?: Record<string, unknown>): CanonError {
  return new CanonError(canonError('MEMORY_COMPRESSION_INPUT_INVALID', message, details));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function slotIndex(at: { worldDay: number; timeSlot: TimeSlot }): number {
  return at.worldDay * SLOTS_PER_DAY + SLOT_ORDER[at.timeSlot];
}

/** Whole and fractional world days between a memory and now; never negative. */
function ageInDays(
  memory: CharacterMemoryRecord,
  now: { worldDay: number; timeSlot: TimeSlot },
): number {
  return Math.max(0, slotIndex(now) - slotIndex(memory.createdAt)) / SLOTS_PER_DAY;
}

/**
 * Case- and whitespace-insensitive interpretation key.
 *
 * A belief is "stable" because the same reading recurs, and two tellings of the same reading
 * differing only by a trailing space are the same reading. Nothing stronger — no stemming, no
 * synonyms: an inference engine here would invent agreement the character never expressed, and
 * would need a language to be tuned for, which the world does not commit to.
 */
function beliefKey(interpretation: string): string {
  return interpretation.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function copyMemory(memory: CharacterMemoryRecord): CharacterMemoryRecord {
  return { ...memory, createdAt: { ...memory.createdAt } };
}

function assertRequest(request: MemoryCompressionRequest): void {
  if (request.characterId.length === 0) {
    throw invalidInput('memory compression requires a character id');
  }
  if (!Number.isInteger(request.horizonDays) || request.horizonDays < 0) {
    throw invalidInput('memory compression horizon must be a non-negative integer of world days', {
      horizonDays: request.horizonDays,
    });
  }
  if (!Number.isInteger(request.now.worldDay) || request.now.worldDay < 0) {
    throw invalidInput('memory compression world day must be a non-negative integer', {
      worldDay: request.now.worldDay,
    });
  }
}

/**
 * Index the event contexts, rejecting anything the character could not have witnessed.
 *
 * Runs before any digest is built. AC#4 is about a *failed* compression, and the cheapest way to
 * make failure harmless is to make it happen while the output is still empty.
 */
function indexEventContexts(
  request: MemoryCompressionRequest,
  referencedEventIds: ReadonlySet<string>,
): Map<string, MemoryEventContext> {
  const contexts = new Map<string, MemoryEventContext>();
  for (const context of request.eventContexts) {
    if (contexts.has(context.eventId)) {
      throw invalidInput('memory compression event context is duplicated', {
        eventId: context.eventId,
      });
    }
    if (!referencedEventIds.has(context.eventId)) {
      throw invalidInput('memory compression event context belongs to no supplied memory', {
        eventId: context.eventId,
      });
    }
    if (!context.participantCharacterIds.includes(request.characterId)) {
      throw new CanonError(canonError(
        'PARTICIPANT_MISMATCH',
        'memory compression event context excludes the remembering character',
        { eventId: context.eventId, characterId: request.characterId },
      ));
    }
    contexts.set(context.eventId, context);
  }
  for (const eventId of referencedEventIds) {
    if (!contexts.has(eventId)) {
      throw new CanonError(canonError(
        'UNKNOWN_EVENT_REFERENCE',
        'memory compression is missing the event context for a supplied memory',
        { eventId },
      ));
    }
  }
  return contexts;
}

function assertOwnedAndUnique(
  memories: readonly CharacterMemoryRecord[],
  characterId: string,
): Set<string> {
  const referencedEventIds = new Set<string>();
  const seen = new Set<string>();
  for (const memory of memories) {
    if (memory.characterId !== characterId) {
      throw new CanonError(canonError(
        'MEMORY_ACCESS_DENIED',
        'memory compression received a memory belonging to another character',
        { characterId },
      ));
    }
    if (seen.has(memory.memoryId)) {
      throw invalidInput('memory compression received a duplicate memory id', {
        memoryId: memory.memoryId,
      });
    }
    seen.add(memory.memoryId);
    referencedEventIds.add(memory.sourceEventId);
  }
  return referencedEventIds;
}

type DigestGroup = { kind: MemoryDigestKind; subject: string; members: CharacterMemoryRecord[] };

function groupsFor(
  folded: readonly CharacterMemoryRecord[],
  request: MemoryCompressionRequest,
  contexts: ReadonlyMap<string, MemoryEventContext>,
): DigestGroup[] {
  const groups = new Map<string, DigestGroup>();
  const add = (kind: MemoryDigestKind, subject: string, memory: CharacterMemoryRecord): void => {
    const digestId = `${kind}:${subject}`;
    const group = groups.get(digestId) ?? { kind, subject, members: [] };
    group.members.push(memory);
    groups.set(digestId, group);
  };
  for (const memory of folded) {
    // The impression is the total one. Every other kind is conditional on the event carrying the
    // fact it keys on, so only this one makes the union of digests cover the folded set — which
    // is the property the partition check depends on.
    add('impression', request.characterId, memory);
    const context = contexts.get(memory.sourceEventId)!;
    for (const participant of context.participantCharacterIds) {
      if (participant !== request.characterId) add('relationship', participant, memory);
    }
    for (const arcId of context.arcIds ?? []) add('arc', arcId, memory);
    if (context.locationId !== undefined) add('location', context.locationId, memory);
  }
  const beliefs = new Map<string, CharacterMemoryRecord[]>();
  for (const memory of folded) {
    const key = beliefKey(memory.interpretation);
    beliefs.set(key, [...(beliefs.get(key) ?? []), memory]);
  }
  for (const [key, members] of beliefs) {
    if (members.length >= STABLE_BELIEF_MIN_SUPPORT) {
      groups.set(`belief:${key}`, { kind: 'belief', subject: key, members });
    }
  }
  return [...groups.values()];
}

function summarize(group: DigestGroup, stats: {
  memoryCount: number; meanImportance: number; meanEmotionalWeight: number;
  firstWorldDay: number; lastWorldDay: number;
}): string {
  const span = `world days ${stats.firstWorldDay}-${stats.lastWorldDay}`;
  const tone = stats.meanEmotionalWeight > 0.1 ? 'warm'
    : stats.meanEmotionalWeight < -0.1 ? 'uneasy' : 'level';
  const scale = `${stats.memoryCount} folded ${stats.memoryCount === 1 ? 'memory' : 'memories'}`;
  switch (group.kind) {
    case 'impression':
      return `A ${tone} impression of ${span}, from ${scale} (mean importance ${stats.meanImportance}).`;
    case 'belief':
      return `A stable belief held across ${scale} in ${span}: "${group.subject}".`;
    case 'relationship':
      return `A ${tone} sense of ${group.subject} over ${span}, from ${scale}.`;
    case 'arc':
      return `An understanding of arc ${group.subject} over ${span}, from ${scale}.`;
    case 'location':
      return `Experience of ${group.subject} over ${span}, from ${scale} (${tone}).`;
  }
}

function digestFrom(group: DigestGroup): MemoryDigest {
  const { members } = group;
  const count = members.length;
  const sum = (pick: (memory: CharacterMemoryRecord) => number): number =>
    members.reduce((total, memory) => total + pick(memory), 0);
  const worldDays = members.map((memory) => memory.createdAt.worldDay);
  const stats = {
    memoryCount: count,
    meanImportance: round(sum((memory) => memory.importance) / count),
    peakImportance: round(Math.max(...members.map((memory) => memory.importance))),
    meanConfidence: round(sum((memory) => memory.confidence) / count),
    meanEmotionalWeight: round(sum((memory) => memory.emotionalWeight) / count),
    firstWorldDay: Math.min(...worldDays),
    lastWorldDay: Math.max(...worldDays),
  };
  return {
    digestId: `${group.kind}:${group.subject}`,
    kind: group.kind,
    subject: group.subject,
    summary: summarize(group, stats),
    ...stats,
    sourceMemoryIds: [...new Set(members.map((memory) => memory.memoryId))].sort(),
    sourceEventIds: [...new Set(members.map((memory) => memory.sourceEventId))].sort(),
  };
}

/**
 * Partition a character's memories into a verbatim retained corpus and a set of digests.
 *
 * Deterministic in both inputs: the same memories and the same request always produce the same
 * result, byte for byte. `now` is a world time supplied by the caller, never `Date.now()`, so a
 * replay of the same world produces the same compression.
 *
 * Throws before producing anything if the input is inconsistent. Nothing is mutated on any path,
 * successful or not.
 */
export function compressCharacterMemories(
  memories: readonly CharacterMemoryRecord[],
  request: MemoryCompressionRequest,
): MemoryCompressionResult {
  assertRequest(request);
  const referencedEventIds = assertOwnedAndUnique(memories, request.characterId);
  const contexts = indexEventContexts(request, referencedEventIds);

  const retained: CharacterMemoryRecord[] = [];
  const folded: CharacterMemoryRecord[] = [];
  for (const memory of memories) {
    const keepVerbatim = memory.importance >= HIGH_IMPORTANCE_RETENTION
      || ageInDays(memory, request.now) < request.horizonDays;
    (keepVerbatim ? retained : folded).push(memory);
  }

  const digests = groupsFor(folded, request, contexts)
    .map(digestFrom)
    .sort((left, right) => MEMORY_DIGEST_KINDS.indexOf(left.kind) - MEMORY_DIGEST_KINDS.indexOf(right.kind)
      || left.subject.localeCompare(right.subject));

  return {
    characterId: request.characterId,
    horizonDays: request.horizonDays,
    candidateCount: memories.length,
    retainedMemories: retained.map(copyMemory),
    foldedMemoryIds: folded.map((memory) => memory.memoryId).sort(),
    digests,
  };
}

/**
 * Turn a compression back into the exact memories it was built from.
 *
 * This is the function that makes "lossless" checkable rather than asserted: it is the recovery
 * path a reader of a digest uses to see the individual memories behind it, and it is the round
 * trip the property suite runs. It resolves ids against the supplied corpus rather than storing
 * copies in the digest — a stored copy could drift from the replay, and the whole point is that
 * the Accepted Event log stays the single source.
 *
 * Records come back in corpus order, so the result is comparable to the corpus directly.
 */
export function expandCompressedMemories(
  result: MemoryCompressionResult,
  corpus: readonly CharacterMemoryRecord[],
): CharacterMemoryRecord[] {
  const wanted = new Set<string>([
    ...result.retainedMemories.map((memory) => memory.memoryId),
    ...result.digests.flatMap((digest) => digest.sourceMemoryIds),
  ]);
  const byId = new Map(corpus.map((memory) => [memory.memoryId, memory]));
  for (const memoryId of wanted) {
    if (!byId.has(memoryId)) {
      throw invalidInput('compressed memory references a memory the corpus does not contain', {
        memoryId,
      });
    }
  }
  return corpus.filter((memory) => wanted.has(memory.memoryId)).map(copyMemory);
}
