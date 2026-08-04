import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  composeArcViewModel,
  parseArcRoute,
  type ArcPrimerPayload,
  type ArcProjectionPayload,
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
 * Thin render layer over pure, unit-tested logic. Semantic headings and
 * keyboard-navigable links throughout.
 */

export default function ArcDetailPage() {
  const route = typeof window === 'undefined' ? null : parseArcRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const arcId = route?.arcId ?? null;
  const enabled = route !== null;

  // Public reads only — no provider calls.
  const arcResult = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'arc', modelRef: `arc:${arcId}` } : 'skip',
  );
  const primerResult = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'arc', modelRef: `primer:${arcId}` } : 'skip',
  );

  if (!enabled) {
    return <Frame worldId={null}><p>網址格式應為 <code>#arc/&lt;worldId&gt;/&lt;arcId&gt;</code></p></Frame>;
  }
  if (arcResult === undefined) {
    return <Frame worldId={worldId}><p>載入中…</p></Frame>;
  }

  const vm = composeArcViewModel({
    worldId: worldId as string,
    arc: (arcResult?.payload ?? null) as ArcProjectionPayload | null,
    primer: (primerResult?.payload ?? null) as ArcPrimerPayload | null,
  });

  if (!vm.hasContent) {
    return <Frame worldId={worldId}><p>這條故事線尚未發布公開頁面。</p></Frame>;
  }

  return (
    <Frame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">{vm.title}</h1>
        <p className="text-sm opacity-70">
          狀態:{vm.statusLabel.label}
          {vm.statusLabel.isActiveContext ? '' : '(非進行中故事線)'}
        </p>
      </header>

      {vm.premise && (
        <section className="arc-premise mt-4" aria-label="Arc premise">
          <h2 className="text-xl font-semibold">故事前提</h2>
          <p>{vm.premise}</p>
        </section>
      )}

      {vm.currentQuestion && (
        <section className="arc-question mt-4" aria-label="Current question">
          <h2 className="text-xl font-semibold">當前問題</h2>
          <p>{vm.currentQuestion}</p>
        </section>
      )}

      <section className="arc-people mt-4" aria-label="Core characters">
        <h2 className="text-xl font-semibold">核心人物</h2>
        {vm.coreCharacters.length > 0 ? (
          <ul>
            {vm.coreCharacters.map((person) => (
              <li key={person.characterId} className="text-sm">
                <a href={person.href} className="underline">{person.name}</a>
                {person.role && <span className="opacity-70">({person.role})</span>}
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">尚未公開核心人物。</p>}
      </section>

      {vm.essentialBackstory.length > 0 && (
        <section className="arc-backstory mt-4" aria-label="Essential backstory">
          <h2 className="text-xl font-semibold">必要前情</h2>
          <ul className="text-sm">
            {vm.essentialBackstory.map((fact) => <li key={fact.factId}>{fact.label}</li>)}
          </ul>
        </section>
      )}

      <section className="arc-turning-points mt-4" aria-label="Inciting event and latest turning point">
        <h2 className="text-xl font-semibold">轉折</h2>
        <ul className="text-sm">
          <li>起始事件:{vm.incitingEventId || '—'}</li>
          <li>
            最近轉折:{vm.latestTurningPoint
              ? (vm.latestTurningPoint.summary ?? vm.latestTurningPoint.eventId)
              : '尚無'}
          </li>
        </ul>
      </section>

      <section className="arc-entry mt-4" aria-label="Recommended entry point">
        <h2 className="text-xl font-semibold">建議切入點</h2>
        {vm.recommendedEntry ? (
          <p className="text-sm">
            不必從第一集開始,建議從
            <a href={vm.recommendedEntry.href} className="mx-1 underline">
              第 {vm.recommendedEntry.episodeNumber} 集(日 {vm.recommendedEntry.worldDay})
            </a>
            切入。
          </p>
        ) : <p className="opacity-60">尚無建議切入點。</p>}
      </section>

      <section className="arc-episodes mt-4" aria-label="Related episodes">
        <h2 className="text-xl font-semibold">相關集數</h2>
        {vm.relatedEpisodes.length > 0 ? (
          <ul>
            {vm.relatedEpisodes.map((episode) => (
              <li key={episode.episodeNumber} className="text-sm">
                <a href={episode.href} className="underline">
                  第 {episode.episodeNumber} 集(日 {episode.worldDay})
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">尚無相關集數。</p>}
      </section>

      <section className="arc-clues mt-4" aria-label="Known clues">
        <h2 className="text-xl font-semibold">已知線索</h2>
        {vm.knownClues.length > 0 ? (
          <ul className="text-sm">
            {vm.knownClues.map((clue) => <li key={clue.factId}>{clue.label}</li>)}
          </ul>
        ) : <p className="opacity-60">尚無公開線索。</p>}
      </section>

      <section className="arc-questions mt-4" aria-label="Unresolved questions">
        <h2 className="text-xl font-semibold">未解問題</h2>
        {vm.unresolvedQuestions.length > 0 ? (
          <ul className="text-sm">
            {vm.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        ) : <p className="opacity-60">尚無未解問題。</p>}
      </section>

      {vm.outcome && (
        <section className="arc-outcome mt-4" aria-label="Arc outcome">
          <h2 className="text-xl font-semibold">結局</h2>
          <p>{vm.outcome.summary}</p>
        </section>
      )}
    </Frame>
  );
}

function Frame({ worldId, children }: { worldId: string | null; children: React.ReactNode }) {
  return (
    <main className="public-page mx-auto max-w-2xl p-4 font-body">
      <a href={worldId ? `#home/${worldId}` : '#home'} className="text-sm opacity-70">← 返回首頁</a>
      <div className="mt-3">{children}</div>
    </main>
  );
}
