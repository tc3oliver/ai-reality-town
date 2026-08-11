/**
 * Pure display model for the Live Story Overlay (FR-O007 / ART-125).
 *
 * A map shows what is happening; it cannot show why it matters. PRD 2.0 UX2-004 asks for the
 * narrative context to be permanently available beside it, which this module composes and
 * {@link ./StoryOverlay} renders.
 *
 * Six answers, from four sources, none of which is a new backend surface (AC#1/#2/#3):
 *
 * - **world day and time slot** and **active scenes** from the `PublicDynamicProjection` the map
 *   has ALREADY loaded — derived a second way is how the overlay and the canvas would come to
 *   disagree, which is exactly what AC#4 forbids;
 * - **current situation**, **latest major event** and the **recommended Episode** from the
 *   published `onboarding:<worldId>` summary (ART-37 / FR-H001), the same read the homepage
 *   makes. Its `structured.majorEvent` is importance-ranked rather than merely recent, which is
 *   the better answer to "why does this matter";
 * - **primary story arc** from the published `liveState`'s `activeArcs`, the only place an arc's
 *   TITLE is published — `activeScenes[].arcIds` carries ids alone.
 *
 * Both published models are rebuilt on Canon commit and cached in the public read-model store,
 * so a viewer reading them can never cause a summary to be generated (AC#6). Nothing in this
 * module reaches the Canon write store (AC#3): its whole input is the two published payloads and
 * the projection the map already holds.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness.
 */

const EM_DASH = '—';

/** How many active scene titles the collapsed-and-expanded brief names before eliding. */
export const STORY_OVERLAY_SCENE_BRIEF_LIMIT = 3;

/** One entry of the published `liveState` payload's `activeArcs` (FR-I002). */
export interface StoryOverlayArcInput {
  arcId: string;
  title: string;
  currentQuestion: string;
  status: string;
}

/** The published `onboarding:<worldId>` summary, as this module reads it (FR-H001). */
export interface StoryOverlaySummaryInput {
  summaryText: string;
  structured: {
    majorEvent: { eventId: string; publicSummary: string } | null;
    recommendedEpisode: { episodeNumber: number; worldDay: number } | null;
  };
}

/** One published active scene, as this module reads it. Every ART-122 field is optional. */
export interface StoryOverlaySceneInput {
  title?: string;
  status?: 'active' | 'ended';
}

/**
 * Whether ONE of the overlay's two published sources has something to show, is waiting, or has
 * nothing to wait for.
 *
 * Three states rather than a boolean, for the reason {@link ./characterCardModel} records: the
 * Convex read hook distinguishes `undefined` (a read in flight) from `null` (a read that
 * COMPLETED and found no published model), and collapsing the two shows a viewer "loading…"
 * forever for a world whose summary has never been built.
 *
 * Tracked PER SOURCE rather than once for the panel. The overlay is fed by two independent
 * reads that resolve at different times, and one combined status makes the panel state
 * something no single source is in: with a `null` summary beside a populated arc list it would
 * read `ready` and then assert 「目前沒有可顯示的近期大事。」 — a confident claim about a source
 * that never loaded — while during the loading phase a spinner and every "there is none" empty
 * state would render at once. "This has not arrived" and "this genuinely has none" are different
 * sentences and only the source itself knows which is true.
 */
export type StoryOverlaySourceStatus = 'loading' | 'unavailable' | 'ready';

export interface StoryOverlayArc {
  arcId: string;
  title: string;
  /** The raw published status, kept so the render layer can key an attribute off it. */
  status: string;
  /** The same status in the viewer's language. */
  statusLabel: string;
  currentQuestion: string;
}

export interface StoryOverlayViewModel {
  /**
   * The `onboarding:<worldId>` read, which alone governs {@link currentSituationText},
   * {@link latestMajorEvent} and {@link recommendedEntry}.
   */
  summaryStatus: StoryOverlaySourceStatus;
  /** The `live:<worldId>` read, which alone governs {@link primaryArc}. */
  arcStatus: StoryOverlaySourceStatus;
  /** AC#1 — the world's own clock, named as the map names it. */
  worldDayLabel: string;
  timeSlotLabel: string;
  /** AC#1 — the ~30-second "what is happening" answer, or null while it is not available. */
  currentSituationText: string | null;
  /** AC#1 — the arc the world's attention is on, or null when no arc is running. */
  primaryArc: StoryOverlayArc | null;
  /** AC#1 — how many scenes are running, and which. */
  activeSceneSummary: { count: number; brief: string | null };
  /** AC#1 — the most IMPORTANT recent event, not merely the most recent. */
  latestMajorEvent: string | null;
  /** AC#2 — where to catch up, in the `#episode/<worldId>/<worldDay>` shape every page links. */
  recommendedEntry: { episodeNumber: number; worldDay: number; href: string } | null;
}

/**
 * Arc status priority, most urgent first (AC#1's "primary").
 *
 * The backend publishes every active arc without ranking them, because "which arc matters most"
 * is a presentation question and a different surface may answer it differently. The overlay
 * answers it by lifecycle stage: an arc at its climax is what a viewer arriving now should be
 * told about, and one already resolving is the least likely to explain what is on screen. The
 * four names are `ACTIVE_ARC_STATUSES` from `convex/publicRead/liveState.ts`; anything else
 * ranks last rather than being dropped, so a future status still appears.
 */
export const STORY_ARC_STATUS_PRIORITY: readonly string[] = [
  'climax',
  'escalating',
  'active',
  'resolving',
];

const ARC_STATUS_LABELS: Readonly<Record<string, string>> = {
  climax: '高潮',
  escalating: '升溫中',
  active: '進行中',
  resolving: '收束中',
};

function statusRank(status: string): number {
  const rank = STORY_ARC_STATUS_PRIORITY.indexOf(status);
  return rank === -1 ? STORY_ARC_STATUS_PRIORITY.length : rank;
}

/**
 * The one arc the overlay leads with, or null when none is running (AC#1).
 *
 * Deterministic and total: arcs are ranked by {@link STORY_ARC_STATUS_PRIORITY} and ties are
 * broken by `arcId` ascending, so the same payload always yields the same primary arc no matter
 * what order the backend happened to publish it in. Exported separately from
 * {@link composeStoryOverlayViewModel} because the ranking is the only judgement this module
 * makes and it deserves its own tests.
 */
export function primaryStoryArc(
  arcs: readonly StoryOverlayArcInput[],
): StoryOverlayArcInput | null {
  let primary: StoryOverlayArcInput | null = null;
  for (const arc of arcs) {
    if (primary === null) {
      primary = arc;
      continue;
    }
    const rank = statusRank(arc.status);
    const primaryRank = statusRank(primary.status);
    if (rank < primaryRank || (rank === primaryRank && arc.arcId < primary.arcId)) {
      primary = arc;
    }
  }
  return primary;
}

/**
 * Compose the overlay's display data.
 *
 * `summary` and `activeArcs` are `undefined` while their read is in flight and `null` once it
 * completed without finding a published model; `worldDay`, `timeSlot` and `scenes` come from the
 * projection the canvas is already drawing, so the overlay cannot describe a world state the map
 * is not showing (AC#4).
 */
export function composeStoryOverlayViewModel(input: {
  worldId: string;
  summary: StoryOverlaySummaryInput | null | undefined;
  activeArcs: readonly StoryOverlayArcInput[] | null | undefined;
  worldDay: number | undefined;
  timeSlot: string | undefined;
  scenes: readonly StoryOverlaySceneInput[];
}): StoryOverlayViewModel {
  const summary = input.summary ?? null;
  // `Array.isArray` rather than `?? []`, for the same reason every payload path below is
  // optional-chained: this is an `as`-cast published payload, and iterating a malformed
  // `activeArcs` would throw inside `LiveMapErrorBoundary` — which wraps the whole page.
  const arc = primaryStoryArc(Array.isArray(input.activeArcs) ? input.activeArcs : []);

  // An `ended` scene is history; the overlay claims the present tense, exactly as the character
  // card's arc list does.
  const activeScenes = input.scenes.filter((scene) => scene.status !== 'ended');
  const titles = activeScenes
    .map((scene) => scene.title ?? '')
    .filter((title) => title.length > 0);
  const brief = titles.length === 0
    ? null
    : titles.slice(0, STORY_OVERLAY_SCENE_BRIEF_LIMIT).join('、')
      + (titles.length > STORY_OVERLAY_SCENE_BRIEF_LIMIT ? '…' : '');

  // Every path into the payload is optional-chained, not just its first hop. The value arrives
  // through an `as` cast on an untyped published payload, so `structured` being absent or
  // malformed is a real runtime case — and this render sits inside `LiveMapErrorBoundary`, which
  // wraps the WHOLE page: a throw here blanks the map, not merely the overlay. `homeRoute.ts`
  // and the arcs path in `LiveMapPage.tsx` chain the same way.
  const structured = summary?.structured ?? null;
  const recommended = structured?.recommendedEpisode ?? null;

  return {
    summaryStatus: sourceStatus(input.summary),
    // An EMPTY arc list is `ready`, not `unavailable`: the model was published and this world
    // genuinely has no arc running, which is a fact the overlay may state.
    arcStatus: sourceStatus(input.activeArcs),
    worldDayLabel: input.worldDay === undefined ? EM_DASH : `第 ${input.worldDay} 天`,
    timeSlotLabel: input.timeSlot ?? EM_DASH,
    currentSituationText: summary?.summaryText ?? null,
    primaryArc: arc === null
      ? null
      : {
          arcId: arc.arcId,
          title: arc.title,
          status: arc.status,
          statusLabel: ARC_STATUS_LABELS[arc.status] ?? arc.status,
          currentQuestion: arc.currentQuestion,
        },
    activeSceneSummary: { count: activeScenes.length, brief },
    latestMajorEvent: structured?.majorEvent?.publicSummary ?? null,
    // The same shape `composeHomepageViewModel` builds from the same field, so the two entry
    // points send a viewer to the same Episode.
    recommendedEntry: recommended === null
      ? null
      : {
          episodeNumber: recommended.episodeNumber,
          worldDay: recommended.worldDay,
          href: `#episode/${encodeURIComponent(input.worldId)}/${recommended.worldDay}`,
        },
  };
}

/** One read's state: in flight, completed-with-nothing-published, or published. */
function sourceStatus(value: unknown): StoryOverlaySourceStatus {
  if (value === undefined) return 'loading';
  return value === null ? 'unavailable' : 'ready';
}
