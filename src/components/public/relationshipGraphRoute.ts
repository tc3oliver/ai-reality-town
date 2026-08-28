/**
 * Pure, testable logic for the public scoped relationship graph (FR-I007, ART-44).
 *
 * Mirrors {@link ./timelineRoute} and {@link ./arcRoute}: the React component is a thin render
 * layer and the correctness boundaries — route resolution, date stepping, relationship-type
 * filtering, the deterministic diagram layout, and the non-visual text equivalent — live here as
 * pure functions, unit-tested without a DOM.
 *
 * ## What this module deliberately does NOT do
 *
 * It never widens the graph. AC#1's default (current-arc core people, one hop, changes in the
 * last seven world days) and AC#3's thirty-node cap are enforced SERVER-SIDE, in
 * `convex/publicRead/relationshipGraphProjection.ts`, and this page renders whatever that
 * published. There is no client-side path to a wider graph — not because the code declines to
 * take it, but because the payload does not contain one: the graph is scoped before it is
 * published, so a viewer with a devtools console sees the same thirty nodes.
 *
 * The one thing the client filters is the relationship TYPE (AC#2 關係類型篩選), which narrows
 * the published set and can never widen it.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness.
 */

/** Published `relationshipGraph:<worldId>:<worldDay>` — the fields the page reads. */
export type RelationshipGraphPayload = {
  worldDay: number;
  arc: { arcId: string; title: string; status: string } | null;
  nodes: Array<{
    characterId: string;
    isCoreCharacter: boolean;
    hop: number;
    edgeCount: number;
  }>;
  edges: Array<{
    pairKey: string;
    sourceCharacterId: string;
    targetCharacterId: string;
    relationshipType: string;
    strength: number;
    lastChangedWorldDay: number;
    recentChanges: Array<{ eventId: string; worldDay: number; reason: string }>;
    changeCountInWindow: number;
  }>;
  relationshipTypes: string[];
  scope: { windowDays: number; nodeLimit: number; nodeOrdering: string };
  candidateNodeCount: number;
  candidateEdgeCount: number;
  omittedNodeCount: number;
  omittedEdgeCount: number;
};

/** The published `live:<worldId>` fields this page needs: the world clock, for date bounds. */
export type LiveClockPayload = { worldTime?: { worldDay?: number } | null } | null;

/**
 * The published `character:<id>` fields this page reads for AC#2 人物摘要.
 *
 * Read LIVE per node rather than taken from the graph payload. Character text is subject to
 * ART-132's retroactive withhold, and a past day's graph is published once and never rebuilt — so
 * a summary carried in the graph would freeze at publication and could never self-heal.
 * `character:<id>` is rebuilt whenever the character moves, so reading it here makes the withhold
 * automatic. See `docs/scoped-relationship-graph.md` §2.
 *
 * `undefined` means the read is still in flight; `null` means the character has no published
 * projection. The two are rendered the same way — the id as a label and no summary — because
 * neither is a claim about the person.
 */
export type GraphCharacterPayload = {
  name?: string | null;
  occupation?: string | null;
  publicProfile?: string | null;
  alive?: boolean;
} | null;

/** How much of a published `publicProfile` the graph shows. */
export const MAX_GRAPH_SUMMARY_CHARS = 40;

export type RelationshipGraphFilter = { relationshipType: string | null };

/**
 * zh-Hant labels for the six Canon dimensions, plus `neutral`.
 *
 * A relationship's "type" is its dominant dimension — see `RELATIONSHIP_GRAPH_TYPES` in the
 * builder for why there is no richer taxonomy to name. `neutral` is not a seventh flavour: it is
 * the honest label for a pair whose dimensions have moved and moved back.
 */
export const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  trust: '信任',
  affection: '好感',
  resentment: '敵意',
  fear: '恐懼',
  dependency: '依賴',
  familiarity: '熟悉',
  neutral: '中立',
};

const ARC_STATUS_LABELS: Record<string, string> = {
  active: '進行中',
  escalating: '升溫中',
  climax: '高潮',
  resolving: '收束中',
  resolved: '已完結',
  archived: '已封存',
};

/**
 * The ordering token this page knows how to explain.
 *
 * Compared against `scope.nodeOrdering` rather than assumed: the server publishes which rule it
 * truncated under, and a page that hard-coded the explanation would go on giving it after the
 * rule changed. An unrecognised token produces the honest fallback below instead.
 */
export const KNOWN_NODE_ORDERING = 'core_first_then_recent_change_desc';

export const NO_SUMMARY = '(尚無公開簡介)';

/**
 * Shorten a published `publicProfile` for a graph node, or say there is none.
 *
 * Counts the ellipsis inside the budget, matching `truncateForPublic` in
 * `convex/shared/publicText.ts`. Not imported from there: `clientPublic` may depend on `shared`,
 * but this budget is the graph's own and the two rules are allowed to differ — what must not
 * differ is that both cut at a character count rather than at a word boundary, since Chinese has
 * none.
 */
export function truncateGraphSummary(publicProfile: string | null): string {
  const trimmed = (publicProfile ?? '').trim();
  if (trimmed.length === 0) return NO_SUMMARY;
  if (trimmed.length <= MAX_GRAPH_SUMMARY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_GRAPH_SUMMARY_CHARS - 1).trimEnd()}…`;
}

export type RelationshipGraphNodeView = {
  characterId: string;
  name: string;
  summary: string;
  occupation: string | null;
  isCoreCharacter: boolean;
  href: string;
  /** Relationships of this character that survive the active filter, newest change first. */
  relationships: Array<{
    pairKey: string;
    otherCharacterId: string;
    otherName: string;
    typeLabel: string;
    relationshipType: string;
    strength: number;
    lastChangedWorldDay: number;
    reasons: string[];
    /** Changes in the window beyond the reasons carried, or 0. */
    furtherChangeCount: number;
  }>;
};

/** One placed node in the diagram, in a 0–100 square. */
export type RelationshipGraphPoint = {
  characterId: string;
  name: string;
  isCoreCharacter: boolean;
  x: number;
  y: number;
};

export type RelationshipGraphViewModel = {
  /** False when nothing has been published for this world day at all. */
  hasContent: boolean;
  worldDay: number;
  arcTitle: string | null;
  arcStatusLabel: string | null;
  arcHref: string | null;
  nodes: RelationshipGraphNodeView[];
  typeOptions: Array<{ value: string; label: string }>;
  /** Node/edge counts AFTER the type filter, for the diagram and the summary line. */
  visibleEdgeCount: number;
  /** The scope sentence — always shown, so the default is never mistaken for the whole world. */
  scopeNotice: string;
  /** The truncation sentence, or null when nothing was omitted. */
  truncationNotice: string | null;
  /** Previous / next world day, or null at the ends of the published range. */
  previousDayHref: string | null;
  nextDayHref: string | null;
  /** Deterministic diagram geometry. Empty when there is nothing to draw. */
  points: RelationshipGraphPoint[];
  lines: Array<{ pairKey: string; from: RelationshipGraphPoint; to: RelationshipGraphPoint }>;
};

/**
 * Resolve `#graph/<worldId>` and `#graph/<worldId>/<worldDay>`.
 *
 * The day is optional so a link can name a world without knowing its clock; the page then
 * defaults to the world's current day, which it reads from `live:<worldId>`. Returns null for a
 * bare or malformed route so the component can surface a format hint rather than a blank page.
 */
export function parseRelationshipGraphRoute(
  hash: string,
): { worldId: string; worldDay: number | null } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^graph\/([^/]+)(?:\/(\d+))?$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  if (worldId.length === 0) return null;
  const worldDay = match[2] === undefined ? null : Number(match[2]);
  if (worldDay !== null && (!Number.isSafeInteger(worldDay) || worldDay < 0)) return null;
  return { worldId, worldDay };
}

export function relationshipGraphHref(worldId: string, worldDay: number): string {
  return `#graph/${encodeURIComponent(worldId)}/${worldDay}`;
}

/** The world's current day from the published live projection, or null when it has none. */
export function currentWorldDay(live: LiveClockPayload): number | null {
  const worldDay = live?.worldTime?.worldDay;
  return typeof worldDay === 'number' && Number.isSafeInteger(worldDay) && worldDay >= 0
    ? worldDay
    : null;
}

/**
 * Place nodes on two concentric rings: core characters inside, one-hop neighbours outside.
 *
 * Deterministic by construction — the angle is a function of the node's INDEX in the published
 * order, which the server already fixed — so two viewers of the same day see the same picture and
 * a re-render never reshuffles it. No randomness, no force simulation, no measurement of the DOM.
 *
 * The ring split is not decoration: it is the second, redundant encoding of `hop`, which is also
 * stated in words in the text equivalent. Distance from the centre therefore means the same thing
 * the label says, rather than being the only place it is said.
 */
export function layoutRelationshipGraph(
  nodes: ReadonlyArray<{ characterId: string; name: string; isCoreCharacter: boolean }>,
): RelationshipGraphPoint[] {
  const core = nodes.filter((node) => node.isCoreCharacter);
  const outer = nodes.filter((node) => !node.isCoreCharacter);
  const place = (
    group: typeof core,
    radius: number,
  ): RelationshipGraphPoint[] => group.map((node, index) => {
    // A single node sits at the centre rather than at an arbitrary point on its ring.
    if (group.length === 1 && radius <= 22) {
      return { characterId: node.characterId, name: node.name, isCoreCharacter: node.isCoreCharacter, x: 50, y: 50 };
    }
    const angle = (2 * Math.PI * index) / Math.max(1, group.length) - Math.PI / 2;
    return {
      characterId: node.characterId,
      name: node.name,
      isCoreCharacter: node.isCoreCharacter,
      // Rounded, so the payload-to-geometry mapping is stable across platforms rather than
      // carrying float noise that would differ in the last digit between engines.
      x: Math.round((50 + radius * Math.cos(angle)) * 100) / 100,
      y: Math.round((50 + radius * Math.sin(angle)) * 100) / 100,
    };
  });
  return [...place(core, 18), ...place(outer, 42)];
}

/** Apply the relationship-type filter (AC#2). A null filter matches every type. */
export function edgeMatchesFilter(
  edge: { relationshipType: string },
  filter: RelationshipGraphFilter,
): boolean {
  return filter.relationshipType === null || edge.relationshipType === filter.relationshipType;
}

function typeLabel(relationshipType: string): string {
  return RELATIONSHIP_TYPE_LABELS[relationshipType] ?? relationshipType;
}

/**
 * Compose the render model from the published graph and the active filter.
 *
 * Degrades to an empty model when the projection is null — which is what a day the world has not
 * reached, or has not published a graph for, returns. That is a real state and the page says so,
 * rather than rendering an empty diagram that reads like "these people have no relationships".
 */
export function composeRelationshipGraphViewModel(input: {
  worldId: string;
  worldDay: number;
  projection: RelationshipGraphPayload | null;
  filter: RelationshipGraphFilter;
  /** The world's current day, when known: the upper bound of the date stepper. */
  latestWorldDay: number | null;
  /**
   * Live `character:<id>` payloads by character id, for 人物摘要 (AC#2).
   *
   * Absent or `undefined` for a node whose read has not settled. Defaulted to `{}` so a caller
   * with no character data renders structurally-complete nodes labelled by id — which is what the
   * page shows for the instant before the reads land.
   */
  characters?: Readonly<Record<string, GraphCharacterPayload | undefined>>;
}): RelationshipGraphViewModel {
  const { projection } = input;
  const previousDayHref = input.worldDay > 0
    ? relationshipGraphHref(input.worldId, input.worldDay - 1)
    : null;
  const nextDayHref = input.latestWorldDay !== null && input.worldDay < input.latestWorldDay
    ? relationshipGraphHref(input.worldId, input.worldDay + 1)
    : null;

  if (projection === null) {
    return {
      hasContent: false,
      worldDay: input.worldDay,
      arcTitle: null,
      arcStatusLabel: null,
      arcHref: null,
      nodes: [],
      typeOptions: [],
      visibleEdgeCount: 0,
      scopeNotice: '這一天尚未發布關係圖。',
      truncationNotice: null,
      previousDayHref,
      nextDayHref,
      points: [],
      lines: [],
    };
  }

  const characters = input.characters ?? {};
  // The published name when the character read has landed, else the id. A blank label would
  // render an anonymous node; the id is a poor label but an honest one.
  const displayName = (characterId: string) => characters[characterId]?.name ?? characterId;
  const visibleEdges = projection.edges.filter((edge) => edgeMatchesFilter(edge, input.filter));

  const nodes: RelationshipGraphNodeView[] = projection.nodes.map((node) => ({
    characterId: node.characterId,
    name: displayName(node.characterId),
    summary: truncateGraphSummary(characters[node.characterId]?.publicProfile ?? null),
    occupation: characters[node.characterId]?.occupation ?? null,
    isCoreCharacter: node.isCoreCharacter,
    href: `#character/${encodeURIComponent(input.worldId)}/${encodeURIComponent(node.characterId)}`,
    relationships: visibleEdges
      .filter((edge) => edge.sourceCharacterId === node.characterId || edge.targetCharacterId === node.characterId)
      .map((edge) => {
        const otherCharacterId = edge.sourceCharacterId === node.characterId
          ? edge.targetCharacterId
          : edge.sourceCharacterId;
        return {
          pairKey: edge.pairKey,
          otherCharacterId,
          otherName: displayName(otherCharacterId),
          typeLabel: typeLabel(edge.relationshipType),
          relationshipType: edge.relationshipType,
          strength: edge.strength,
          lastChangedWorldDay: edge.lastChangedWorldDay,
          reasons: edge.recentChanges.map((change) => change.reason).filter((reason) => reason.length > 0),
          furtherChangeCount: Math.max(0, edge.changeCountInWindow - edge.recentChanges.length),
        };
      }),
  }));

  // Laid out from the VIEW nodes, so a point carries the resolved display name rather than the
  // bare id the payload now holds.
  const points = layoutRelationshipGraph(nodes);
  const pointById = new Map(points.map((point) => [point.characterId, point]));
  const lines = visibleEdges.flatMap((edge) => {
    const from = pointById.get(edge.sourceCharacterId);
    const to = pointById.get(edge.targetCharacterId);
    return from === undefined || to === undefined ? [] : [{ pairKey: edge.pairKey, from, to }];
  });

  /**
   * The scope sentence. Shown ALWAYS, populated or not.
   *
   * FR-I007's real requirement is that a viewer is never led to believe the default is the whole
   * world. A notice that appeared only when something was truncated would leave the small-world
   * case — the one where the default happens to be complete — reading as an unqualified picture
   * of the town.
   */
  const scopeNotice = `預設只顯示「${projection.arc?.title ?? '目前故事線'}」的核心人物、與他們的一階關係,`
    + `且限於最近 ${projection.scope.windowDays} 個世界日內有變化的關係;不會顯示全部角色與全部關係。`;

  const truncationNotice = projection.omittedNodeCount > 0 || projection.omittedEdgeCount > 0
    ? `符合條件的有 ${projection.candidateNodeCount} 人、${projection.candidateEdgeCount} 段關係,`
      + `因上限 ${projection.scope.nodeLimit} 人而未顯示 ${projection.omittedNodeCount} 人、${projection.omittedEdgeCount} 段關係。`
      + (projection.scope.nodeOrdering === KNOWN_NODE_ORDERING
        ? '保留順序為:故事線核心人物優先,其餘依最近變化日期由新到舊。'
        : '(本頁不認得伺服器使用的保留順序,因此無法說明省略的依據。)')
    : null;

  return {
    hasContent: projection.nodes.length > 0,
    worldDay: projection.worldDay,
    arcTitle: projection.arc?.title ?? null,
    arcStatusLabel: projection.arc === null
      ? null
      : ARC_STATUS_LABELS[projection.arc.status] ?? projection.arc.status,
    arcHref: projection.arc === null
      ? null
      : `#arc/${encodeURIComponent(input.worldId)}/${encodeURIComponent(projection.arc.arcId)}`,
    nodes,
    typeOptions: projection.relationshipTypes.map((relationshipType) => ({
      value: relationshipType,
      label: typeLabel(relationshipType),
    })),
    visibleEdgeCount: visibleEdges.length,
    scopeNotice,
    truncationNotice,
    previousDayHref,
    nextDayHref,
    points,
    lines,
  };
}
