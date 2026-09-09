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
 * The published FR-I005 viewer-knowledge model, as far as this page reads it (ART-169).
 *
 * Structural rather than imported from `convex/publicRead/viewerKnowledgeProjection.ts`, matching
 * every other payload type in this file: the page describes the fields it renders, and a payload
 * that grows a field the page does not name cannot reach the render by accident.
 */
export type CharacterViewerKnowledgeInput = {
  viewerKnownSecrets?: ReadonlyArray<{
    secretId?: unknown;
    content?: unknown;
    revealedOnWorldDay?: unknown;
  }>;
  dramaticIronyFacts?: ReadonlyArray<{
    factId?: unknown;
    predicate?: unknown;
    value?: unknown;
    subjectType?: unknown;
    subjectId?: unknown;
    revealedOnWorldDay?: unknown;
  }>;
  omittedSecretCount?: unknown;
  omittedIronyFactCount?: unknown;
  oldestConsideredWorldDay?: unknown;
};

/** One secret the viewer already knows about this character (FR-I005 「觀眾已知秘密」). */
export type CharacterKnownSecret = {
  secretId: string;
  /** The secret in its own words. Published only because a published event already said it. */
  content: string;
  revealedOnWorldDay: number;
  /** The day's story, where the viewer can read the scene that revealed it. */
  episodeHref: string;
};

/** One published fact this character does not know (FR-I005 「角色不知道但觀眾知道的資訊」). */
export type CharacterIronyFact = {
  factId: string;
  label: string;
  revealedOnWorldDay: number;
  episodeHref: string;
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
  /**
   * FR-I005 「觀眾已知秘密」 (ART-169). Empty until a published Episode has revealed one.
   *
   * The page renders the secret's own words, and it may do so for exactly one reason: the server
   * put it in the payload only after proving a PUBLISHED accepted event said it out loud
   * (`convex/publicRead/viewerKnowledgeProjection.ts`). This layer adds no judgement of its own —
   * an unrevealed secret never arrives here, so there is nothing for the page to filter.
   */
  viewerKnownSecrets: CharacterKnownSecret[];
  /** FR-I005 「角色不知道但觀眾知道的資訊」 (ART-169). */
  dramaticIronyFacts: CharacterIronyFact[];
  /**
   * What the server's caps left out of each list. Truncation is never silent: a page showing
   * twenty of thirty secrets without saying so has told the viewer something false.
   */
  viewerKnowledgeOmissions: { secrets: number; facts: number };
  /**
   * The earliest world day the viewer-knowledge join could see, or null when it saw none.
   *
   * Published for the same reason `relationshipsAsOfWorldDay` is: the server reads a bounded
   * window of the newest published Episodes, so an empty list means "nothing within that window",
   * which is a weaker claim than "nothing".
   */
  viewerKnowledgeFromWorldDay: number | null;
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
  /** The published FR-I005 viewer-knowledge model for this character (ART-169). */
  viewerKnowledge?: CharacterViewerKnowledgeInput | null;
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
    viewerKnownSecrets: viewerKnownSecrets(input.worldId, input.viewerKnowledge ?? null),
    dramaticIronyFacts: dramaticIronyFacts(input.worldId, input.viewerKnowledge ?? null),
    viewerKnowledgeOmissions: {
      secrets: countOrZero(input.viewerKnowledge?.omittedSecretCount),
      facts: countOrZero(input.viewerKnowledge?.omittedIronyFactCount),
    },
    viewerKnowledgeFromWorldDay: worldDayOrNull(input.viewerKnowledge?.oldestConsideredWorldDay),
  };
}

/** A non-negative count from an untyped payload field; anything else is zero. */
function countOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** A world day from an untyped payload field, or null. */
function worldDayOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Payload text, or `null` when the field is missing or not a non-empty string. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * The secrets the viewer already knows, rendered from NAMED payload fields only.
 *
 * A row without a secret id, without content, or without the published day it was revealed on is
 * DROPPED rather than rendered with a placeholder. The placeholder would be the dangerous choice
 * here and nowhere else on this page: 「觀眾已知秘密」 is the one section whose rows assert that
 * something was already released, so a row this layer cannot fully account for must not appear
 * under that heading at all.
 */
export function viewerKnownSecrets(
  worldId: string,
  payload: CharacterViewerKnowledgeInput | null,
): CharacterKnownSecret[] {
  return (payload?.viewerKnownSecrets ?? []).flatMap((row) => {
    const secretId = textOrNull(row.secretId);
    const content = textOrNull(row.content);
    const revealedOnWorldDay = worldDayOrNull(row.revealedOnWorldDay);
    if (secretId === null || content === null || revealedOnWorldDay === null) return [];
    return [{
      secretId,
      content,
      revealedOnWorldDay,
      episodeHref: `#episode/${encodeURIComponent(worldId)}/${revealedOnWorldDay}`,
    }];
  });
}

/**
 * The published facts this character does not know, rendered from NAMED payload fields only.
 *
 * The label is built here rather than served, so the payload carries the fact and the page owns
 * the sentence — the same split every other section on this page uses. `value` is stringified
 * because Canon fact values are `string | number | boolean`.
 */
export function dramaticIronyFacts(
  worldId: string,
  payload: CharacterViewerKnowledgeInput | null,
): CharacterIronyFact[] {
  return (payload?.dramaticIronyFacts ?? []).flatMap((row) => {
    const factId = textOrNull(row.factId);
    const predicate = textOrNull(row.predicate);
    const revealedOnWorldDay = worldDayOrNull(row.revealedOnWorldDay);
    const value = row.value;
    const rendered = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : null;
    if (factId === null || predicate === null || rendered === null || revealedOnWorldDay === null) return [];
    const subject = textOrNull(row.subjectId);
    return [{
      factId,
      label: subject === null ? `${predicate}:${rendered}` : `${subject} 的 ${predicate}:${rendered}`,
      revealedOnWorldDay,
      episodeHref: `#episode/${encodeURIComponent(worldId)}/${revealedOnWorldDay}`,
    }];
  });
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
