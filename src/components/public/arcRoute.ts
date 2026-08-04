/**
 * Pure, testable logic for the public Story Arc detail page (FR-I006, ART-69).
 *
 * Mirrors {@link ./characterRoute}: the React component is a thin render layer
 * and the correctness boundaries — route resolution, arc field composition,
 * active-context classification, and the public/private boundary — live here as
 * pure functions, unit-tested without a DOM.
 *
 * The page renders ONLY the server-allowlisted published arc projection
 * (`arc:<arcId>`, ART-65/ART-95) plus the bounded arc primer (`primer:<arcId>`,
 * ART-38). Those projections are field-allowlisted server-side; this module is
 * the page-layer defence-in-depth — {@link composeArcViewModel} constructs the
 * view model from NAMED fields only, so a forbidden key in the input payload can
 * never reach the render (AC#2).
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness. Input
 * shapes mirror the published payloads exactly.
 */

/** A publication-safe fact carried by the arc projection (backstory / clues). */
export type ArcPublicFact = {
  factId: string;
  predicate: string;
  value: string | number | boolean;
  sourceEventId: string;
};

/** Published arc projection (§13.3) — the fields the page may display. */
export type ArcProjectionPayload = {
  worldId: string;
  arcId: string;
  title: string;
  premise: string;
  currentQuestion: string;
  status: string;
  coreCharacterIds: string[];
  essentialBackstory: ArcPublicFact[];
  incitingEventId: string;
  latestTurningPointEventId: string | null;
  recommendedEntry: { episodeNumber: number; worldDay: number } | null;
  relatedEpisodes: Array<{ episodeNumber: number; worldDay: number }>;
  knownClues: ArcPublicFact[];
  unresolvedQuestions: string[];
  outcome: { summary: string; sourceEventIds: string[] } | null;
};

/**
 * Published arc primer (`primer:<arcId>`, FR-H002). Supplies the human-readable
 * turning-point summary and the core-character NAMES that the arc projection
 * only carries as ids.
 */
export type ArcPrimerPayload = {
  primerText: string;
  structured: {
    title: string;
    cause: string | null;
    turningPoint: { eventId: string; summary: string } | null;
    characters: Array<{ characterId: string; name: string; role: string | null }>;
    unresolvedQuestions: string[];
    recommendedEntry: { episodeNumber: number; worldDay: number } | null;
  };
};

/**
 * Arc lifecycle statuses that count as active context (mirrors
 * `convex/story/lifecycle.ts` `isActiveArcStatus`). Resolved and archived arcs
 * stay queryable but must not present as active mainline (AC#3).
 */
export const ARC_ACTIVE_STATUSES = ['active', 'escalating', 'climax', 'resolving'] as const;

/**
 * Keys that must NEVER appear in the arc view model (AC#2). Mirrors the
 * server-side forbidden-field set; used by the defence-in-depth guard + tests.
 */
export const ARC_FORBIDDEN_KEYS = [
  'privateProfile', 'privateGoal', 'knowledge', 'memory', 'memories',
  'hiddenTruth', 'secretPlan', 'plannedTwist', 'prompt', 'rawModelOutput',
  'adminNotes', 'secret', 'token',
] as const;

export type ArcStatusLabel = { status: string; label: string; isActiveContext: boolean };

export type ArcViewModel = {
  hasContent: boolean;
  arcId: string;
  title: string;
  premise: string;
  currentQuestion: string;
  /** Lifecycle status plus its display label and active-context flag (AC#3). */
  statusLabel: ArcStatusLabel;
  /** Core people, named via the primer when available, each deep-linked. */
  coreCharacters: Array<{ characterId: string; name: string; role: string | null; href: string }>;
  /** Essential backstory, rendered as readable predicate/value lines. */
  essentialBackstory: Array<{ factId: string; label: string }>;
  incitingEventId: string;
  /** Latest turning point: the canonical event id plus the primer summary. */
  latestTurningPoint: { eventId: string; summary: string | null } | null;
  /** Recommended entry point so a newcomer need not start at Episode 1. */
  recommendedEntry: { episodeNumber: number; worldDay: number; href: string } | null;
  relatedEpisodes: Array<{ episodeNumber: number; worldDay: number; href: string }>;
  knownClues: Array<{ factId: string; label: string }>;
  unresolvedQuestions: string[];
  /** Outcome, present only for arcs the world has actually resolved. */
  outcome: { summary: string } | null;
};

const EM_DASH = '—';

const STATUS_LABELS: Record<string, string> = {
  active: '進行中',
  escalating: '升溫中',
  climax: '高潮',
  resolving: '收束中',
  resolved: '已完結',
  archived: '已封存',
};

/** True when the arc status belongs to the active family (AC#3). */
export function isActiveArcStatus(status: string): boolean {
  return (ARC_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Resolve the world + arc from `#arc/<worldId>/<arcId>`. The read needs the
 * worldId, so the route is world-scoped (like `#character/…` and `#episode/…`).
 * Arc ids themselves contain colons (`arc:mistwood:50`), which are legal in a
 * path segment and survive round-tripping through `encodeURIComponent`.
 */
export function parseArcRoute(hash: string): { worldId: string; arcId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^arc\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  const arcId = decodeURIComponent(match[2]);
  return worldId.length > 0 && arcId.length > 0 ? { worldId, arcId } : null;
}

/** Render a publication-safe fact as a single readable line. */
function factLabel(fact: ArcPublicFact): string {
  return `${fact.predicate}:${String(fact.value)}`;
}

/**
 * Compose the arc render model from the published arc projection and the
 * optional arc primer. The model is built from NAMED fields only — it never
 * copies the input object — so forbidden keys cannot leak (AC#2, page-layer
 * defence-in-depth). Every field degrades to a safe placeholder, and resolved /
 * archived arcs still compose fully while reporting `isActiveContext: false`
 * so they never present as active mainline (AC#3).
 */
export function composeArcViewModel(input: {
  worldId: string;
  arc: ArcProjectionPayload | null;
  primer: ArcPrimerPayload | null;
}): ArcViewModel {
  const arc = input.arc;
  const structured = input.primer?.structured ?? null;
  const status = arc?.status ?? '';
  const primerNames = new Map(
    (structured?.characters ?? []).map((character) => [character.characterId, character]),
  );

  const turningPointId = arc?.latestTurningPointEventId ?? null;
  const primerTurningPoint = structured?.turningPoint ?? null;
  const recommendedEntry = arc?.recommendedEntry ?? structured?.recommendedEntry ?? null;

  // The arc projection's unresolved questions win; the primer's bounded list is
  // the fallback (it seeds itself from the current question).
  const arcQuestions = arc?.unresolvedQuestions ?? [];
  const unresolvedQuestions = arcQuestions.length > 0 ? [...arcQuestions] : [...(structured?.unresolvedQuestions ?? [])];

  return {
    hasContent: arc !== null,
    arcId: arc?.arcId ?? '',
    title: arc?.title ?? structured?.title ?? '未知故事線',
    premise: arc?.premise ?? structured?.cause ?? '',
    currentQuestion: arc?.currentQuestion ?? '',
    statusLabel: {
      status,
      label: STATUS_LABELS[status] ?? (status.length > 0 ? status : EM_DASH),
      isActiveContext: isActiveArcStatus(status),
    },
    coreCharacters: (arc?.coreCharacterIds ?? []).map((characterId) => {
      const named = primerNames.get(characterId) ?? null;
      return {
        characterId,
        name: named?.name ?? characterId,
        role: named?.role ?? null,
        href: `#character/${input.worldId}/${encodeURIComponent(characterId)}`,
      };
    }),
    essentialBackstory: (arc?.essentialBackstory ?? []).map((fact) => ({
      factId: fact.factId,
      label: factLabel(fact),
    })),
    incitingEventId: arc?.incitingEventId ?? '',
    latestTurningPoint: turningPointId
      ? {
          eventId: turningPointId,
          summary: primerTurningPoint && primerTurningPoint.eventId === turningPointId
            ? primerTurningPoint.summary
            : null,
        }
      : null,
    recommendedEntry: recommendedEntry
      ? {
          episodeNumber: recommendedEntry.episodeNumber,
          worldDay: recommendedEntry.worldDay,
          href: `#episode/${input.worldId}/${recommendedEntry.worldDay}`,
        }
      : null,
    relatedEpisodes: (arc?.relatedEpisodes ?? []).map((episode) => ({
      episodeNumber: episode.episodeNumber,
      worldDay: episode.worldDay,
      href: `#episode/${input.worldId}/${episode.worldDay}`,
    })),
    knownClues: (arc?.knownClues ?? []).map((fact) => ({ factId: fact.factId, label: factLabel(fact) })),
    unresolvedQuestions,
    outcome: arc?.outcome ? { summary: arc.outcome.summary } : null,
  };
}

/**
 * Defence-in-depth guard (AC#2): the serialised view model must contain none of
 * the forbidden keys. Returns the list of forbidden keys found (empty = safe).
 * Pure — operates on the already-constructed view model.
 */
export function forbiddenKeysInArcViewModel(viewModel: ArcViewModel): string[] {
  const serialized = JSON.stringify(viewModel);
  return ARC_FORBIDDEN_KEYS.filter((key) => serialized.includes(`"${key}"`));
}
