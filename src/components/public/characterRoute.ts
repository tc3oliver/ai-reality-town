/**
 * Pure, testable logic for the public character page (FR-I005, ART-43).
 *
 * The page's PRIMARY job is the public/private boundary (AC#2/#3): it renders
 * ONLY server-allowlisted character fields and can never surface unrevealed
 * Canon secrets, private memories, prompts, raw model output, or administrator
 * notes. That boundary is enforced server-side by the projection allowlist
 * (ART-84) + sanitizeForPublic; this module is the page-layer defence-in-depth —
 * {@link composeCharacterViewModel} constructs the view model from NAMED fields
 * only, so a forbidden key in the input payload can never reach the render.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness.
 */

/** Published character projection (§13.2) — fields the page may display. */
export type CharacterProjection = {
  id: string;
  worldId: string;
  name: string | null;
  age: number | null;
  occupation: string | null;
  publicProfile: string | null;
  personality: string | null;
  values: string | null;
  publicGoal: string | null;
  fear: string | null;
  currentLocationId: string | null;
  healthState: string | null;
  emotionalState: string | null;
  financialState: string | null;
  alive: boolean;
  active: boolean;
};

/** A recent major event relevant to this character (from the timeline). */
export type CharacterRecentEvent = {
  eventId: string;
  worldDay: number;
  timeSlot: string;
  publicSummary: string | null;
  episodeNumber: number | null;
};

/**
 * The minimum a published scene must expose for arc membership. Structural, so both the Live
 * projection's `LiveScene` and the map card's scene input satisfy it without either importing
 * the other.
 */
export type CharacterSceneInput = {
  title?: string;
  participantCharacterIds?: readonly string[];
  arcIds?: readonly string[];
  status?: 'active' | 'ended';
};

/** One arc a character is in right now, as the membership rule reports it. */
export type CharacterArcMembership = {
  arcId: string;
  /** The scene that puts the character in this arc right now, for context. */
  sceneTitle: string;
};

/** A published active arc, as far as the character page needs it to name one. */
export type CharacterArcInput = {
  arcId: string;
  title: string;
  status: string;
};

/** One arc row on the character page (FR-I005 「所屬 Arc」). */
export type CharacterArc = {
  arcId: string;
  title: string;
  status: string;
  href: string;
};

/**
 * One published relationship this character is part of (FR-I005 「主要關係」).
 *
 * `otherCharacterId` rather than a name: the FR-I007 graph deliberately carries no character
 * text, because a past day's graph is published once and never rebuilt, so any name baked into
 * it would be frozen against a later withhold. The page renders the id as a link to that
 * character's own page, which IS rebuilt on every commit.
 */
export type CharacterRelationship = {
  otherCharacterId: string;
  href: string;
  relationshipType: string;
  strength: number;
  lastChangedWorldDay: number;
  /** Already-public, already-bounded change reasons carried by the graph edge. */
  reasons: string[];
};

/** The published graph, as far as this page reads it. */
export type CharacterRelationshipGraphInput = {
  worldDay: number;
  arc: { arcId: string; title: string; status: string } | null;
  edges: ReadonlyArray<{
    sourceCharacterId: string;
    targetCharacterId: string;
    relationshipType: string;
    strength: number;
    lastChangedWorldDay: number;
    recentChanges?: ReadonlyArray<{ reason: string }>;
  }>;
};

/**
 * The arcs this character is in RIGHT NOW.
 *
 * Scoped to scenes that are still `active` and that name the character as a participant. An
 * `ended` scene's arcs are history, and both surfaces that call this claim the present tense; a
 * scene the character is not in says nothing about them whatever arcs it carries. Deduplicated by
 * arc id, first scene winning, so an arc running through two concurrent scenes is listed once.
 *
 * Lives HERE, in `clientPublic`, rather than beside either caller: the live map's character card
 * (ART-124 AC#3) and this page (FR-I005 「所屬 Arc」) must answer 「這個角色現在在哪些 Arc 裡」
 * identically, and `clientLive` may depend on `clientPublic` while the reverse would be a cycle.
 * ART-151 moved it here from `components/live/characterCardModel.ts`, where it was private, so the
 * two surfaces cannot drift into two definitions of the same sentence.
 */
export function characterCurrentArcs(
  characterId: string,
  scenes: readonly CharacterSceneInput[],
): CharacterArcMembership[] {
  const byArcId = new Map<string, CharacterArcMembership>();
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
 * Keys that must NEVER appear in the character view model (AC#2). Mirrors the
 * server-side forbidden-field set; used by the defence-in-depth guard + tests.
 */
export const CHARACTER_FORBIDDEN_KEYS = [
  'privateProfile', 'privateGoal', 'knowledge', 'memory', 'memories',
  'prompt', 'rawModelOutput', 'adminNotes', 'secret', 'token',
] as const;

export type CharacterViewModel = {
  hasContent: boolean;
  characterId: string;
  name: string;
  age: string;
  occupation: string;
  publicProfile: string;
  personality: string;
  values: string;
  publicGoal: string;
  healthState: string;
  emotionalState: string;
  financialState: string;
  /**
   * Where the character publicly is, by NAME (FR-I005 「目前狀態」).
   *
   * The projection has only carried `currentLocationId` since ART-43, and the page never rendered
   * it — so 「目前狀態」 was health/emotion/finance and said nothing about place. The name is
   * resolved against the published Live projection's location list rather than stored here,
   * because the id is the durable thing and the name is text that a withhold may change.
   */
  locationName: string;
  alive: boolean;
  active: boolean;
  /** FR-I005 「姓名與圖像」. `undefined` renders nothing rather than guessing a sprite. */
  spriteKey: string | undefined;
  /** FR-I005 「所屬 Arc」. Empty when the character is in no active scene right now. */
  arcs: CharacterArc[];
  /** FR-I005 「主要關係」, within the published graph's declared scope. */
  relationships: CharacterRelationship[];
  /**
   * The world day the relationships are AS OF, or null when no graph was published/read.
   *
   * Published rather than implied, because the FR-I007 graph is scoped — to the current arc's
   * neighbourhood, a seven-day change window and thirty nodes — so an empty list means "none
   * within that scope", not "this character has no relationships". A page that could not tell
   * those apart would state the second.
   */
  relationshipsAsOfWorldDay: number | null;
  recentEvents: Array<{ eventId: string; label: string; episodeHref: string | null }>;
};

const EM_DASH = '—';

/**
 * Resolve the world + character from `#character/<worldId>/<characterId>`. The
 * read needs the worldId, so the route is world-scoped (like `#episode/…`).
 */
export function parseCharacterRoute(hash: string): { worldId: string; characterId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^character\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  const characterId = decodeURIComponent(match[2]);
  return worldId.length > 0 && characterId.length > 0 ? { worldId, characterId } : null;
}

/**
 * Compose the character render model from the published projection and any
 * recent events for this character. The model is built from NAMED fields only
 * — it never copies the input object — so forbidden keys cannot leak (AC#2/#3,
 * page-layer defence-in-depth). Every field degrades to a safe placeholder.
 */
export function composeCharacterViewModel(input: {
  worldId: string;
  character: CharacterProjection | null;
  recentEvents: readonly CharacterRecentEvent[] | null;
  /** From the production visual roster, so the page draws the sprite the map draws. */
  spriteKey?: string | undefined;
  /** The published Live projection's locations, for resolving `currentLocationId` to a name. */
  locations?: readonly { locationId: string; name: string }[] | null;
  /** The published Live projection's scenes and arcs, for 「所屬 Arc」. */
  activeScenes?: readonly CharacterSceneInput[] | null;
  activeArcs?: readonly CharacterArcInput[] | null;
  /** The published FR-I007 graph for the current world day, for 「主要關係」. */
  relationshipGraph?: CharacterRelationshipGraphInput | null;
}): CharacterViewModel {
  const character = input.character;
  const recent = input.recentEvents ?? [];
  const characterId = character?.id ?? '';
  const arcById = new Map((input.activeArcs ?? []).map((arc) => [arc.arcId, arc]));
  return {
    hasContent: character !== null,
    characterId,
    name: character?.name ?? '未知角色',
    age: character?.age != null ? String(character.age) : EM_DASH,
    occupation: character?.occupation ?? EM_DASH,
    publicProfile: character?.publicProfile ?? '',
    personality: character?.personality ?? '',
    values: character?.values ?? '',
    publicGoal: character?.publicGoal ?? '',
    healthState: character?.healthState ?? EM_DASH,
    emotionalState: character?.emotionalState ?? EM_DASH,
    financialState: character?.financialState ?? EM_DASH,
    locationName: resolveLocationName(character?.currentLocationId ?? null, input.locations ?? null),
    alive: character?.alive ?? true,
    active: character?.active ?? true,
    spriteKey: input.spriteKey,
    arcs: characterId.length === 0 ? [] : characterCurrentArcs(characterId, input.activeScenes ?? [])
      // An arc the character is in but that the Live projection does not list as active is named
      // by its id rather than dropped: the membership is the published fact, and a missing title
      // is a gap in the arc list, not evidence the membership is untrue.
      .map((membership): CharacterArc => ({
        arcId: membership.arcId,
        title: arcById.get(membership.arcId)?.title ?? membership.arcId,
        status: arcById.get(membership.arcId)?.status ?? '',
        href: `#arc/${encodeURIComponent(input.worldId)}/${encodeURIComponent(membership.arcId)}`,
      })),
    relationships: characterId.length === 0
      ? []
      : characterRelationships(characterId, input.worldId, input.relationshipGraph ?? null),
    relationshipsAsOfWorldDay: input.relationshipGraph?.worldDay ?? null,
    recentEvents: recent.map((event) => ({
      eventId: event.eventId,
      label: `[日 ${event.worldDay} ${event.timeSlot}] ${event.publicSummary ?? '(無摘要)'}`,
      episodeHref: event.episodeNumber != null ? `#episode/${input.worldId}/${event.worldDay}` : null,
    })),
  };
}

/** The published name of the character's current location, or a placeholder. */
function resolveLocationName(
  locationId: string | null,
  locations: readonly { locationId: string; name: string }[] | null,
): string {
  if (locationId === null) return EM_DASH;
  const named = (locations ?? []).find((location) => location.locationId === locationId);
  // The id is the published fact; falling back to it says where the character is even when the
  // Live projection has not been read, which is better than saying nothing.
  return named?.name ?? locationId;
}

/**
 * This character's edges in the published FR-I007 graph, strongest first.
 *
 * Reads the graph rather than the per-pair `relationship:<pairKey>` models for one reason: the
 * page knows a character id, and nothing published maps a character to the pairs they are in.
 * The graph already answers that for the day it is a graph of — and it is already scoped,
 * bounded and privacy-checked, so this adds no new exposure. What it costs is stated on the page:
 * the list is scoped to the current arc's neighbourhood and a seven-day change window, so an
 * empty list means "none in scope" rather than "none".
 */
export function characterRelationships(
  characterId: string,
  worldId: string,
  graph: CharacterRelationshipGraphInput | null,
): CharacterRelationship[] {
  if (graph === null) return [];
  return graph.edges
    .filter((edge) => edge.sourceCharacterId === characterId || edge.targetCharacterId === characterId)
    .map((edge): CharacterRelationship => {
      const otherCharacterId = edge.sourceCharacterId === characterId
        ? edge.targetCharacterId
        : edge.sourceCharacterId;
      return {
        otherCharacterId,
        href: `#character/${encodeURIComponent(worldId)}/${encodeURIComponent(otherCharacterId)}`,
        relationshipType: edge.relationshipType,
        strength: edge.strength,
        lastChangedWorldDay: edge.lastChangedWorldDay,
        reasons: (edge.recentChanges ?? []).map((change) => change.reason),
      };
    })
    // Strongest first, then by most recent change, then by id so the order is total and the
    // rendered list is stable across rebuilds that change nothing.
    .sort((left, right) => right.strength - left.strength
      || right.lastChangedWorldDay - left.lastChangedWorldDay
      || left.otherCharacterId.localeCompare(right.otherCharacterId));
}

/**
 * Defence-in-depth guard (AC#2/#3): the serialised view model must contain none
 * of the forbidden keys. Returns the list of forbidden keys found (empty = safe).
 * Pure — operates on the already-constructed view model.
 */
export function forbiddenKeysInViewModel(viewModel: CharacterViewModel): string[] {
  const serialized = JSON.stringify(viewModel);
  return CHARACTER_FORBIDDEN_KEYS.filter((key) => serialized.includes(`"${key}"`));
}
