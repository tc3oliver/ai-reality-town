import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { relationshipGraphModelRef } from '../../../convex/shared/relationshipGraphRef';
import { viewerKnowledgeModelRef } from '../../../convex/shared/viewerKnowledgeRef';
import { MISTWOOD_CHARACTER_VISUALS } from '../../../data/mistwoodCharacters';
import { emitCharacterViewed } from '../../analytics/productEvents';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { CharacterSprite } from './CharacterSprite';
import { PublicPageFrame } from './PublicPageFrame';
import {
  composeCharacterViewModel,
  parseCharacterRoute,
  type CharacterArcInput,
  type CharacterProjection,
  type CharacterRecentEvent,
  type CharacterRelationshipGraphInput,
  type CharacterSceneInput,
  type CharacterViewerKnowledgeInput,
  type CharacterViewModel,
} from './characterRoute';

/**
 * Public character page (FR-I005). Reads ONLY the published `character:<id>`
 * projection (+ the world timeline, filtered to this character) via the
 * failure-isolated public read model — no generation on read. Renders the
 * server-allowlisted identity + state card and recent major events.
 *
 * Privacy boundary (AC#2/#3): the projection is field-allowlisted server-side
 * (ART-84) and re-sanitised on read; the view model is built from named fields
 * only ({@link ./characterRoute}) so forbidden keys can never reach the render.
 *
 * Thin render layer over pure, unit-tested logic. Accessibility (ART-93 /
 * NFR-009): each section is named by its own visible heading, and the repeated
 * per-event "本日故事" link gets a per-item accessible name so it still makes
 * sense when a screen reader lists the page's links out of context.
 */

type TimelinePayload = {
  entries: Array<{
    eventId: string; worldDay: number; timeSlot: string;
    publicSummary: string | null; characterIds: string[]; episodeNumber: number | null;
  }>;
};

/**
 * The published Live projection, as far as this page reads it (ART-151).
 *
 * Three of FR-I005's fields are already published here and were simply not being read: the
 * location NAME behind `currentLocationId`, and the arcs a character is in right now, which the
 * live map's character card has derived from `activeScenes` since ART-124. Reading the same
 * published row is what keeps the two surfaces from answering 「所屬 Arc」 differently.
 */
type LivePayload = {
  worldTime: { worldDay: number } | null;
  locations: Array<{ locationId: string; name: string }>;
  activeArcs: CharacterArcInput[];
  activeScenes: CharacterSceneInput[];
};

export default function CharacterPage() {
  const route = typeof window === 'undefined' ? null : parseCharacterRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  // §15's `character_viewed`, on the ROUTE rather than on the loaded projection: a viewer who
  // opened an unpublished character page still opened one, and gating on content would make
  // the count measure publication coverage instead of interest.
  const routeCharacterId = route?.characterId ?? null;
  useEffect(() => {
    if (worldId !== null && routeCharacterId !== null) emitCharacterViewed(worldId, routeCharacterId);
  }, [worldId, routeCharacterId]);
  const characterId = route?.characterId ?? null;
  const enabled = route !== null;

  // Public reads only — no provider calls.
  const characterResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'character', modelRef: `character:${characterId}` } : 'skip',
  );
  const timelineResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'timeline', modelRef: `timeline:${worldId}` } : 'skip',
  );
  const liveResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'liveState', modelRef: `live:${worldId}` } : 'skip',
  );
  const live = (liveResult?.payload ?? null) as LivePayload | null;
  // The graph is published per world DAY, so the current day has to come from somewhere published
  // — the Live projection's own world time. Until it arrives the graph read is skipped rather
  // than guessed at, because a guessed day resolves to a different target that may well exist.
  const graphWorldDay = live?.worldTime?.worldDay ?? null;
  const graphResult = useQuery(
    getPublishedReadModelRef,
    enabled && graphWorldDay !== null
      ? {
        worldId: worldId as string,
        modelKind: 'relationshipGraph',
        modelRef: relationshipGraphModelRef(worldId as string, graphWorldDay),
      }
      : 'skip',
  );
  // FR-I005's last two fields (ART-169). Its own read model, not a field on `character:<id>`,
  // because it is the only public payload whose contents depend on the editorial publication
  // lifecycle — so it changes on a trigger no other model shares.
  const viewerKnowledgeResult = useQuery(
    getPublishedReadModelRef,
    enabled
      ? {
        worldId: worldId as string,
        modelKind: 'viewerKnowledge',
        modelRef: viewerKnowledgeModelRef(characterId as string),
      }
      : 'skip',
  );

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">角色</h1>
        <p className="mt-2">
          網址格式應為 <code>#character/&lt;worldId&gt;/&lt;characterId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (characterResult === undefined) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">角色</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }

  const timeline = (timelineResult?.payload ?? null) as TimelinePayload | null;
  const recentEvents: CharacterRecentEvent[] | null = timeline
    ? timeline.entries
        .filter((entry) => entry.characterIds.includes(characterId as string))
        .map((entry) => ({
          eventId: entry.eventId, worldDay: entry.worldDay, timeSlot: entry.timeSlot,
          publicSummary: entry.publicSummary, episodeNumber: entry.episodeNumber,
        }))
    : null;

  const vm = composeCharacterViewModel({
    worldId: worldId as string,
    character: (characterResult?.payload ?? null) as CharacterProjection | null,
    recentEvents,
    // The binding's own sprite key, exactly as the homepage and the live map resolve it, so one
    // character never draws with two different figures across surfaces (FR-N004).
    spriteKey: MISTWOOD_CHARACTER_VISUALS
      .find((visual) => visual.characterId === characterId)?.spriteKey,
    locations: live?.locations ?? null,
    activeScenes: live?.activeScenes ?? null,
    activeArcs: live?.activeArcs ?? null,
    relationshipGraph: (graphResult?.payload ?? null) as CharacterRelationshipGraphInput | null,
    viewerKnowledge: (viewerKnowledgeResult?.payload ?? null) as CharacterViewerKnowledgeInput | null,
  });

  return <CharacterPageView worldId={worldId as string} vm={vm} />;
}

/**
 * Presentational character page. Split out from the data-fetching default
 * export so the accessibility suite can render the real markup without a
 * Convex client.
 */
export function CharacterPageView({ worldId, vm }: { worldId: string; vm: CharacterViewModel }) {
  return (
    <PublicPageFrame worldId={worldId}>
      <header className="character-identity">
        {/* Decorative: the name is right beside it as real text, so announcing the sprite
            again would announce the same information twice. */}
        <CharacterSprite characterId={vm.characterId} spriteKey={vm.spriteKey} />
        <div>
          <h1 className="text-3xl font-bold">{vm.name}</h1>
          <p className="text-sm public-muted">{vm.occupation} · {vm.age}歲{vm.alive ? '' : ' · 已歿'}{vm.active ? '' : ' · 暫離'}</p>
        </div>
      </header>

      {vm.publicProfile && (
        <section className="character-profile mt-4" aria-labelledby="character-profile">
          <h2 id="character-profile" className="text-xl font-semibold">背景</h2>
          <p>{vm.publicProfile}</p>
        </section>
      )}

      <section className="character-state mt-4" aria-labelledby="character-state">
        <h2 id="character-state" className="text-xl font-semibold">目前狀態</h2>
        <ul className="public-rows text-sm">
          <li>所在地:{vm.locationName}</li>
          <li>健康:{vm.healthState}</li>
          <li>情緒:{vm.emotionalState}</li>
          <li>財務:{vm.financialState}</li>
        </ul>
      </section>

      {vm.publicGoal && (
        <section className="character-goal mt-4" aria-labelledby="character-goal">
          <h2 id="character-goal" className="text-xl font-semibold">公開目標</h2>
          <p>{vm.publicGoal}</p>
        </section>
      )}

      {(vm.personality || vm.values) && (
        <section className="character-traits mt-4" aria-labelledby="character-traits">
          <h2 id="character-traits" className="text-xl font-semibold">特質</h2>
          <p className="text-sm">{[vm.personality, vm.values].filter(Boolean).join(' · ')}</p>
        </section>
      )}

      <section className="character-arcs mt-4" aria-labelledby="character-arcs">
        <h2 id="character-arcs" className="text-xl font-semibold">所屬 Arc</h2>
        {vm.arcs.length > 0 ? (
          <ul className="public-rows">
            {vm.arcs.map((arc) => (
              <li key={arc.arcId} className="text-sm">
                <a href={arc.href}>{arc.title}</a>
                {arc.status && <span className="public-muted">({arc.status})</span>}
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">此角色目前不在任何進行中的場景裡。</p>}
      </section>

      <section className="character-relationships mt-4" aria-labelledby="character-relationships">
        <h2 id="character-relationships" className="text-xl font-semibold">主要關係</h2>
        {vm.relationships.length > 0 ? (
          <ul className="public-rows">
            {vm.relationships.map((relationship) => (
              <li key={relationship.otherCharacterId} className="text-sm">
                <a href={relationship.href}>{relationship.otherCharacterId}</a>
                <span className="public-muted">
                  {relationship.relationshipType} · 強度 {relationship.strength}
                </span>
                {relationship.reasons.length > 0 && <span>{relationship.reasons.join('、')}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">目前的關係圖範圍內沒有此角色的公開關係。</p>}
        {/* The scope is stated, not implied: an empty list above means "none within the
            published FR-I007 scope", which is a different claim from "none". */}
        {vm.relationshipsAsOfWorldDay !== null && (
          <p className="public-muted text-sm">
            以第 {vm.relationshipsAsOfWorldDay} 日的關係圖為準,範圍限於當前 Arc 的關係網與近七日的變化。
          </p>
        )}
      </section>

      {/* FR-I005 「觀眾已知秘密」 (ART-169). Every row here was proven, server-side, to have been
          said out loud by an event a PUBLISHED Episode cited — the page adds no judgement of its
          own, because an unrevealed secret never reaches this payload. */}
      <section className="character-secrets mt-4" aria-labelledby="character-secrets">
        <h2 id="character-secrets" className="text-xl font-semibold">觀眾已知秘密</h2>
        {vm.viewerKnownSecrets.length > 0 ? (
          <ul className="public-rows">
            {vm.viewerKnownSecrets.map((secret) => (
              <li key={secret.secretId} className="text-sm">
                {secret.content}
                <a
                  href={secret.episodeHref}
                  className="ml-2 public-tap"
                  aria-label={`揭露這件事的本日故事:${secret.content}`}
                >
                  第 {secret.revealedOnWorldDay} 日故事
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">觀眾還沒有從已發布的故事裡得知這個角色的任何秘密。</p>}
        {vm.viewerKnowledgeOmissions.secrets > 0 && (
          <p className="public-muted text-sm">另有 {vm.viewerKnowledgeOmissions.secrets} 項未列出。</p>
        )}
      </section>

      {/* FR-I005 「角色不知道但觀眾知道的資訊」 (ART-169). The difference between what a viewer can
          see published and what this character's knowledge ledger holds. */}
      <section className="character-irony mt-4" aria-labelledby="character-irony">
        <h2 id="character-irony" className="text-xl font-semibold">角色還不知道的事</h2>
        {vm.dramaticIronyFacts.length > 0 ? (
          <ul className="public-rows">
            {vm.dramaticIronyFacts.map((fact) => (
              <li key={fact.factId} className="text-sm">
                {fact.label}
                <a
                  href={fact.episodeHref}
                  className="ml-2 public-tap"
                  aria-label={`公開這件事的本日故事:${fact.label}`}
                >
                  第 {fact.revealedOnWorldDay} 日故事
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">觀眾知道的公開資訊,這個角色目前都已經知道了。</p>}
        {vm.viewerKnowledgeOmissions.facts > 0 && (
          <p className="public-muted text-sm">另有 {vm.viewerKnowledgeOmissions.facts} 項未列出。</p>
        )}
        {/* The scope is stated, not implied, exactly as 「主要關係」 states its own: the server
            reads a bounded window of the newest published Episodes, so an empty list above means
            "nothing within that window". */}
        {vm.viewerKnowledgeFromWorldDay !== null && (
          <p className="public-muted text-sm">
            以第 {vm.viewerKnowledgeFromWorldDay} 日之後已發布的故事為準。
          </p>
        )}
      </section>

      <section className="character-recent mt-4" aria-labelledby="character-recent">
        <h2 id="character-recent" className="text-xl font-semibold">近期大事</h2>
        {vm.recentEvents.length > 0 ? (
          <ul className="public-rows">
            {vm.recentEvents.map((event) => (
              <li key={event.eventId} className="text-sm">
                {event.label}
                {event.episodeHref && (
                  // Every row renders the same visible text, so the accessible
                  // name carries the event it belongs to (WCAG 2.4.4).
                  <a
                    href={event.episodeHref}
                    className="ml-2"
                    aria-label={`本日故事:${event.label}`}
                  >
                    本日故事
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">尚無與此角色相關的近期大事。</p>}
      </section>
    </PublicPageFrame>
  );
}
