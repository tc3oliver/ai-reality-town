/**
 * Which characters are visibly in conversation (FR-O004 / ART-123).
 *
 * ## This lights up a contract that has been dormant since ART-115
 *
 * `PublicAnimationState` has declared `'speaking' | 'thinking' | 'activity'` since ART-115, the
 * validators accept them, and `CharacterStateIndicator` already DRAWS the speech bubble and the
 * thought cloud (`characterAnimation.ts`'s `SPEECH_PRIMITIVES`). No server code has ever
 * produced any of the three — both that file and `docs/character-motion-rendering.md` name
 * FR-O004 as the task that would. So this adds no schema and no new field: it produces values
 * the whole stack already knows how to carry and render.
 *
 * ## Decision: no WORLD-DERIVED text on the canvas
 *
 * AC#1 allows "a public dialogue summary, status OR a short bubble". Choosing the existing
 * vector indicator over a `PIXI.Text` caption makes AC#2 and AC#3 STRUCTURAL rather than
 * disciplinary on the map surface: no projection text reaches the renderer, so none can leak
 * there, and there is nothing to remember to truncate or filter.
 *
 * Precisely: the canvas is not text-free. `MapZoneLayer` draws the eight authored location
 * names from `data/mistwood.ts` — repository constants, identical on every deploy, public by
 * construction. `conversationHints.test.ts` pins that they are the ONLY text constructor on the
 * canvas and that no renderer file reads a summary or dialogue field at all.
 *
 * The public summaries stay in the DOM — the scene panel and the character card — where they
 * have already been through the withhold substitution, can be read by a screen reader, and can
 * be selected and copied.
 *
 * ## Decision: state comes from PARTICIPATION, text comes from PUBLICATION
 *
 * A character is `speaking` because they are a participant in an active scene, and that is
 * decided WITHOUT reference to `publicationStatus`. This is AC#5 directly: when there is no
 * publishable text, the safe state is still shown.
 *
 * It also matches a guarantee FR-P004 already makes. ART-132 AC#4 requires that withholding
 * text must not move any character; by the same reasoning it must not change their animation
 * state either, or the withhold would be visible as a behaviour change on the map. A scene's
 * existence, location and participants are already public when it is withheld —
 * `activeScenePresentation` blanks only `title` and `summary` — so deriving state from
 * participation adds no leak surface.
 *
 * ## Decision: no new projection field
 *
 * The short hint is a pure function of `summary`, which is already published and already
 * withhold-substituted. Adding a second "separately truncated copy of the same published text"
 * field would create a SECOND place the withhold substitution has to be applied — a second leak
 * surface — for no new information. Instead the client derives it from the substituted summary:
 * a withheld scene's summary is `''`, so its hint is empty by construction, with no second code
 * path that could be written wrongly.
 *
 * Pure module: no Convex, no clock, no randomness.
 */

import type { PublicAnimationState } from './publicDynamicProjection';

/** The scene fields this reads. A subset of `PublicActiveScene`, restated to stay pure. */
export type ConversationSceneInput = {
  readonly status?: 'active' | 'ended';
  readonly participantCharacterIds?: readonly string[];
};

/**
 * At least this many participants for a scene to read as a conversation.
 *
 * One person in a scene is doing something; two are doing it to each other. Drawing a speech
 * bubble over someone alone would assert a conversation the world never recorded.
 */
export const CONVERSATION_MIN_PARTICIPANTS = 2;

/**
 * `characterId -> animation state`, for characters an active scene names.
 *
 * `speaking` for a scene with two or more participants, `activity` for a solo one. `thinking` is
 * deliberately NOT produced: nothing in Canon records that a character is thinking, and
 * inventing an inner state from a scene's participant count would be exactly the RISK2-008
 * violation the map exists to avoid — asserting a world fact nobody accepted. The value stays
 * declared and renderable for whenever something does record it.
 *
 * Ended scenes contribute nothing: the conversation is over, and a bubble over someone who
 * finished talking an hour ago is a claim about now.
 */
export function conversationStatesFor(
  scenes: readonly ConversationSceneInput[],
): Map<string, PublicAnimationState> {
  const states = new Map<string, PublicAnimationState>();
  for (const scene of scenes) {
    if (scene.status !== 'active') continue;
    const participants = scene.participantCharacterIds ?? [];
    if (participants.length === 0) continue;
    const state: PublicAnimationState =
      participants.length >= CONVERSATION_MIN_PARTICIPANTS ? 'speaking' : 'activity';
    for (const characterId of participants) {
      // `speaking` wins over `activity` when a character is in more than one active scene: the
      // stronger claim is the one a viewer can check against the scene panel, and downgrading
      // it because of an unrelated solo scene would make the map disagree with the panel.
      if (state === 'speaking' || !states.has(characterId)) states.set(characterId, state);
    }
  }
  return states;
}

/**
 * Overlay conversation state onto a motion's animation state.
 *
 * ONLY where the motion is `idle`. A character mid-walk is on their way somewhere, and a speech
 * bubble over a walking figure would claim they are standing talking — the projection's own
 * `walking` state is the more specific fact and keeps precedence. This also keeps ART-119's
 * guarantee intact: `animationState` is still derived from the published motion, with a scene
 * refining only the case the motion left unspecified.
 */
export function applyConversationState(
  animationState: PublicAnimationState,
  conversationState: PublicAnimationState | undefined,
): PublicAnimationState {
  if (conversationState === undefined) return animationState;
  return animationState === 'idle' ? conversationState : animationState;
}
