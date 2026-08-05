import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import {
  composeArcViewModel,
  parseArcRoute,
  type ArcPrimerPayload,
  type ArcProjectionPayload,
  type ArcViewModel,
} from './arcRoute';

/**
 * Public Story Arc detail page (FR-I006). Reads ONLY the published
 * `arc:<arcId>` projection (ART-65/ART-95) and the bounded `primer:<arcId>`
 * primer (ART-38) via the failure-isolated public read model — no generation on
 * read. Renders the full FR-I006 arc card: premise, current question, status,
 * core people, essential backstory, inciting event, latest turning point,
 * recommended entry, related episodes, known clues, unresolved questions, and
 * the outcome once the arc resolves.
 *
 * Publication boundary (AC#2): both projections are field-allowlisted
 * server-side and re-sanitised on read; the view model is built from named
 * fields only ({@link ./arcRoute}) so forbidden keys can never reach the render.
 * Resolved and archived arcs stay fully readable but are badged as inactive
 * context (AC#3).
 *
 * Thin render layer over pure, unit-tested logic. Accessibility (ART-93 /
 * NFR-009): each section is named by its own visible heading via
 * `aria-labelledby` instead of an English `aria-label` that contradicted the
 * visible Chinese one, and muted text uses the measured `.public-muted` token.
 */

export default function ArcDetailPage() {
  const route = typeof window === 'undefined' ? null : parseArcRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const arcId = route?.arcId ?? null;
  const enabled = route !== null;

  // Public reads only — no provider calls.
  const arcResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'arc', modelRef: `arc:${arcId}` } : 'skip',
  );
  const primerResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'arc', modelRef: `primer:${arcId}` } : 'skip',
  );

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">故事線</h1>
        <p className="mt-2">
          網址格式應為 <code>#arc/&lt;worldId&gt;/&lt;arcId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (arcResult === undefined) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">故事線</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }

  const vm = composeArcViewModel({
    worldId: worldId as string,
    arc: (arcResult?.payload ?? null) as ArcProjectionPayload | null,
    primer: (primerResult?.payload ?? null) as ArcPrimerPayload | null,
  });

  if (!vm.hasContent) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">故事線</h1>
        <p className="mt-2">這條故事線尚未發布公開頁面。</p>
      </PublicPageFrame>
    );
  }

  return <ArcDetailView worldId={worldId as string} vm={vm} />;
}

/**
 * Presentational arc detail. Split out from the data-fetching default export so
 * the accessibility suite can render the real markup without a Convex client.
 */
export function ArcDetailView({ worldId, vm }: { worldId: string; vm: ArcViewModel }) {
  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">{vm.title}</h1>
        <p className="text-sm public-muted">
          狀態:{vm.statusLabel.label}
          {vm.statusLabel.isActiveContext ? '' : '(非進行中故事線)'}
        </p>
      </header>

      {vm.premise && (
        <section className="arc-premise mt-4" aria-labelledby="arc-premise">
          <h2 id="arc-premise" className="text-xl font-semibold">故事前提</h2>
          <p>{vm.premise}</p>
        </section>
      )}

      {vm.currentQuestion && (
        <section className="arc-question mt-4" aria-labelledby="arc-question">
          <h2 id="arc-question" className="text-xl font-semibold">當前問題</h2>
          <p>{vm.currentQuestion}</p>
        </section>
      )}

      <section className="arc-people mt-4" aria-labelledby="arc-people">
        <h2 id="arc-people" className="text-xl font-semibold">核心人物</h2>
        {vm.coreCharacters.length > 0 ? (
          <ul>
            {vm.coreCharacters.map((person) => (
              <li key={person.characterId} className="text-sm">
                <a href={person.href}>{person.name}</a>
                {person.role && <span className="public-muted">({person.role})</span>}
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">尚未公開核心人物。</p>}
      </section>

      {vm.essentialBackstory.length > 0 && (
        <section className="arc-backstory mt-4" aria-labelledby="arc-backstory">
          <h2 id="arc-backstory" className="text-xl font-semibold">必要前情</h2>
          <ul className="text-sm">
            {vm.essentialBackstory.map((fact) => <li key={fact.factId}>{fact.label}</li>)}
          </ul>
        </section>
      )}

      <section className="arc-turning-points mt-4" aria-labelledby="arc-turning-points">
        <h2 id="arc-turning-points" className="text-xl font-semibold">轉折</h2>
        <ul className="text-sm">
          <li>起始事件:{vm.incitingEventId || '—'}</li>
          <li>
            最近轉折:{vm.latestTurningPoint
              ? (vm.latestTurningPoint.summary ?? vm.latestTurningPoint.eventId)
              : '尚無'}
          </li>
        </ul>
      </section>

      <section className="arc-entry mt-4" aria-labelledby="arc-entry">
        <h2 id="arc-entry" className="text-xl font-semibold">建議切入點</h2>
        {vm.recommendedEntry ? (
          <p className="text-sm">
            不必從第一集開始,建議從
            <a href={vm.recommendedEntry.href} className="mx-1">
              第 {vm.recommendedEntry.episodeNumber} 集(日 {vm.recommendedEntry.worldDay})
            </a>
            切入。
          </p>
        ) : <p className="public-muted">尚無建議切入點。</p>}
      </section>

      <section className="arc-episodes mt-4" aria-labelledby="arc-episodes">
        <h2 id="arc-episodes" className="text-xl font-semibold">相關集數</h2>
        {vm.relatedEpisodes.length > 0 ? (
          <ul>
            {vm.relatedEpisodes.map((episode) => (
              <li key={episode.episodeNumber} className="text-sm">
                <a href={episode.href}>
                  第 {episode.episodeNumber} 集(日 {episode.worldDay})
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">尚無相關集數。</p>}
      </section>

      <section className="arc-clues mt-4" aria-labelledby="arc-clues">
        <h2 id="arc-clues" className="text-xl font-semibold">已知線索</h2>
        {vm.knownClues.length > 0 ? (
          <ul className="text-sm">
            {vm.knownClues.map((clue) => <li key={clue.factId}>{clue.label}</li>)}
          </ul>
        ) : <p className="public-muted">尚無公開線索。</p>}
      </section>

      <section className="arc-questions mt-4" aria-labelledby="arc-questions">
        <h2 id="arc-questions" className="text-xl font-semibold">未解問題</h2>
        {vm.unresolvedQuestions.length > 0 ? (
          <ul className="text-sm">
            {vm.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        ) : <p className="public-muted">尚無未解問題。</p>}
      </section>

      {vm.outcome && (
        <section className="arc-outcome mt-4" aria-labelledby="arc-outcome">
          <h2 id="arc-outcome" className="text-xl font-semibold">結局</h2>
          <p>{vm.outcome.summary}</p>
        </section>
      )}
    </PublicPageFrame>
  );
}
