/**
 * Pure display model for the public character card (FR-O006 / ART-124).
 *
 * The card is the primary path from "who is that" to narrative understanding, and therefore the
 * most direct private-data exposure risk on the live map. Its whole privacy story is the one
 * {@link ../public/characterRoute} already established for the character page and is reused
 * here rather than reinvented: the view model is constructed from NAMED fields only, so a
 * forbidden key in the input payload has no route into the render even if the server-side
 * allowlist ever regressed. Nothing here spreads the projection, and the forbidden-key set is
 * imported from that module so the two surfaces cannot drift apart.
 *
 * Four sources, none of which is a new backend surface (AC#1-#4):
 *
 * - **identity** (name, occupation, public background, public goal) from the published
 *   `character:<id>` projection, the same read the character page uses;
 * - **location and activity** from the {@link PublicCharacterMotion} the live map has already
 *   loaded — the card says what the map is drawing, because deriving it a second way is how the
 *   two would come to disagree;
 * - **active story arc** from the dynamic projection's `activeScenes`, scoped to the scenes this
 *   character is actually in;
 * - **recent major events** from the `timeline:<worldId>` read model, filtered by
 *   `characterIds`, exactly as `CharacterPage.tsx` filters it.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness.
 */

import type { MistwoodLocationFootprint } from '../../../data/mistwood';
import { characterTargetId } from '../world/cameraModel';
import type { PublicAnimationState, PublicMotionType } from '../world/worldViewModel';
import {
  CHARACTER_FORBIDDEN_KEYS,
  type CharacterProjection,
  type CharacterRecentEvent,
} from '../public/characterRoute';

const EM_DASH = '—';

/**
 * How many recent major events the card carries.
 *
 * Bounded on purpose: the card sits beside a live canvas and a viewer opened it to find out who
 * someone is, not to read the world's whole history. The full list is one click away on the
 * character page, which is what AC#4's link is for.
 */
export const CHARACTER_CARD_RECENT_EVENT_LIMIT = 5;

/** One published active scene, as the card reads it. Every ART-122 field is optional. */
export interface CharacterCardSceneInput {
  title?: string;
  sceneId?: string;
  participantCharacterIds?: readonly string[];
  arcIds?: readonly string[];
  status?: 'active' | 'ended';
}

/** The published motion fields the card displays. A subset of `PublicCharacterMotion`. */
export interface CharacterCardMotionInput {
  characterId: string;
  semanticLocationId: string;
  animationState: PublicAnimationState;
  motionType: PublicMotionType;
}

export interface CharacterCardArc {
  arcId: string;
  /** The scene that puts the character in this arc right now, for context. */
  sceneTitle: string;
}

/**
 * Whether the card has something to show, is waiting, or has nothing to wait for.
 *
 * Three states rather than a boolean, because the Convex read hook distinguishes them and the
 * card has to as well. `undefined` is a read in flight; `null` is a read that COMPLETED and found
 * no published projection — a character whose model has never been built, which
 * {@link serveReadModel} returns as `null` by design. Collapsing the two shows a viewer
 * "loading…" forever for a character that is never going to load. `CharacterPage.tsx` already
 * makes this distinction; this mirrors it.
 *
 * (The hook is named in prose rather than as a symbol on purpose: `liveMapSurface.test.ts`
 * sweeps every file in this module for request APIs by name, with no exemption list, and that
 * sweep is worth more than the convenience of writing the identifier here.)
 */
export type CharacterCardStatus = 'loading' | 'unavailable' | 'ready';

export interface CharacterCardViewModel {
  status: CharacterCardStatus;
  /** True only in `ready`. Kept as its own field so the render layer never re-derives it. */
  hasContent: boolean;
  characterId: string;
  name: string;
  /**
   * The asset key the map draws this character with (AC#6), or null for a character with no
   * visual binding. Carried through rather than resolved here: the card and the canvas must
   * look the same character up in the same table, and `spriteKeys` is that table.
   */
  spriteAssetKey: string | null;
  occupation: string;
  publicProfile: string;
  /** Where the character is, named as the map names it. */
  locationLabel: string;
  /** Why they are there — walking, drifting in a zone, or standing still. */
  movementLabel: string;
  /** What they are publicly doing. */
  activityLabel: string;
  emotionalState: string;
  publicGoal: string;
  activeArcs: CharacterCardArc[];
  recentEvents: Array<{ eventId: string; label: string; episodeHref: string | null }>;
  /** AC#4 — the full character page. */
  characterHref: string;
}

/**
 * The character a camera focus target names, or null for any other kind of target.
 *
 * The prefix is derived from {@link characterTargetId} itself rather than written out again, so
 * the two cannot drift: if the producer ever changes its namespace, this follows it.
 */
export { characterIdFromFocusTargetId } from './liveMapRoute';

/**
 * Published activity, in the viewer's language. Total over the union, so a state the projection
 * starts producing is a compile error here rather than a blank line on the card.
 */
const ACTIVITY_LABELS: Record<PublicAnimationState, string> = {
  idle: '待著',
  walking: '移動中',
  speaking: '交談中',
  thinking: '沉思中',
  activity: '進行活動',
};

/**
 * Why the character is where they are. `replay` is declared because the client contract carries
 * it; a card opened mid-replay describes the replayed frame, which is what the map is showing.
 */
const MOVEMENT_LABELS: Record<PublicMotionType, string> = {
  canon: '正在前往目的地',
  ambient: '在附近走動',
  idle: '停留原地',
  replay: '重播中的動態',
};

export function composeCharacterCardViewModel(input: {
  worldId: string;
  characterId: string;
  /**
   * The published projection: `undefined` while the read is in flight, `null` when it completed
   * and no model exists. See {@link CharacterCardStatus} on why the two must not be collapsed.
   */
  character: CharacterProjection | null | undefined;
  motion: CharacterCardMotionInput | null;
  scenes: readonly CharacterCardSceneInput[] | null;
  recentEvents: readonly CharacterRecentEvent[] | null;
  /** `characterId -> asset key`, the same map the renderer draws from (AC#6). */
  spriteKeys: Readonly<Record<string, string>>;
  footprints: readonly MistwoodLocationFootprint[];
}): CharacterCardViewModel {
  const character = input.character ?? null;
  const motion = input.motion;
  const locationName = new Map(input.footprints.map((footprint) => [footprint.id, footprint.name]));

  // The live position wins over the projection's `currentLocationId`: both are Canon-derived, but
  // the motion is what the canvas beside the card is drawing this instant.
  const locationId = motion?.semanticLocationId ?? character?.currentLocationId ?? null;

  // eslint-disable-next-line no-nested-ternary -- three mutually exclusive read states.
  const status: CharacterCardStatus = character !== null
    ? 'ready'
    : input.character === undefined ? 'loading' : 'unavailable';

  return {
    status,
    hasContent: status === 'ready',
    characterId: input.characterId,
    name: character?.name ?? (input.characterId.length > 0 ? input.characterId : '未知角色'),
    spriteAssetKey: input.spriteKeys[input.characterId] ?? null,
    occupation: character?.occupation ?? EM_DASH,
    publicProfile: character?.publicProfile ?? '',
    locationLabel: locationId === null ? EM_DASH : (locationName.get(locationId) ?? locationId),
    movementLabel: motion === null ? EM_DASH : MOVEMENT_LABELS[motion.motionType],
    activityLabel: motion === null ? EM_DASH : ACTIVITY_LABELS[motion.animationState],
    emotionalState: character?.emotionalState ?? EM_DASH,
    publicGoal: character?.publicGoal ?? '',
    activeArcs: activeArcsFor(input.characterId, input.scenes ?? []),
    // Newest last in the timeline payload, so the tail is the recent end.
    recentEvents: (input.recentEvents ?? [])
      .slice(-CHARACTER_CARD_RECENT_EVENT_LIMIT)
      .map((event) => ({
        eventId: event.eventId,
        label: `[日 ${event.worldDay} ${event.timeSlot}] ${event.publicSummary ?? '(無摘要)'}`,
        episodeHref: event.episodeNumber != null
          ? `#episode/${encodeURIComponent(input.worldId)}/${event.worldDay}`
          : null,
      })),
    characterHref: `#character/${encodeURIComponent(input.worldId)}/${encodeURIComponent(input.characterId)}`,
  };
}

/**
 * The arcs this character is in RIGHT NOW (AC#3).
 *
 * Scoped to scenes that are still `active` and that name the character as a participant. An
 * `ended` scene's arcs are history, and the card claims the present tense; a scene the character
 * is not in says nothing about them whatever arcs it carries. Deduplicated by arc id, first
 * scene winning, so an arc running through two concurrent scenes is listed once.
 */
function activeArcsFor(
  characterId: string,
  scenes: readonly CharacterCardSceneInput[],
): CharacterCardArc[] {
  const byArcId = new Map<string, CharacterCardArc>();
  for (const scene of scenes) {
    if (scene.status !== 'active') continue;
    if (!(scene.participantCharacterIds ?? []).includes(characterId)) continue;
    for (const arcId of scene.arcIds ?? []) {
      if (arcId.length === 0 || byArcId.has(arcId)) continue;
      byArcId.set(arcId, { arcId, sceneTitle: scene.title ?? '' });
    }
  }
  return [...byArcId.values()];
}

/**
 * TEST TOOLING, not a runtime guard — and deliberately so.
 *
 * Returns the forbidden keys present in the serialised view model (empty = safe). It is the
 * assertion `characterCardModel.test.ts` makes about {@link composeCharacterCardViewModel}, and
 * it is the exact counterpart of `forbiddenKeysInViewModel` in `../public/characterRoute`, which
 * the character page uses the same way.
 *
 * It is NOT called on the render path, which is the difference between this and the server-side
 * `assertNoForbiddenCharacterFields`. That one throws, and throwing is right there: the caller is
 * a rebuild, and refusing to publish is strictly safer than publishing. Here the caller would be
 * a render, where throwing blanks the live map for every viewer — turning a hypothetical leak
 * into a certain outage — and NOT throwing would mean silently rendering the leak anyway. Neither
 * branch is an improvement on making the leak impossible by construction, which is what building
 * the model from named fields already does. What this function adds is the PROOF of that, run in
 * CI on a deliberately poisoned payload.
 */
export function forbiddenKeysInCharacterCard(viewModel: CharacterCardViewModel): string[] {
  const serialized = JSON.stringify(viewModel);
  return CHARACTER_FORBIDDEN_KEYS.filter((key) => serialized.includes(`"${key}"`));
}
