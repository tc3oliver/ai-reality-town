/**
 * The scoped relationship graph (PRD 1.0 §13 Epic K, FR-I007 + NFR-002 / ART-44).
 *
 * FR-I007, verbatim: 「預設只顯示:當前 Arc 核心人物 / 一階關係 / 最近七日有變化的關係。支援:日期切換 /
 * 關係類型篩選 / 人物摘要 / 關係變化原因。不得預設渲染全部角色與全部關係。」
 * NFR-002, the graph clause: 「關係圖預設節點不超過 30。」
 *
 * ## Why this is a server-side read model and not a client-side view
 *
 * Not a preference. Relationship projections are published one `modelRef` per pair
 * (`relationship:<pairKey>`) and NO published model enumerates the pairs, so a client cannot
 * discover which relationships exist — it can only ask for ones it already knows the name of.
 * There is no client-side construction of this graph to prefer or reject.
 *
 * It is also the only place the two hard guarantees can be guarantees rather than hopes. A cap
 * applied in a component is a cap on what that component draws; a viewer with a devtools console
 * and a cap applied server-side get the same 30 nodes, because 30 nodes is what was published.
 * The same is true of the privacy boundary below.
 *
 * ## Why the input is CANON, not the published `relationship:<pairKey>` model
 *
 * Three reasons, in order of weight.
 *
 * 1. **The published model does not carry what this needs.** `RelationshipChange` publishes three
 *    of the six deltas (trust, affection, resentment) and no world day at all. FR-I007's
 *    seven-day window needs the day, and 關係類型篩選 needs all six dimensions. Canon's
 *    `RelationshipHistoryEntry` (`convex/canon/model.ts:231-246`) carries the day, the slot, all
 *    six deltas, the reason and the visibility.
 * 2. **Independence from ART-95.** The published payload's CURRENT dimensions were the last
 *    event's delta rather than an accumulated level. That defect is repaired in this same branch,
 *    but a graph built on the repaired field would be correct only BECAUSE of the repair, and the
 *    two changes could then only be reviewed together. Built on Canon, this graph is correct
 *    whether or not that fix lands.
 * 3. `publicRead` may depend on `canon`, and the precedent is already inside this module:
 *    `liveStateFunctions.ts` replays the world through `../canon/replay` on the same commit path.
 *
 * ## The privacy trap in Canon, and why this does not fall into it
 *
 * `WorldProjection.relationships` — Canon's `RelationshipState`, the accumulated levels — is
 * **not publication-safe**, and the codebase already says so: `convex/canon/queries.ts` exposes it
 * only as an internalQuery labelled 「Private relationship state and causal history」, and the
 * neighbouring persona-summary query in that same file spells the leak out — a public reader who
 * could see that a character's trust in someone inverted would learn a private relationship fact
 * the public projection deliberately withholds.
 *
 * That query's NAME is deliberately not written here, nor is the name of the guard that enforces
 * it: `convex/canon/` carries a boundary suite that scans every file under `convex/publicRead`,
 * `convex/viewer` and `src` for a list of internal-only symbols, and prose ABOUT the rule would
 * otherwise be flagged as a breach of it. The suite is right to be that blunt — it is what makes
 * a new public file covered on the day it is added — so the comment gives way, not the guard.
 *
 * The reason is in the reducer: `convex/canon/reducer.ts` folds EVERY `relationship_changed` into
 * that state, public and private alike. Publishing the number would leak the magnitude and
 * direction of hidden feelings through arithmetic rather than through a field — defeating
 * `buildRelationshipProjection`'s private-visibility rejection without ever naming a private
 * value.
 *
 * So this build takes Canon's `relationshipHistory`, keeps only the entries whose `visibility` is
 * `'public'`, and folds THOSE with {@link accumulatePublicRelationshipDimensions}. The published
 * level is 「where this relationship stands as far as the public record shows」 — a different and
 * smaller number than Canon's, and the only one this surface is entitled to.
 * {@link assertNoPrivateRelationship} then re-checks the property on the assembled input, so a
 * future caller that forgets the filter fails loudly instead of leaking quietly.
 *
 * ## Dimensions are folded AS OF the target day
 *
 * Folding the whole history would put today's numbers behind a day-3 heading, which is the kind
 * of wrong that looks right. Only the changes with `worldDay <= targetWorldDay` are folded, so
 * 日期切換 moves the numbers and not just the caption.
 *
 * Pure module — no Convex imports, no clock, no randomness, no Canon mutation.
 */

import { truncateForPublic } from '../shared/publicText';
import {
  RELATIONSHIP_DIMENSIONS,
  accumulatePublicRelationshipDimensions,
  type RelationshipDimension,
  type RelationshipDimensions,
} from './relationshipArcProjection';

export const RELATIONSHIP_GRAPH_SCHEMA_VERSION = 1;
export const RELATIONSHIP_GRAPH_MODEL_KIND = 'relationshipGraph' as const;

/**
 * NFR-002 「關係圖預設節點不超過 30」. A hard cap enforced in the builder, not a hint to the view.
 *
 * {@link assertRelationshipGraphBounds} re-checks it on the finished payload, so a future change
 * to the selection order cannot quietly widen it.
 */
export const RELATIONSHIP_GRAPH_MAX_NODES = 30;

/**
 * FR-I007 「最近七日有變化的關係」.
 *
 * The window is `targetWorldDay - lastChangedWorldDay <= 7`, inclusive at both ends: a change
 * seven world days ago is IN, a change eight world days ago is OUT. Stated as an explicit
 * inequality rather than left to a reader of `<` versus `<=`, because "the last seven days"
 * genuinely is ambiguous about its far edge and a silent off-by-one here changes which
 * relationships a viewer is told about.
 *
 * Changes in the FUTURE of the target day are also out. A day-3 graph that showed a day-6 change
 * would not be a graph of day 3.
 */
export const RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS = 7;

/** How many change reasons an edge carries, newest first. Bounds the payload; see AC#2 「關係變化原因」. */
export const RELATIONSHIP_GRAPH_MAX_CHANGE_REASONS = 3;

/** Character budget for one change reason. */
export const RELATIONSHIP_GRAPH_MAX_REASON_CHARS = 40;

/**
 * The token this build's truncation ordering is published under.
 *
 * In the payload rather than only in this docblock so the view can state the rule it is subject
 * to WITHOUT restating it — a client that hard-coded the explanation would keep saying it after
 * the ordering changed. A view that receives an ordering token it does not recognise says so
 * instead of describing an ordering that is no longer in force. See {@link selectGraphNodes}.
 */
export const RELATIONSHIP_GRAPH_NODE_ORDERING = 'core_first_then_recent_change_desc' as const;

/**
 * The categories 關係類型篩選 filters over (AC#2).
 *
 * DERIVED, and derived from the only material Canon actually records: a relationship is six
 * numbers, so its "type" is the dimension carrying the most weight. There is no `relationshipType`
 * field anywhere in Canon to read, and inventing a taxonomy (「朋友」「敵人」「家人」) would mean
 * putting a label on a relationship that nothing in the world model supports.
 *
 * `neutral` is not a seventh flavour — it is the honest answer for a pair whose six dimensions are
 * all zero, which is a real state (a relationship that has moved and moved back).
 */
export const RELATIONSHIP_GRAPH_TYPES = [...RELATIONSHIP_DIMENSIONS, 'neutral'] as const;
export type RelationshipGraphType = (typeof RELATIONSHIP_GRAPH_TYPES)[number];

/**
 * Arc statuses that count as 「當前 Arc」, most-current first.
 *
 * The order is the selection rule when a world has several active arcs at once: the arc nearest
 * its peak is the one a viewer arriving now is watching. Mirrors `isActiveArcStatus`
 * (`convex/story/lifecycle.ts`) in membership — `active | escalating | climax | resolving` — and
 * adds only the precedence, which lifecycle has no reason to have an opinion about. Not imported,
 * because `publicRead` builds from PUBLISHED arc payloads whose `status` is a plain string, and a
 * status this build does not recognise must be treated as "not current" rather than crash the
 * graph.
 */
export const RELATIONSHIP_GRAPH_ARC_STATUS_PRECEDENCE = [
  'climax', 'escalating', 'resolving', 'active',
] as const;

export class RelationshipGraphError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'RelationshipGraphError';
  }
}

// ---------------------------------------------------------------------------
// Inputs — shaped like the published read models the wiring loads.
// ---------------------------------------------------------------------------

/** One public relationship change, as read back off a published `relationship:<pairKey>` payload. */
export type GraphRelationshipChangeInput = {
  eventId: string;
  reason: string;
  worldDay: number;
  trustDelta: number;
  affectionDelta: number;
  resentmentDelta: number;
  fearDelta?: number;
  dependencyDelta?: number;
  familiarityDelta?: number;
};

/**
 * One published relationship pair.
 *
 * `visibility` is carried and checked even though the source payload can only ever say `'public'`.
 * The check is what keeps that true: it converts "no published relationship is private" from a
 * property of today's callers into a property of this builder.
 */
export type GraphRelationshipInput = {
  pairKey: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  visibility: string;
  changeHistory: readonly GraphRelationshipChangeInput[];
};

/** One published arc, as far as the graph's scoping needs it. */
export type GraphArcInput = {
  arcId: string;
  title: string;
  status: string;
  coreCharacterIds: readonly string[];
};

// ---------------------------------------------------------------------------
// Assembling the relationship inputs from Canon's own history.
// ---------------------------------------------------------------------------

/** One entry of Canon's `WorldProjection.relationshipHistory`, as this build reads it. */
export type CanonRelationshipHistoryEntry = {
  sourceCharacterId: string;
  targetCharacterId: string;
  trustDelta: number;
  affectionDelta: number;
  resentmentDelta: number;
  fearDelta: number;
  dependencyDelta: number;
  familiarityDelta: number;
  reason: string;
  visibility: 'private' | 'public';
  sourceEventId: string;
  sequenceNumber: number;
  worldDay: number;
};

/** The undirected pair key this graph identifies a relationship by. */
export function graphPairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/**
 * Group Canon's relationship history into the undirected, PUBLIC-ONLY pairs the graph draws.
 *
 * Two things happen here, and both are load-bearing.
 *
 * **The private filter.** Only `visibility === 'public'` entries survive. This is the single
 * point at which the graph becomes publication-safe: Canon's own accumulated `RelationshipState`
 * folds private changes in with public ones and is explicitly internal-only (see the module
 * docblock), so the public levels have to be re-folded from the public entries alone. A private
 * entry contributes neither a level, nor a reason, nor the existence of an edge — a pair whose
 * only history is private does not appear at all, rather than appearing at zero, which would
 * itself disclose that something private happened between them.
 *
 * **The direction merge.** Canon's key is DIRECTIONAL (`relationshipKey` is `source|target`), so
 * A→B and B→A are separate histories with independent values. The graph draws one undirected
 * edge per pair, matching `buildRelationshipProjection`'s sorted `pairKey`, so both directions
 * fold into one series ordered by `sequenceNumber`. Merging rather than picking a direction is
 * what stops the graph from reporting half of a mutual falling-out.
 *
 * The pair's `sourceCharacterId`/`targetCharacterId` are taken from the sorted key, not from
 * whichever direction happened to be seen first, so the payload is stable across rebuilds.
 */
export function groupPublicRelationships(
  history: readonly CanonRelationshipHistoryEntry[],
): GraphRelationshipInput[] {
  const byPair = new Map<string, CanonRelationshipHistoryEntry[]>();
  for (const entry of history) {
    if (entry.visibility !== 'public') continue;
    if (!Number.isSafeInteger(entry.worldDay)) continue;
    const key = graphPairKey(entry.sourceCharacterId, entry.targetCharacterId);
    const existing = byPair.get(key);
    if (existing === undefined) byPair.set(key, [entry]);
    else existing.push(entry);
  }
  return [...byPair.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pairKey, entries]) => {
      const [sourceCharacterId, targetCharacterId] = pairKey.split(':');
      return {
        pairKey,
        sourceCharacterId,
        targetCharacterId,
        visibility: 'public',
        changeHistory: [...entries]
          // Canon's own accepted order, so the fold below is a replay rather than a guess.
          .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
          .map((entry) => ({
            eventId: entry.sourceEventId,
            worldDay: entry.worldDay,
            reason: entry.reason,
            trustDelta: entry.trustDelta,
            affectionDelta: entry.affectionDelta,
            resentmentDelta: entry.resentmentDelta,
            fearDelta: entry.fearDelta,
            dependencyDelta: entry.dependencyDelta,
            familiarityDelta: entry.familiarityDelta,
          })),
      };
    });
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/** One change, as the graph publishes it. Carries its own `worldDay` — never joined against the timeline. */
export type RelationshipGraphChange = {
  eventId: string;
  worldDay: number;
  /** Bounded to {@link RELATIONSHIP_GRAPH_MAX_REASON_CHARS}; already-public text only. */
  reason: string;
};

/**
 * One node: WHO is on the graph and how they got there. Nothing about who they are.
 *
 * Deliberately carries no name, summary, occupation or liveness. Those are text, and text is
 * subject to ART-132's retroactive withhold — a day-5 Scene can be refused on day 9. A past day's
 * graph is published once, while that day is current, and is never rebuilt, so any character text
 * baked in here would be frozen at publication and could never self-heal. `character:<id>` IS
 * rebuilt on every commit that touches the character, so the view reads the description from
 * there and gets the withhold for free. See `docs/scoped-relationship-graph.md` §2.
 *
 * A trailing rebuild window was the alternative and was rejected: a withhold can be arbitrarily
 * retroactive, so a window of N days widens the hole rather than closing it, and would ship a
 * safety claim that silently stops holding after N days.
 */
export type RelationshipGraphNode = {
  characterId: string;
  /** True for a core character of the current arc: the seed set FR-I007 scopes to. */
  isCoreCharacter: boolean;
  /** 0 for a core character, 1 for a one-hop neighbour. The default graph has no other value. */
  hop: 0 | 1;
  /** Edges RETAINED in this payload that touch this node. Zero is legal for an isolated core character. */
  edgeCount: number;
};

export type RelationshipGraphEdge = {
  pairKey: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  /** Dominant dimension by absolute level, or `neutral`. See {@link RELATIONSHIP_GRAPH_TYPES}. */
  relationshipType: RelationshipGraphType;
  /** Absolute level of the dominant dimension: what the type is a type BY. */
  strength: number;
  /** All six levels, folded over the public changes up to and including the target day. */
  dimensions: RelationshipDimensions;
  /** The most recent public change on or before the target day. Drives the seven-day window. */
  lastChangedWorldDay: number;
  /** Newest first, at most {@link RELATIONSHIP_GRAPH_MAX_CHANGE_REASONS} (AC#2 關係變化原因). */
  recentChanges: RelationshipGraphChange[];
  /** Public changes in the window, including any beyond the reasons carried above. */
  changeCountInWindow: number;
};

export type RelationshipGraphProjection = {
  schemaVersion: typeof RELATIONSHIP_GRAPH_SCHEMA_VERSION;
  worldId: string;
  /** The world day this graph is a graph OF. Date switching selects a different `modelRef`. */
  worldDay: number;
  /** The arc that scoped it, or null when the world has no active arc. */
  arc: { arcId: string; title: string; status: string } | null;
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraphEdge[];
  /** Types actually present on the retained edges, so the filter offers no empty option. */
  relationshipTypes: RelationshipGraphType[];
  /** The declared scope, restated in the payload so the view can show it without inventing it. */
  scope: {
    windowDays: typeof RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS;
    nodeLimit: typeof RELATIONSHIP_GRAPH_MAX_NODES;
    nodeOrdering: typeof RELATIONSHIP_GRAPH_NODE_ORDERING;
  };
  /**
   * Truncation, stated rather than performed silently.
   *
   * `candidate*` is what QUALIFIED under the FR-I007 scope; `omitted*` is what the NFR-002 cap
   * then removed. Both are published because "30 nodes" and "30 of 84 nodes" are different
   * claims, and a view that cannot tell them apart will make the first one.
   */
  candidateNodeCount: number;
  candidateEdgeCount: number;
  omittedNodeCount: number;
  omittedEdgeCount: number;
  /** Every accepted-event id this payload rests on, for the read-model row's provenance. */
  sourceEventIds: string[];
};

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/**
 * The dimension carrying the most weight, or `neutral` when nothing does.
 *
 * Ties break on {@link RELATIONSHIP_DIMENSIONS} order, so a pair sitting at trust 5 / fear 5
 * always reports the same type rather than whichever key iteration happened to reach first —
 * which is what keeps the payload's content hash stable and its dedup working.
 */
export function dominantRelationshipType(dimensions: RelationshipDimensions): {
  relationshipType: RelationshipGraphType;
  strength: number;
} {
  let best: RelationshipDimension | null = null;
  let bestMagnitude = 0;
  for (const dimension of RELATIONSHIP_DIMENSIONS) {
    const magnitude = Math.abs(dimensions[dimension]);
    if (magnitude > bestMagnitude) {
      best = dimension;
      bestMagnitude = magnitude;
    }
  }
  return best === null
    ? { relationshipType: 'neutral', strength: 0 }
    : { relationshipType: best, strength: bestMagnitude };
}

/** Whether a change on `changedWorldDay` falls in the window ending at `targetWorldDay`. */
export function isWithinRecentChangeWindow(changedWorldDay: number, targetWorldDay: number): boolean {
  const age = targetWorldDay - changedWorldDay;
  return age >= 0 && age <= RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS;
}

/**
 * The current arc, by {@link RELATIONSHIP_GRAPH_ARC_STATUS_PRECEDENCE} then `arcId` ascending.
 *
 * Returns null when nothing is active — a real state for a world between arcs, and one the graph
 * has to be able to report rather than fill with an arbitrary resolved arc.
 */
export function selectCurrentArc(arcs: readonly GraphArcInput[]): GraphArcInput | null {
  const ranked = arcs
    .map((arc) => ({ arc, rank: RELATIONSHIP_GRAPH_ARC_STATUS_PRECEDENCE.indexOf(arc.status as never) }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.arc.arcId.localeCompare(right.arc.arcId));
  return ranked[0]?.arc ?? null;
}

/** The other end of an edge, given one end. Null when the character is not on it. */
function otherEnd(edge: { sourceCharacterId: string; targetCharacterId: string }, characterId: string): string | null {
  if (edge.sourceCharacterId === characterId) return edge.targetCharacterId;
  if (edge.targetCharacterId === characterId) return edge.sourceCharacterId;
  return null;
}

type QualifiedEdge = {
  input: GraphRelationshipInput;
  dimensions: RelationshipDimensions;
  lastChangedWorldDay: number;
  windowChanges: GraphRelationshipChangeInput[];
};

/**
 * Refuse a relationship this surface is not entitled to publish.
 *
 * Every caller today loads already-published payloads, which can only be `'public'`. This exists
 * for the caller that does not: a graph built straight off Canon rows would otherwise render
 * private feelings as edges, and the failure would be silent and total.
 */
function assertNoPrivateRelationship(input: GraphRelationshipInput): void {
  if (input.visibility !== 'public') {
    throw new RelationshipGraphError(
      'RELATIONSHIP_GRAPH_PRIVATE',
      `only public-visibility relationships may enter the graph: ${input.pairKey}`,
    );
  }
}

/**
 * Select and order the graph's nodes, then apply the NFR-002 cap.
 *
 * THE ORDERING, which {@link RELATIONSHIP_GRAPH_NODE_ORDERING} names and the payload publishes:
 *
 *   1. The current arc's core characters, in the arc's own published `coreCharacterIds` order.
 *      That order is the arc's statement of who its story is about, and it is deduplicated and
 *      stable in `buildArcProjection`, so it is a real ranking rather than an accident of
 *      iteration. Core characters are included even with no qualifying edge: FR-I007 scopes the
 *      graph to 「當前 Arc 核心人物」, and a core character nobody has interacted with this week is
 *      a fact about the arc, not an absence to hide.
 *   2. Then one-hop neighbours, ranked by their single best qualifying edge:
 *      a. `lastChangedWorldDay` DESCENDING — the most recently changed relationship first, which
 *         is the axis FR-I007's own default is drawn along;
 *      b. then edge `strength` descending — a stronger relationship outranks a weaker one changed
 *         on the same day;
 *      c. then `characterId` ascending — a total order, so nothing is ever decided by input order.
 *
 * Truncation takes the head of that list. It is therefore deterministic and explicable: what was
 * dropped is what changed longest ago and weakest, and the count of it is published.
 *
 * If the core set ALONE exceeds the cap it is truncated too, in the arc's order. An arc with more
 * than thirty core characters is not a shape this product produces, but a cap that held except in
 * the case nobody expected would not be a cap.
 */
export function selectGraphNodes(input: {
  coreCharacterIds: readonly string[];
  qualifiedEdges: readonly QualifiedEdge[];
}): { characterIds: string[]; candidateCount: number; omittedCount: number } {
  const core = [...new Set(input.coreCharacterIds)];
  const coreSet = new Set(core);

  /** Each neighbour's BEST qualifying edge, by the (b)/(c) keys above. */
  const bestByNeighbour = new Map<string, { lastChangedWorldDay: number; strength: number }>();
  for (const edge of input.qualifiedEdges) {
    for (const characterId of core) {
      const neighbour = otherEnd(edge.input, characterId);
      if (neighbour === null || coreSet.has(neighbour)) continue;
      const { strength } = dominantRelationshipType(edge.dimensions);
      const prior = bestByNeighbour.get(neighbour);
      const better = prior === undefined
        || edge.lastChangedWorldDay > prior.lastChangedWorldDay
        || (edge.lastChangedWorldDay === prior.lastChangedWorldDay && strength > prior.strength);
      if (better) bestByNeighbour.set(neighbour, { lastChangedWorldDay: edge.lastChangedWorldDay, strength });
    }
  }

  const neighbours = [...bestByNeighbour.entries()]
    .sort(([leftId, left], [rightId, right]) =>
      right.lastChangedWorldDay - left.lastChangedWorldDay
      || right.strength - left.strength
      || leftId.localeCompare(rightId))
    .map(([characterId]) => characterId);

  const ordered = [...core, ...neighbours];
  return {
    characterIds: ordered.slice(0, RELATIONSHIP_GRAPH_MAX_NODES),
    candidateCount: ordered.length,
    omittedCount: Math.max(0, ordered.length - RELATIONSHIP_GRAPH_MAX_NODES),
  };
}

/**
 * Build the scoped relationship graph for one world day (AC#1/#2/#3).
 *
 * Deterministic: every selection is totally ordered and every list is sorted, so the same inputs
 * produce a byte-identical payload and the read model's content hash dedups instead of churning a
 * new version on every commit.
 *
 * Returns a graph with a null arc and no nodes when the world has no active arc. That is a
 * publishable answer, not a failure — the view has to be able to say 「目前沒有進行中的故事線」
 * without the read returning nothing, which is indistinguishable from an outage.
 */
export function buildRelationshipGraphProjection(input: {
  worldId: string;
  targetWorldDay: number;
  arcs: readonly GraphArcInput[];
  relationships: readonly GraphRelationshipInput[];
}): RelationshipGraphProjection {
  if (input.worldId.trim().length === 0) {
    throw new RelationshipGraphError('RELATIONSHIP_GRAPH_INVALID', 'worldId must be non-empty');
  }
  if (!Number.isSafeInteger(input.targetWorldDay) || input.targetWorldDay < 0) {
    throw new RelationshipGraphError(
      'RELATIONSHIP_GRAPH_INVALID',
      'targetWorldDay must be a non-negative integer',
    );
  }
  for (const relationship of input.relationships) assertNoPrivateRelationship(relationship);

  const arc = selectCurrentArc(input.arcs);

  const empty: RelationshipGraphProjection = {
    schemaVersion: RELATIONSHIP_GRAPH_SCHEMA_VERSION,
    worldId: input.worldId,
    worldDay: input.targetWorldDay,
    arc: null,
    nodes: [],
    edges: [],
    relationshipTypes: [],
    scope: {
      windowDays: RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS,
      nodeLimit: RELATIONSHIP_GRAPH_MAX_NODES,
      nodeOrdering: RELATIONSHIP_GRAPH_NODE_ORDERING,
    },
    candidateNodeCount: 0,
    candidateEdgeCount: 0,
    omittedNodeCount: 0,
    omittedEdgeCount: 0,
    sourceEventIds: [],
  };
  if (arc === null) return assertRelationshipGraphBounds(empty);

  const coreSet = new Set(arc.coreCharacterIds);

  /**
   * Qualifying edges: 「一階關係」 AND 「最近七日有變化」, both required.
   *
   * One hop means at least one endpoint is a core character. An edge between two NON-core
   * characters is two hops from the arc even when both of them are on the graph as neighbours,
   * and drawing it would quietly widen the default past what FR-I007 permits.
   */
  const qualifiedEdges: QualifiedEdge[] = [];
  for (const relationship of input.relationships) {
    const touchesCore = coreSet.has(relationship.sourceCharacterId) || coreSet.has(relationship.targetCharacterId);
    if (!touchesCore) continue;

    // Levels as of the target day, not as of now. See the module docblock.
    const historyToDate = relationship.changeHistory.filter((change) =>
      Number.isSafeInteger(change.worldDay) && change.worldDay <= input.targetWorldDay);
    if (historyToDate.length === 0) continue;

    const windowChanges = historyToDate.filter((change) =>
      isWithinRecentChangeWindow(change.worldDay, input.targetWorldDay));
    if (windowChanges.length === 0) continue;

    qualifiedEdges.push({
      input: relationship,
      dimensions: accumulatePublicRelationshipDimensions(historyToDate),
      lastChangedWorldDay: windowChanges.reduce((latest, change) => Math.max(latest, change.worldDay), -1),
      windowChanges,
    });
  }

  const selection = selectGraphNodes({ coreCharacterIds: arc.coreCharacterIds, qualifiedEdges });
  const retained = new Set(selection.characterIds);

  /**
   * Edges dropped because an endpoint lost the node cap, COUNTED rather than subtracted.
   *
   * `omittedEdgeCount` used to be `qualifiedEdges.length - retainedEdges.length`, which made the
   * edge arm of {@link assertRelationshipGraphBounds} a true identity — `n + (m − n) === m` — so
   * no change to the edge filter could ever make it fire. Maintaining the counter here, in the
   * loop that does the dropping, is what turns that assertion into a real cross-check between two
   * independently derived numbers, exactly as the node arm already was.
   */
  let omittedEdges = 0;

  // An edge survives only if BOTH its ends did. Half an edge is a claim about a relationship with
  // somebody the viewer is not being shown, which is worse than not drawing it.
  const retainedEdges = qualifiedEdges
    .filter((edge) => {
      const bothEndsRendered = retained.has(edge.input.sourceCharacterId)
        && retained.has(edge.input.targetCharacterId);
      if (!bothEndsRendered) omittedEdges += 1;
      return bothEndsRendered;
    })
    .map((edge): RelationshipGraphEdge => {
      const { relationshipType, strength } = dominantRelationshipType(edge.dimensions);
      return {
        pairKey: edge.input.pairKey,
        sourceCharacterId: edge.input.sourceCharacterId,
        targetCharacterId: edge.input.targetCharacterId,
        relationshipType,
        strength,
        dimensions: { ...edge.dimensions },
        lastChangedWorldDay: edge.lastChangedWorldDay,
        recentChanges: [...edge.windowChanges]
          // Newest first, then by event id so two changes on one day have a stable order.
          .sort((left, right) => right.worldDay - left.worldDay || left.eventId.localeCompare(right.eventId))
          .slice(0, RELATIONSHIP_GRAPH_MAX_CHANGE_REASONS)
          .map((change) => ({
            eventId: change.eventId,
            worldDay: change.worldDay,
            // Already-public text, shortened with the shared rule so the graph and the character
            // page cut a sentence in the same place.
            reason: truncateForPublic(change.reason, RELATIONSHIP_GRAPH_MAX_REASON_CHARS),
          })),
        changeCountInWindow: edge.windowChanges.length,
      };
    })
    .sort((left, right) =>
      right.lastChangedWorldDay - left.lastChangedWorldDay
      || right.strength - left.strength
      || left.pairKey.localeCompare(right.pairKey));

  const edgeCountByCharacter = new Map<string, number>();
  for (const edge of retainedEdges) {
    for (const characterId of [edge.sourceCharacterId, edge.targetCharacterId]) {
      edgeCountByCharacter.set(characterId, (edgeCountByCharacter.get(characterId) ?? 0) + 1);
    }
  }

  const nodes: RelationshipGraphNode[] = selection.characterIds.map((characterId) => ({
    characterId,
    isCoreCharacter: coreSet.has(characterId),
    hop: coreSet.has(characterId) ? 0 : 1,
    edgeCount: edgeCountByCharacter.get(characterId) ?? 0,
  }));

  const projection: RelationshipGraphProjection = {
    ...empty,
    arc: { arcId: arc.arcId, title: arc.title, status: arc.status },
    nodes,
    edges: retainedEdges,
    relationshipTypes: RELATIONSHIP_GRAPH_TYPES.filter((type) =>
      retainedEdges.some((edge) => edge.relationshipType === type)),
    candidateNodeCount: selection.candidateCount,
    candidateEdgeCount: qualifiedEdges.length,
    omittedNodeCount: selection.omittedCount,
    omittedEdgeCount: omittedEdges,
    sourceEventIds: [...new Set(retainedEdges.flatMap((edge) =>
      edge.recentChanges.map((change) => change.eventId)))].sort(),
  };
  return assertRelationshipGraphBounds(projection);
}

/**
 * Refuse a payload that breaks NFR-002 or misreports its own truncation (AC#3).
 *
 * Defence in depth rather than ceremony: the builder above enforces the cap by construction, and
 * this proves the payload ABOUT TO BE PUBLISHED honours it — so a future change to the selection
 * order fails the rebuild and leaves the previous version serving, instead of publishing a graph
 * that renders more of the world than FR-I007 permits.
 *
 * The omitted counts are checked too. A cap that silently dropped nodes while reporting zero
 * omissions would satisfy「不超過 30」and still be the失實 this task's AC#3 is about.
 *
 * Returns the payload unchanged on success, so `build` can end with `return assert(...)`.
 */
export function assertRelationshipGraphBounds(
  projection: RelationshipGraphProjection,
): RelationshipGraphProjection {
  if (projection.nodes.length > RELATIONSHIP_GRAPH_MAX_NODES) {
    throw new RelationshipGraphError(
      'RELATIONSHIP_GRAPH_NODE_LIMIT',
      `default graph renders ${projection.nodes.length} nodes, over the NFR-002 limit of ${RELATIONSHIP_GRAPH_MAX_NODES}`,
    );
  }
  if (projection.nodes.length + projection.omittedNodeCount !== projection.candidateNodeCount) {
    throw new RelationshipGraphError(
      'RELATIONSHIP_GRAPH_TRUNCATION_UNREPORTED',
      `graph renders ${projection.nodes.length} of ${projection.candidateNodeCount} candidate nodes but reports ${projection.omittedNodeCount} omitted`,
    );
  }
  if (projection.edges.length + projection.omittedEdgeCount !== projection.candidateEdgeCount) {
    throw new RelationshipGraphError(
      'RELATIONSHIP_GRAPH_TRUNCATION_UNREPORTED',
      `graph renders ${projection.edges.length} of ${projection.candidateEdgeCount} candidate edges but reports ${projection.omittedEdgeCount} omitted`,
    );
  }
  const nodeIds = new Set(projection.nodes.map((node) => node.characterId));
  for (const edge of projection.edges) {
    if (!nodeIds.has(edge.sourceCharacterId) || !nodeIds.has(edge.targetCharacterId)) {
      throw new RelationshipGraphError(
        'RELATIONSHIP_GRAPH_DANGLING_EDGE',
        `edge ${edge.pairKey} names a character the graph does not render`,
      );
    }
    for (const change of edge.recentChanges) {
      if (!isWithinRecentChangeWindow(change.worldDay, projection.worldDay)) {
        throw new RelationshipGraphError(
          'RELATIONSHIP_GRAPH_WINDOW_VIOLATION',
          `edge ${edge.pairKey} carries a day-${change.worldDay} change outside the window ending on day ${projection.worldDay}`,
        );
      }
    }
  }
  return projection;
}
