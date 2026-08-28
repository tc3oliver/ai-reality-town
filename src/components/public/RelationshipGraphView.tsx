import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, type RequestForQueries } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import { relationshipGraphModelRef } from '../../../convex/shared/relationshipGraphRef';
import {
  composeRelationshipGraphViewModel,
  currentWorldDay,
  parseRelationshipGraphRoute,
  type GraphCharacterPayload,
  type LiveClockPayload,
  type RelationshipGraphFilter,
  type RelationshipGraphPayload,
  type RelationshipGraphViewModel,
} from './relationshipGraphRoute';

/**
 * Public scoped relationship graph (FR-I007 + NFR-002 / ART-44).
 *
 * Reads ONLY published projections through the failure-isolated public read model — no generation
 * on read, and no mutation of any kind. Two reads: `live:<worldId>` for the world clock, which
 * bounds the date stepper, and `relationshipGraph:<worldId>:<worldDay>` for the graph itself.
 *
 * ## The default is the server's, not this page's
 *
 * AC#1's scope (current-arc core characters, one-hop relationships, changes in the last seven
 * world days) and AC#3's thirty-node cap are applied BEFORE publication. This page cannot widen
 * them, because the payload does not contain a wider graph to widen to. The only control that
 * narrows anything here is the relationship-type filter (AC#2).
 *
 * ## The diagram is not the only way to read it
 *
 * The node-link diagram is `role="img"` with a summarising label, and beside it — never behind a
 * toggle — is the full text equivalent: every character, their hop, every relationship, its type,
 * strength, last change day and reason. ART-94 owns the full P1 accessibility pass; this is the
 * baseline every public page here already meets, plus the one thing a graph specifically needs.
 *
 * Thin render layer: all route, filter, layout and copy logic lives in
 * {@link ./relationshipGraphRoute} (pure, unit-tested).
 */

const ALL_TYPES = '__all__';

/**
 * The current `location.hash`, kept in sync with the browser.
 *
 * Every other public page reads `window.location.hash` once during render and gets away with it,
 * because none of them links to a DIFFERENT hash of the SAME route — following a link from
 * `#arc/…` to `#character/…` re-enters `PublicRoute` through a different branch and remounts.
 *
 * Date switching is exactly that case: `#graph/w/7` → `#graph/w/6` changes no route branch and
 * fires no navigation, so a component that read the hash at render time went on displaying day 7
 * with day 6 in the address bar. The browser E2E caught it; no unit test could have, because the
 * defect is a missing subscription rather than a wrong value.
 *
 * `subscribe` is registered in an effect (never during render) and torn down with the component,
 * so no listener outlives the page.
 */
function useLocationHash(): string {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    // Read once more on mount: the hash can have changed between the initial state and the
    // listener being attached, and a page that missed that would be stale from its first paint.
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

export default function RelationshipGraphView() {
  const hash = useLocationHash();
  const route = parseRelationshipGraphRoute(hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls, no mutations.
  const liveResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'liveState', modelRef: `live:${worldId}` } : 'skip',
  );

  const latestWorldDay = currentWorldDay((liveResult?.payload ?? null) as LiveClockPayload);
  // The route's day when it names one, else the world's current day. `null` until the live read
  // settles, which is why the graph read below is skipped rather than sent for day 0.
  const worldDay = route?.worldDay ?? latestWorldDay;

  const graphResult = useQuery(
    getPublishedReadModelRef,
    enabled && worldDay !== null
      ? {
        worldId,
        modelKind: 'relationshipGraph',
        // Built with the SAME helper the server and the E2E fixture use, so the key cannot drift.
        modelRef: relationshipGraphModelRef(worldId, worldDay),
      }
      : 'skip',
  );

  /**
   * AC#2 人物摘要, read LIVE — one `character:<id>` per rendered node.
   *
   * Not carried in the graph payload, and that is a safety requirement rather than a layering
   * choice. Character text is subject to ART-132's retroactive withhold — a day-5 Scene can be
   * refused on day 9 — while a past day's graph is published once, when that day is current, and
   * never rebuilt. A summary baked into the graph would freeze at publication and could never
   * self-heal, permanently, for every past day. `character:<id>` is rebuilt whenever the character
   * moves, so reading it here makes the withhold automatic.
   *
   * `useQueries` rather than a `useQuery` per node: the node set is data-dependent and the rules
   * of hooks forbid a loop. It is the same transport `useQuery` uses (`useQueries` →
   * `QueriesObserver` → `watchQuery`), so the E2E fixture answers these exactly as it answers the
   * two above. Bounded at {@link RELATIONSHIP_GRAPH_MAX_NODES} by construction — the payload
   * cannot contain more than thirty nodes — and each is a cached read-model lookup that triggers
   * no generation.
   */
  const graphPayload = (graphResult?.payload ?? null) as RelationshipGraphPayload | null;
  /**
   * MEMOISED on the node id list, and that is not an optimisation.
   *
   * `useQueries` memoises its subscription on the `queries` object IDENTITY. A fresh object literal
   * each render makes the subscription re-created every render, which re-enters `setQueries` and
   * renders again — an infinite loop that renders as a blank page, not as an error. The browser
   * E2E caught exactly that: every graph spec failed with "no h1 found", which is the ART-146
   * signature and looked nothing like a hook-dependency bug.
   *
   * The key is the joined id list rather than the payload, because that is what the query set
   * actually depends on: a rebuild that changed an edge weight but not the node set must not
   * re-subscribe thirty character reads.
   */
  const characterIdKey = (graphPayload?.nodes ?? []).map((node) => node.characterId).join('|');
  const characterQueries = useMemo<RequestForQueries>(() => {
    const queries: RequestForQueries = {};
    if (worldId === null || characterIdKey.length === 0) return queries;
    for (const characterId of characterIdKey.split('|')) {
      queries[characterId] = {
        query: getPublishedReadModelRef,
        args: { worldId, modelKind: 'character', modelRef: `character:${characterId}` },
      };
    }
    return queries;
  }, [worldId, characterIdKey]);
  const characterResults = useQueries(characterQueries);
  const characters: Record<string, GraphCharacterPayload | undefined> = {};
  for (const [characterId, result] of Object.entries(characterResults)) {
    // An Error from one character's read costs that node its label, not the page. `useQueries`
    // returns the error in place of the value rather than throwing, which is what makes a single
    // failed read survivable here at all.
    if (result instanceof Error) continue;
    if (result === undefined) continue;
    characters[characterId] = (result?.payload ?? null) as GraphCharacterPayload;
  }

  const [relationshipType, setRelationshipType] = useState<string>(ALL_TYPES);

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">關係圖</h1>
        <p className="mt-2">
          網址格式應為 <code>#graph/&lt;worldId&gt;</code> 或 <code>#graph/&lt;worldId&gt;/&lt;世界日&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (liveResult === undefined || (worldDay !== null && graphResult === undefined)) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">關係圖</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }
  if (worldDay === null) {
    // The world has published no clock, so there is no day to draw and no honest default to pick.
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">關係圖</h1>
        <p className="mt-2">這個世界尚未發布世界時間,因此還沒有可顯示的關係圖。</p>
      </PublicPageFrame>
    );
  }

  const projection = graphPayload;
  /**
   * A selection the NEW day does not offer falls back to 全部.
   *
   * Date switching keeps the filter, which is what a viewer comparing two days wants. But a type
   * present on day 7 need not be present on day 6, and a `<select>` whose `value` matches no
   * `<option>` renders blank — a control that looks broken while silently filtering everything
   * out. Falling back is the honest answer: the day has no such relationships to show.
   */
  const effectiveType = relationshipType !== ALL_TYPES
    && projection !== null
    && !projection.relationshipTypes.includes(relationshipType)
    ? ALL_TYPES
    : relationshipType;

  const filter: RelationshipGraphFilter = {
    relationshipType: effectiveType === ALL_TYPES ? null : effectiveType,
  };
  const vm = composeRelationshipGraphViewModel({
    worldId,
    worldDay,
    projection,
    filter,
    latestWorldDay,
    characters,
  });

  return (
    <RelationshipGraphBody
      worldId={worldId}
      vm={vm}
      relationshipType={effectiveType}
      onRelationshipTypeChange={setRelationshipType}
    />
  );
}

/**
 * Presentational graph. Split out from the data-fetching default export so the accessibility
 * suite can render the real markup without a Convex client.
 */
export function RelationshipGraphBody({
  worldId,
  vm,
  relationshipType = ALL_TYPES,
  onRelationshipTypeChange,
}: {
  worldId: string;
  vm: RelationshipGraphViewModel;
  relationshipType?: string;
  onRelationshipTypeChange?: (value: string) => void;
}) {
  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">關係圖</h1>
        <p className="text-sm public-muted">
          世界日 {vm.worldDay}
          {vm.arcTitle !== null && `・故事線:${vm.arcTitle}`}
          {vm.arcStatusLabel !== null && `(${vm.arcStatusLabel})`}
        </p>
      </header>

      {/* AC#2 日期切換 — real links, so a day is shareable and works without JavaScript. */}
      <section className="graph-controls mt-4" aria-labelledby="graph-controls">
        <h2 id="graph-controls" className="text-xl font-semibold">檢視設定</h2>
        <nav aria-label="關係圖日期切換">
          <ul className="public-rows flex flex-wrap gap-3">
            <li>
              {vm.previousDayHref !== null ? (
                <a className="public-tap" href={vm.previousDayHref} aria-label={`查看世界日 ${vm.worldDay - 1} 的關係圖`}>
                  前一日
                </a>
              ) : <span className="public-muted text-sm">已是最早一日</span>}
            </li>
            <li>
              {vm.nextDayHref !== null ? (
                <a className="public-tap" href={vm.nextDayHref} aria-label={`查看世界日 ${vm.worldDay + 1} 的關係圖`}>
                  後一日
                </a>
              ) : <span className="public-muted text-sm">已是最新一日</span>}
            </li>
            {vm.arcHref !== null && (
              <li>
                <a className="public-tap" href={vm.arcHref}>查看這條故事線</a>
              </li>
            )}
          </ul>
        </nav>

        {/* AC#2 關係類型篩選. Narrows the published set; there is no control that widens it.
            Toggle buttons rather than a <select> so the active filter is announced by
            `aria-pressed` and drawn with a thicker border and heavier weight
            (`.public-tap[aria-pressed='true']`, index.css) — a state that survives greyscale,
            which a selected option in a closed dropdown does not. */}
        <div
          className="graph-type-filter mt-2 flex flex-wrap gap-2"
          role="group"
          aria-labelledby="graph-type-filter-label"
        >
          <span id="graph-type-filter-label" className="text-sm">關係類型</span>
          {[{ value: ALL_TYPES, label: '全部' }, ...vm.typeOptions].map((option) => (
            <button
              key={option.value}
              type="button"
              className="public-tap"
              aria-pressed={relationshipType === option.value}
              // Every button renders two characters of Chinese, so the accessible name carries
              // what it filters (WCAG 2.4.4) while still starting with the visible label (2.5.3).
              aria-label={option.value === ALL_TYPES
                ? '全部關係類型'
                : `${option.label}關係`}
              onClick={() => onRelationshipTypeChange?.(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* AC#3 — the scope is stated whether or not anything was truncated, so the default is
            never mistaken for a picture of the whole town. */}
        <p className="mt-2 text-sm public-muted">{vm.scopeNotice}</p>
        {vm.truncationNotice !== null && (
          <p className="mt-2 text-sm public-muted">{vm.truncationNotice}</p>
        )}
      </section>

      {vm.hasContent ? (
        <>
          <section className="graph-diagram mt-4" aria-labelledby="graph-diagram">
            <h2 id="graph-diagram" className="text-xl font-semibold">關係圖示</h2>
            <RelationshipDiagram vm={vm} />
          </section>

          {/* The non-visual equivalent, beside the diagram rather than behind a toggle. */}
          <section className="graph-people mt-4" aria-labelledby="graph-people">
            <h2 id="graph-people" className="text-xl font-semibold">人物與關係</h2>
            <ul className="public-rows">
              {vm.nodes.map((node) => (
                <li key={node.characterId} className="mt-3">
                  <h3 className="text-lg font-semibold">
                    <a className="public-tap" href={node.href}>{node.name}</a>
                  </h3>
                  <p className="text-sm public-muted">
                    {node.isCoreCharacter ? '故事線核心人物' : '一階關係人物'}
                    {node.occupation !== null && `・${node.occupation}`}
                  </p>
                  {/* AC#2 人物摘要 */}
                  <p className="text-sm">{node.summary}</p>
                  {node.relationships.length > 0 ? (
                    <ul className="public-rows text-sm">
                      {node.relationships.map((relationship) => (
                        // Each edge is its own labelled group, so an edge read out of context
                        // still says which two people it is about — the per-edge accessible name
                        // a graph needs and a bare list item does not carry.
                        <li
                          key={relationship.pairKey}
                          className="mt-1 graph-edge-row"
                          aria-label={`${node.name} 與 ${relationship.otherName} 的關係`}
                        >
                          與 {relationship.otherName}:{relationship.typeLabel}(強度 {relationship.strength})
                          ,最近變化於世界日 {relationship.lastChangedWorldDay}
                          {/* AC#2 關係變化原因 */}
                          {relationship.reasons.length > 0 && `・原因:${relationship.reasons.join(';')}`}
                          {relationship.furtherChangeCount > 0
                            && `・另有 ${relationship.furtherChangeCount} 次變化未列出`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm public-muted">在目前的篩選條件下沒有可顯示的關係。</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <section className="graph-empty mt-4" aria-labelledby="graph-empty">
          <h2 id="graph-empty" className="text-xl font-semibold">目前沒有可顯示的關係</h2>
          <p className="text-sm">
            這一天沒有進行中的故事線,或核心人物在最近期間內沒有公開的關係變化。
          </p>
        </section>
      )}
    </PublicPageFrame>
  );
}

/**
 * The node-link diagram.
 *
 * `role="img"` with a label that says what it shows and where the same information is written
 * out, and `aria-hidden` internals: a screen reader that walked the geometry would announce a
 * list of coordinates, which is worse than nothing when the text equivalent is the next section
 * down. Nothing inside is focusable, so it does not add stops to the tab order for content that
 * is reachable in words.
 *
 * `viewBox` with no width or height attribute, so it scales with its column instead of forcing a
 * horizontal scrollbar on a narrow viewport (WCAG 1.4.10).
 */
function RelationshipDiagram({ vm }: { vm: RelationshipGraphViewModel }) {
  const label = `關係圖示:${vm.nodes.length} 位人物、${vm.visibleEdgeCount} 段關係。`
    + '圖中央為故事線核心人物,外圈為一階關係人物。完整內容以文字列於下方「人物與關係」。';
  return (
    <svg className="graph-canvas" viewBox="0 0 100 100" role="img" aria-label={label}>
      <g aria-hidden="true">
        {vm.lines.map((line) => (
          <line
            key={line.pairKey}
            className="graph-edge"
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
          />
        ))}
        {vm.points.map((point) => (
          <circle
            key={point.characterId}
            className={point.isCoreCharacter ? 'graph-node graph-node-core' : 'graph-node'}
            cx={point.x}
            cy={point.y}
            r={point.isCoreCharacter ? 3.2 : 2.2}
          />
        ))}
      </g>
    </svg>
  );
}
