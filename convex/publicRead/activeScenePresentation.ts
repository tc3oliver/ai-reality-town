/**
 * Active Scene Presentation — what the map shows as "the thing happening now"
 * (FR-O003 / ART-122, PRD 2.0 §14.6).
 *
 * The public scene contract used to be bound to the wrong producer. `PublicActiveScene` was
 * derived only from a `dailyEpisodes` row once it reached `status === 'ready'` — the
 * NARRATED artifact, produced once per world day by an LLM-gated editorial pass. A world day
 * has five public slots, so for most of a day the map had no scene at all, which is exactly
 * what AC#7 objects to.
 *
 * This module rebinds it to the STRUCTURAL producer:
 *
 *     A scene is the set of accepted Canon events sharing (worldDay, timeSlot, locationId).
 *
 * That definition is worth stating plainly because everything else follows from it. Canon
 * events already carry `locationId`, `participantIds` and the slot; the arc layer already
 * indexes them by sequence number. So the scene needs no new table, no new event type, and
 * no reach outside `publicRead`'s existing dependencies — and it refreshes on every Canon
 * commit (five times a day) instead of once, which is AC#7.
 *
 * **Sources deliberately not used.** `convex/simulation/sceneGrouping.ts`'s `GroupedScene` is
 * the one place a scene object with a location and participants already exists, and it is
 * disqualified twice over: `architecture/module-boundaries.json` forbids `publicRead` from
 * depending on `simulation`, and a scene withheld by post-generation safety still has a
 * `GroupedScene` row, so reading it would publish exactly the content the safety pass
 * refused. `sceneSimulationRuns` is raw provider output including dialogue. Neither is a
 * judgement call available to a future edit; see `docs/active-scene-presentation.md`.
 *
 * Three properties define this module, matching its pure siblings in this directory:
 *
 * 1. **It is pure.** No Convex import, no clock, no randomness. Every timestamp published is
 *    a Canon `acceptedAt` carried through from an accepted event.
 * 2. **It reads a narrow, structural event type.** {@link SceneEventLike} names
 *    `publicSummary` and nothing else textual. `metadata`, a state change's `reason`, memory
 *    content and knowledge content are not merely unused — they are absent from the type, so
 *    reading one is a compile error rather than a review finding.
 * 3. **It is deterministic.** Groups are keyed by derived values, ties are broken by
 *    ascending id, and every published list is sorted. An unchanged world re-derives an
 *    identical payload, which is what keeps the read model's `contentHash` dedup working.
 */

import type {
  PublicActiveSceneInput,
  PublicActiveSceneStatus,
} from './publicDynamicProjection';

/**
 * The post-generation safety verdict governing a scene (FR-P004 / ART-132).
 *
 * Declared structurally rather than imported from `convex/safety/postGeneration`, for the same
 * reason {@link SceneEventLike} is: FR-O013's replay builder pins this module's whole
 * dependency closure and refuses anything under `convex/safety/`, so importing the alias — even
 * as a type — would fail that boundary. `PostGenerationLabel` is assignable to this without
 * either module knowing about the other, and `liveStateFunctions` is where the two meet.
 */
export type SceneSafetyLabel = 'allow' | 'allow_with_warning' | 'withhold' | 'human_review_required';

/**
 * What a viewer sees in place of text the safety gate refuses to publish.
 *
 * Traditional Chinese, matching every other public string this surface carries, and
 * deliberately saying nothing about the scene: a placeholder that hinted at why a scene was
 * withheld would be a smaller version of the leak it exists to prevent. The summary is empty
 * rather than a second sentence, because the empty summary is already what this module
 * publishes for a scene with no public text (see {@link presentGroup}) and the client already
 * renders it.
 */
export const WITHHELD_SCENE_TITLE = '內容審核中';
export const WITHHELD_SCENE_SUMMARY = '';

/**
 * One accepted Canon event, as this module reads it.
 *
 * Declared structurally rather than imported from `convex/canon/model`, the same way
 * `visualSyncPlanner` declares `AcceptedEventLike`: a real `AcceptedEvent` is assignable
 * without this module importing Canon, so there is no Canon import and therefore no Canon
 * write path, whatever a future edit does. The narrowness is the privacy gate — see the
 * module header.
 */
export type SceneEventLike = {
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly worldDay: number;
  readonly timeSlot: string;
  readonly acceptedAt: number;
  readonly locationId?: string;
  readonly participantIds: readonly string[];
  readonly publicSummary?: string;
  readonly stateChanges: readonly SceneStateChangeLike[];
  /**
   * The simulated Scene this event was proposed from (FR-P004 / ART-132), which is what the
   * post-generation safety classification is keyed on. Optional, and absent means "no
   * classifier ever saw this": Canon carries system, seed and remediation events that no LLM
   * wrote, and they are shown. The caller lifts it out of the accepted event's private extras
   * — it is an identifier, never text.
   */
  readonly sceneId?: string;
};

/** Only the movement destination is read; every other change variant contributes nothing. */
export type SceneStateChangeLike = {
  readonly type: string;
  readonly toLocationId?: string;
};

/** One event's arc memberships, joined by sequence number (`storyArcEventClassifications`). */
export type SceneArcMembership = {
  readonly sourceEventSequenceNumber: number;
  readonly arcIds: readonly string[];
  /**
   * Story weight of the event, 0–1, from the same classification row the arc ids come from
   * (FR-O013 / ART-121). Optional because this module has never needed it and a caller that
   * does not supply it must keep working; the replay builder is the only reader, and it
   * treats an absent value as zero rather than guessing a default importance.
   */
  readonly importance?: number;
};

/**
 * A key scene from a `ready` daily episode. Its `title` and `summary` have already passed
 * the editorial post-generation safety classification, which is what makes them eligible to
 * replace a synthesised title later in the day.
 */
export type PublishedKeyScene = {
  readonly title: string;
  readonly summary: string;
  readonly sourceEventIds: readonly string[];
};

/** What {@link resolveSceneSpatials} recovers by tracing a scene's events. */
export type SceneSpatials = {
  /** Absent when the traced events name no location at all. */
  readonly locationId?: string;
  readonly participantCharacterIds: string[];
  readonly arcIds: string[];
  readonly startedAt: number;
  readonly endedAt: number;
  readonly sourceEventIds: string[];
};

/**
 * Which producer answered, for the rebuild's observability line (FR-Q001 / ART-133).
 *
 * `canon` — current-slot scenes, titles synthesised. `episode` — current-slot scenes, at
 * least one of which adopted a published key scene's narration. `degraded` — no current
 * scene, so AC#8's most recent completed one is standing in. `none` — the world has no
 * placeable history at all.
 */
export type ActiveScenePresentationMode = 'canon' | 'episode' | 'degraded' | 'none';

export type ActiveScenePresentationResult = {
  readonly scenes: PublicActiveSceneInput[];
  readonly mode: ActiveScenePresentationMode;
};

export type BuildActiveScenePresentationsInput = {
  readonly acceptedEvents: readonly SceneEventLike[];
  readonly arcMemberships: readonly SceneArcMembership[];
  /** Key scenes of the latest `ready` episode. Empty for every other episode status. */
  readonly publishedEpisodeScenes: readonly PublishedKeyScene[];
  /** Characters the map already refuses to draw — the dead and the deactivated. */
  readonly excludedCharacterIds: ReadonlySet<string>;
  /**
   * The effective safety label of each Scene id named by the events, as of NOW (FR-P004 /
   * ART-132) — the classifier's verdict as revised by any operator override. Optional so
   * every existing caller keeps working; an absent map means nothing is withheld, which is
   * the pre-ART-132 behaviour exactly.
   */
  readonly sceneSafetyLabels?: ReadonlyMap<string, SceneSafetyLabel>;
};

/** The separator is `\0` (NUL) because no Canon id may contain it, so a key cannot collide. */
const KEY_SEPARATOR = '\0';

/**
 * The most frequent entry, ties broken by ascending id.
 *
 * The tie-break is not cosmetic: two locations named by the same number of events must
 * resolve the same way on every rebuild, or an unchanged world would publish a different
 * scene each time and defeat `contentHash` deduplication.
 */
function mostFrequent(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let winner: string | undefined;
  let best = 0;
  for (const [value, count] of [...counts].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (count > best) {
      winner = value;
      best = count;
    }
  }
  return winner;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Where a single event happened.
 *
 * The event's own `locationId` is authoritative. Failing that, a `character_location_changed`
 * change names where the character *arrived*, which is where the event's action took place;
 * `fromLocationId` is where they left and would place the scene in the wrong room. An event
 * that names neither is unplaceable and its caller drops it rather than guessing.
 */
export function eventLocationId(event: SceneEventLike): string | undefined {
  if (typeof event.locationId === 'string' && event.locationId.length > 0) return event.locationId;
  const arrivals = event.stateChanges
    .filter((change) => change.type === 'character_location_changed')
    .map((change) => change.toLocationId)
    .filter((locationId): locationId is string => typeof locationId === 'string' && locationId.length > 0);
  return mostFrequent(arrivals);
}

/**
 * Recover a scene's spatial facts by tracing its events (AC#6).
 *
 * This exists because the shape the public contract used to publish carried none of them:
 * a `PublicActiveScene` was three text fields, so "focus the camera on this scene" had
 * nothing to aim at. Every value here is traced back to an accepted event rather than
 * carried alongside one, which is why a scene can be presented for any slot rather than
 * only for the slots an episode happened to narrate.
 */
export function resolveSceneSpatials(
  events: readonly SceneEventLike[],
  options: {
    readonly arcIdsBySequence: ReadonlyMap<number, readonly string[]>;
    readonly excludedCharacterIds: ReadonlySet<string>;
  },
): SceneSpatials {
  const ordered = [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  const locationId = mostFrequent(
    ordered
      .map((event) => event.locationId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ) ?? mostFrequent(
    ordered.flatMap((event) =>
      event.stateChanges
        .filter((change) => change.type === 'character_location_changed')
        .map((change) => change.toLocationId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)),
  );

  const participantCharacterIds = sortedUnique(
    ordered.flatMap((event) => event.participantIds),
  ).filter((characterId) => !options.excludedCharacterIds.has(characterId));

  const arcIds = sortedUnique(
    ordered.flatMap((event) => options.arcIdsBySequence.get(event.sequenceNumber) ?? []),
  );

  const spatials: SceneSpatials = {
    participantCharacterIds,
    arcIds,
    startedAt: first ? first.acceptedAt : 0,
    endedAt: last ? last.acceptedAt : 0,
    sourceEventIds: ordered.map((event) => event.eventId),
  };
  return locationId === undefined ? spatials : { ...spatials, locationId };
}

export type SceneGroup = {
  readonly worldDay: number;
  readonly timeSlot: string;
  readonly locationId: string;
  readonly events: SceneEventLike[];
  maxSequenceNumber: number;
};

/**
 * Partition accepted events into scenes. Events with no resolvable location are dropped.
 *
 * Exported for FR-O013 / ART-121: the replay builder needs the same partition this module
 * derives, and a second implementation of "what counts as one scene" would let the map's
 * idea of a scene and the replay's drift apart without either one being wrong on its own.
 */
export function groupSceneEvents(events: readonly SceneEventLike[]): SceneGroup[] {
  const groups = new Map<string, SceneGroup>();
  for (const event of events) {
    const locationId = eventLocationId(event);
    if (locationId === undefined) continue;
    const key = [event.worldDay, event.timeSlot, locationId].join(KEY_SEPARATOR);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      existing.maxSequenceNumber = Math.max(existing.maxSequenceNumber, event.sequenceNumber);
    } else {
      groups.set(key, {
        worldDay: event.worldDay,
        timeSlot: event.timeSlot,
        locationId,
        events: [event],
        maxSequenceNumber: event.sequenceNumber,
      });
    }
  }
  return [...groups.values()];
}

/**
 * The narrated title and summary for a scene, when the day's episode has caught up.
 *
 * A graceful upgrade, not a requirement: for most of a world day no episode is `ready` and
 * the scene is presented with a synthesised title. Once the editorial pass lands, a scene
 * whose events the episode narrated adopts that narration — which is strictly better text,
 * and text that has already passed the editorial safety classification.
 *
 * First match by index rather than best overlap: `keyScenes` is a short authored list, and
 * "the first key scene that cites one of these events" is a rule a reader can hold, whereas
 * a largest-intersection tie-break is one nobody could predict from the payload.
 *
 * Exported for FR-O013 / ART-121, which performs the same join to decide whether a replayed
 * event has a published episode scene to reference. Two copies of this rule could disagree
 * about which key scene covers an event, and the replay's reference would then address a
 * different scene from the one the map narrated.
 */
export function narrationForEvents(
  eventIds: ReadonlySet<string>,
  publishedEpisodeScenes: readonly PublishedKeyScene[],
): PublishedKeyScene | undefined {
  return publishedEpisodeScenes.find((scene) =>
    scene.sourceEventIds.some((eventId) => eventIds.has(eventId)));
}

/**
 * Whether a scene group's text must be withheld (FR-P004 / ART-132).
 *
 * FAIL CLOSED ON A VERDICT, OPEN ON SILENCE. A group is withheld when ANY of its events names
 * a Scene the safety gate currently refuses. It is shown when its events name no Scene at all,
 * or name Scenes with no verdict: Canon carries seed, system and remediation events that no
 * post-generation classifier ever examined, and reading their silence as a refusal would blank
 * the map for content that was never in question. So an absent verdict shows, and a present
 * refusal withholds — even where a group spans two Scenes and only one was refused, because
 * publishing the joined summaries of a group half of which is refused would publish the
 * refused half.
 */
function isGroupWithheld(
  group: SceneGroup,
  labels: ReadonlyMap<string, SceneSafetyLabel> | undefined,
): boolean {
  if (!labels || labels.size === 0) return false;
  return group.events.some((event) => {
    if (typeof event.sceneId !== 'string' || event.sceneId.length === 0) return false;
    const label = labels.get(event.sceneId);
    return label === 'withhold' || label === 'human_review_required';
  });
}

/**
 * Compose one group into the published shape.
 *
 * `summary` falls back to the empty string rather than to any other field on the event. An
 * event whose only human-readable text sits in a state change's `reason` or in `metadata`
 * publishes nothing at all, which is the intended outcome: those fields carry private
 * causal detail, and a scene with no public text is a smaller failure than a scene with
 * leaked text.
 */
function presentGroup(args: {
  readonly group: SceneGroup;
  readonly status: PublicActiveSceneStatus;
  readonly spatials: SceneSpatials;
  readonly narration: PublishedKeyScene | undefined;
  readonly withheld: boolean;
}): PublicActiveSceneInput {
  const { group, status, spatials, narration, withheld } = args;
  const publicSummaries = [...group.events]
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    .map((event) => event.publicSummary)
    .filter((summary): summary is string => typeof summary === 'string' && summary.length > 0);

  return {
    // FR-P004 AC#2: a withheld scene keeps its place on the map and loses its words. The
    // substitution happens HERE, before the text ever reaches the public contract, so there is
    // no downstream stage that could be skipped and no redaction that could be partial.
    title: withheld ? WITHHELD_SCENE_TITLE : narration?.title ?? `${group.locationId} · ${group.timeSlot}`,
    summary: withheld ? WITHHELD_SCENE_SUMMARY : narration?.summary ?? publicSummaries.join(' '),
    // Kept even when withheld: AC#5 requires every public string to be traceable to accepted
    // events, and the placeholder is a public string. The ids name events, never their text.
    sourceEventIds: spatials.sourceEventIds,
    sceneId: `${group.worldDay}:${group.timeSlot}:${group.locationId}`,
    locationId: group.locationId,
    status,
    publicationStatus: withheld ? 'withheld' : 'published',
    startedAt: spatials.startedAt,
    // Empty lists are omitted rather than published as `[]`, matching how a motion omits
    // `sourceEventIds` it does not have: absent reads as "none", `[]` reads as "we looked
    // and are telling you nothing", and only one of those is true here.
    ...(spatials.participantCharacterIds.length > 0
      ? { participantCharacterIds: spatials.participantCharacterIds }
      : {}),
    ...(spatials.arcIds.length > 0 ? { arcIds: spatials.arcIds } : {}),
    // Only an ended scene has an end. Publishing the latest event's `acceptedAt` as the
    // `endedAt` of a scene still under way would assert a conclusion Canon has not reached.
    ...(status === 'ended' ? { endedAt: spatials.endedAt } : {}),
  };
}

/**
 * Derive every scene the public map should show.
 *
 * The current world time is the last accepted event's `(worldDay, timeSlot)` — derived here
 * from the same event list the projection derives its own `worldDay` / `timeSlot` from, so
 * the two cannot disagree about what "now" means.
 *
 * AC#7: every group in the current slot is `active`, ordered by descending latest sequence
 * number so the newest activity leads.
 *
 * AC#8: when the current slot produced no placeable event, the single most recent completed
 * scene stands in as `ended` rather than the map showing nothing. A world with no placeable
 * history at all yields an empty list — there is no honest scene to degrade to.
 */
export function buildActiveScenePresentations(
  input: BuildActiveScenePresentationsInput,
): ActiveScenePresentationResult {
  const arcIdsBySequence = new Map<number, readonly string[]>(
    input.arcMemberships.map((membership) => [membership.sourceEventSequenceNumber, membership.arcIds]),
  );
  const resolveOptions = { arcIdsBySequence, excludedCharacterIds: input.excludedCharacterIds };

  const latest = [...input.acceptedEvents]
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    .at(-1);
  const groups = groupSceneEvents(input.acceptedEvents);
  if (groups.length === 0 || latest === undefined) return { scenes: [], mode: 'none' };

  const present = (group: SceneGroup, status: PublicActiveSceneStatus) => {
    const spatials = resolveSceneSpatials(group.events, resolveOptions);
    const narration = narrationForEvents(new Set(spatials.sourceEventIds), input.publishedEpisodeScenes);
    const withheld = isGroupWithheld(group, input.sceneSafetyLabels);
    return {
      scene: presentGroup({ group, status, spatials, narration, withheld }),
      // A withheld scene never counts as narrated: its text came from this module's placeholder,
      // not from the episode, and reporting `episode` would attribute words nobody published.
      narrated: narration !== undefined && !withheld,
    };
  };

  const active = groups
    .filter((group) => group.worldDay === latest.worldDay && group.timeSlot === latest.timeSlot)
    .sort((left, right) => right.maxSequenceNumber - left.maxSequenceNumber);

  if (active.length === 0) {
    const newest = groups.reduce((best, group) =>
      group.maxSequenceNumber > best.maxSequenceNumber ? group : best);
    return { scenes: [present(newest, 'ended').scene], mode: 'degraded' };
  }

  const presented = active.map((group) => present(group, 'active'));
  return {
    scenes: presented.map((entry) => entry.scene),
    mode: presented.some((entry) => entry.narrated) ? 'episode' : 'canon',
  };
}
