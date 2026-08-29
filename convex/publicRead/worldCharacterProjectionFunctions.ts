/**
 * Convex wiring for the public World and Character projections (PRD §13.1/§13.2,
 * FR-I005). Independent rebuild entry points: gather accepted events (+ world
 * schedule), derive the publication-safe projection via explicit-allowlist pure
 * builders, and publish through the public read-model store. Public reads reuse
 * the generic failure-isolated getPublishedReadModel. Zero canon writes.
 *
 * ## ART-100 — reading a snapshot + the tail instead of the whole log
 *
 * Both rebuilds used to `loadWorldEvents` unconditionally: one `by_world_and_sequence` collect
 * bound only on `worldId`, i.e. the ENTIRE accepted-event log, on every accepted event. Each now
 * prefers `readLatestSnapshot` (ART-100, `convex/canon/snapshotReplay.ts`) + `loadProjectionSince`
 * (this module — a tail query bound to that snapshot's `lastSequenceNumber` plus
 * `replayFromSnapshot`, rather than calling `readProjectionViaSnapshot` and re-reading the
 * snapshot row a second time) — the newest daily snapshot plus only the events after it — and
 * falls back to `loadWorldEvents` when that substitution is not PROVABLY safe. The two rebuilds do
 * not share one fallback trigger, because they do not share one hazard:
 *
 *   - `rebuildWorldProjection` has no per-scene safety gate at all (`worldSourceFrom` reads every
 *     event unconditionally), so the only trigger is "no snapshot exists yet" — the substitution
 *     is otherwise unconditionally exact, argued field-by-field below.
 *   - `rebuildCharacterProjection` additionally falls back whenever ANY Scene in the world is
 *     currently withheld (the retroactive-withhold hazard, see `characterSourceFromProjection`'s
 *     docblock) OR the character has ever had a `character_life_changed` event (a canon-reducer
 *     quirk this module must not inherit, see the same docblock).
 *
 * Both fallbacks read the WHOLE log via the untouched `loadWorldEvents` + `characterSourceFrom` /
 * `worldSourceFrom` + `publicFactsFrom` path — the pre-ART-100 code, kept exactly as it was and
 * exercised directly by `worldCharacterProjectionFunctions.test.ts`'s existing coverage. Nothing
 * about published output changes; only how often the full log is read does.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import { EXISTENCE_CHARACTER_STATE_FIELDS } from '../canon/eventTypes';
import type { AcceptedEvent, WorldProjection as CanonWorldProjection } from '../canon/model';
import { readLatestSnapshot } from '../canon/snapshotReplay';
import { replayFromSnapshot, type CanonSnapshot } from '../canon/snapshots';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';
import {
  CHARACTER_MODEL_KIND,
  WORLD_MODEL_KIND,
  buildCharacterProjection,
  buildWorldProjection,
  type PublicFact,
} from './worldCharacterProjection';

type Ctx = GenericMutationCtx<DataModel>;

/**
 * How many trailing accepted events a rebuild stamps as `sourceEventIds` provenance. Shared so
 * both the full-log fallback (`events.slice(-RECENT_EVENTS_WINDOW)`) and the snapshot fast path
 * (`loadRecentWorldEvents`, a bounded `.order('desc').take(…)` rather than a full collect) agree
 * on the same window.
 */
const RECENT_EVENTS_WINDOW = 20;

/**
 * Which Canon `character_state_changed` fields reach a public projection field, and as what.
 *
 * Exported so `worldCharacterProjection.test.ts` can pin it against
 * `PUBLIC_TEXT_CHARACTER_STATE_FIELDS` + `EXISTENCE_CHARACTER_STATE_FIELDS` in `canon`. Those
 * two constants are what the safety classifier and this gate read, and they live in `canon`
 * because `simulation` may not depend on `publicRead` — so a test is the only thing that can
 * stop the two sides drifting apart. `organization_memberships` and `availability` are
 * deliberately absent: Canon accepts them, nothing publishes them.
 */
export const CHARACTER_STATE_FIELD_MAP: Record<string, string> = {
  health: 'healthState',
  emotion: 'emotionalState',
  finance: 'financialState',
  occupation: 'occupation',
  active: 'active',
};

function publicFactsFrom(events: readonly AcceptedEvent[]): PublicFact[] {
  const facts: PublicFact[] = [];
  for (const event of events) {
    event.stateChanges.forEach((change, index) => {
      if (change.type === 'fact_created' && (change.visibility === 'public' || change.visibility === 'canon')) {
        facts.push({
          factId: `${event.eventId}:fact:${index}`,
          subjectType: change.subjectType,
          subjectId: change.subjectId,
          predicate: change.predicate,
          value: change.value,
          validFromEventId: event.eventId,
        });
      }
    });
  }
  return facts;
}

function worldSourceFrom(events: readonly AcceptedEvent[], schedule: { mode: string; status: string } | null): Record<string, unknown> {
  const latest = events[events.length - 1];
  const worldFacts = publicFactsFrom(events).filter((fact) => fact.subjectType === 'world');
  const byPredicate = new Map(worldFacts.map((fact) => [fact.predicate, fact.value]));
  return {
    name: byPredicate.get('name') ?? null,
    description: byPredicate.get('description') ?? null,
    status: schedule?.status ?? null,
    currentWorldDay: latest ? latest.worldDay : null,
    currentTimeSlot: latest ? latest.timeSlot : null,
    simulationMode: schedule?.mode ?? null,
    publicLaunchDay: byPredicate.get('publicLaunchDay') ?? null,
    createdAt: null,
    updatedAt: latest ? latest.acceptedAt : null,
  };
}

/**
 * `publicFactsFrom`, sourced from a resumed `WorldProjection` instead of raw events (ART-100).
 *
 * `projection.facts` is an append-only log in the SAME order `publicFactsFrom` builds it in: the
 * reducer pushes one entry per `fact_created` change, `factId` formatted identically
 * (`${eventId}:fact:${changeIndex}`, `convex/canon/reducer.ts`), never reordered or removed —
 * only closed out via `validUntilEventId`, which this reads straight past (superseded and live
 * facts are BOTH wanted; `publicFactsFrom` never deduplicated). Filtering this array by
 * `subjectType` + `visibility` is therefore byte-identical to filtering `publicFactsFrom(events)`
 * the same way, for any prefix a snapshot could have been taken at. `facts` is not one of
 * `SEED_BASELINE_FIELDS` (`convex/canon/snapshotReplay.ts`), so a seeded baseline cannot perturb
 * it either.
 */
function publicFactsFromProjection(
  projection: CanonWorldProjection,
  subjectTypes: readonly string[],
): PublicFact[] {
  return projection.facts
    .filter((fact) => subjectTypes.includes(fact.subjectType)
      && (fact.visibility === 'public' || fact.visibility === 'canon'))
    .map((fact) => ({
      factId: fact.factId,
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      predicate: fact.predicate,
      value: fact.value,
      validFromEventId: fact.validFromEventId,
    }));
}

/**
 * `worldSourceFrom`, sourced from a resumed `WorldProjection` + a small trailing-events window
 * instead of the whole log (ART-100). `worldFacts` must already be `publicFactsFromProjection`'s
 * output restricted to `subjectType === 'world'` — same contract `worldSourceFrom` has with
 * `publicFactsFrom`. `latest` is the newest accepted event (or `null` for an eventless world),
 * standing in for `events[events.length - 1]`; nothing here reads any OTHER field the snapshot
 * would need to be trusted for, so there is no gating hazard to guard against — see this module's
 * header for why the World rebuild's only fallback trigger is "no snapshot yet".
 */
function worldSourceFromProjection(
  worldFacts: readonly PublicFact[],
  latest: AcceptedEvent | null,
  schedule: { mode: string; status: string } | null,
): Record<string, unknown> {
  const byPredicate = new Map(worldFacts.map((fact) => [fact.predicate, fact.value]));
  return {
    name: byPredicate.get('name') ?? null,
    description: byPredicate.get('description') ?? null,
    status: schedule?.status ?? null,
    currentWorldDay: latest ? latest.worldDay : null,
    currentTimeSlot: latest ? latest.timeSlot : null,
    simulationMode: schedule?.mode ?? null,
    publicLaunchDay: byPredicate.get('publicLaunchDay') ?? null,
    createdAt: null,
    updatedAt: latest ? latest.acceptedAt : null,
  };
}

/**
 * Character state fields the safety gate must never suppress (ART-124).
 *
 * `active` is projected like the four narrative fields but it is not a sentence — it asserts
 * that a character has left or rejoined the world. Gating it would let a withheld scene
 * RESURRECT a deactivated character: the fold would skip the deactivation, the field would keep
 * its previous `true`, and the public projection would disagree with
 * `excludedCharacterIds` — which reads the same change as existence on the motion path and has
 * no safety input at all. That is the same reason `character_life_changed` is not gated, and it
 * has to be spelled out here because `CHARACTER_STATE_FIELD_MAP` maps both kinds.
 */
const UNGATED_STATE_FIELDS = new Set<string>(EXISTENCE_CHARACTER_STATE_FIELDS);

/**
 * The Scene an accepted event was produced by, or `null` (FR-P004 / ART-132).
 *
 * Read exactly as `sceneEventRows` in `liveStateFunctions.ts` reads it: `metadata` is untyped
 * storage, so anything that is not a non-empty string is treated as absent.
 */
function eventSceneId(event: AcceptedEvent): string | null {
  const sceneId = event.metadata?.sceneId;
  return typeof sceneId === 'string' && sceneId.length > 0 ? sceneId : null;
}

/**
 * Fold a character's public attributes out of accepted Canon (AC#2), skipping every biographical
 * value the safety gate currently refuses (ART-124, extending FR-P004 / ART-132).
 *
 * `withheldSceneIds` carries only the REFUSED Scenes — anything absent is showable, which is what
 * lets the caller use ART-132's bounded `readWithheldSceneLabels` sweep instead of a per-event
 * lookup that would grow with the world's history.
 *
 * A refused event is skipped as if it had never been accepted, so the field keeps whatever value
 * it held BEFORE that event — the module's ordinary last-known-good behaviour — and disappears
 * entirely only when the refused event was the first to write it. Canon itself is untouched: this
 * reads events, it never rewrites them, and a later override that releases the Scene brings the
 * value straight back on the next rebuild.
 *
 * The gate covers TEXT only: `fact_created` and the narrative `character_state_changed` fields.
 * Location changes, life changes and `active` are position and existence rather than text — the
 * same reason ART-132 left character motion untouched — and withholding them would move a
 * character on the map, or resurrect one who has left the world, because a sentence about them
 * was under review. See {@link UNGATED_STATE_FIELDS}.
 *
 * An event with NO resolvable `sceneId` (seed, system and remediation events, plus everything
 * accepted before ART-132 stamped provenance) is NOT withheld. That is ART-132's stated
 * convention: silence from the classifier means "never in scope", not "refused".
 *
 * `withheldSceneIds` is REQUIRED rather than defaulted. A default would be a fail-open one — the
 * empty set publishes everything — and the whole point of this parameter is that forgetting it
 * is the bug it exists to prevent. Callers with nothing to withhold pass an empty set on purpose.
 */
export function characterSourceFrom(
  events: readonly AcceptedEvent[],
  characterId: string,
  withheldSceneIds: ReadonlySet<string>,
): Record<string, unknown> {
  const source: Record<string, unknown> = { id: characterId };
  const attrs = new Map<string, string | number | boolean>();
  for (const event of events) {
    const sceneId = eventSceneId(event);
    const withheld = sceneId !== null && withheldSceneIds.has(sceneId);
    for (const change of event.stateChanges) {
      if (change.type === 'character_location_changed' && change.characterId === characterId) {
        source.currentLocationId = change.toLocationId;
      } else if (change.type === 'character_life_changed' && change.characterId === characterId) {
        source.alive = change.alive;
      } else if (change.type === 'character_state_changed' && change.characterId === characterId) {
        if (withheld && !UNGATED_STATE_FIELDS.has(change.field)) continue;
        const target = CHARACTER_STATE_FIELD_MAP[change.field];
        if (target) source[target] = change.toValue;
      } else if (change.type === 'fact_created' && change.subjectType === 'character' && change.subjectId === characterId
        && (change.visibility === 'public' || change.visibility === 'canon')) {
        if (withheld) continue;
        attrs.set(change.predicate, change.value);
      }
    }
  }
  for (const [predicate, value] of attrs) {
    if (!(predicate in source)) source[predicate] = value;
  }
  return source;
}

/**
 * `characterSourceFrom`, sourced from a resumed `WorldProjection` instead of raw events
 * (ART-100). ONLY valid when the caller has independently ruled out BOTH hazards this function
 * cannot see:
 *
 * 1. **No withhold may be active anywhere in the world.** `projection.characterStates` and
 *    `projection.facts` are the canon reducer's OWN fold, which has no notion of a refused Scene
 *    and applies every event unconditionally. That is only equivalent to `characterSourceFrom`'s
 *    withhold-aware fold when `withheldSceneIds` would have been empty anyway — i.e. nothing in
 *    the world is currently withheld. The caller must check this BEFORE calling.
 *
 * 2. **This character must never have had a `character_life_changed` event.** This is a hazard
 *    `characterSourceFrom` itself does not have to think about, found by reading
 *    `convex/canon/reducer.ts`'s `character_life_changed` case: it writes `characterAlive` AND
 *    implicitly clears `characterStates[id].active` to `false` as a side effect
 *    (`...(!change.alive ? { active: false } : {})`) — a canon-internal bookkeeping choice this
 *    module's `active` field must NOT inherit, because `characterSourceFrom` deliberately leaves
 *    `active` untouched by a life change (only an explicit `character_state_changed(field:
 *    'active')` event moves it; see {@link UNGATED_STATE_FIELDS}'s docblock on why `active` is
 *    ungated but distinct from `alive`). Reading `characterStates[id].active` for a character who
 *    has ever died would silently publish the reducer's side effect instead of this module's own
 *    rule, breaking AC#3 for exactly the characters where it matters most. The caller must check
 *    `characterId in projection.characterAlive` and fall back when it is present. `alive` itself
 *    is therefore also never read here: the precondition guarantees no life event ever fired, so
 *    it is correctly left unset (defaulting to `true`, `characterSourceFrom`'s own behaviour for
 *    a character with no life event).
 *
 * Everything else IS safe to substitute directly: `characterLocations` and the four gated
 * `character_state_changed` targets (`characterStates`, restricted to
 * {@link CHARACTER_STATE_FIELD_MAP}'s keys) are written by exactly one event type each with no
 * side effects from any other, so the reducer's last-write-wins collapse equals
 * `characterSourceFrom`'s. `projection.facts` retains full history in push order (not just the
 * live, non-superseded entries), so folding it here with the SAME visibility check
 * `characterSourceFrom` applies — skipping private facts entirely rather than letting them clear
 * a prior public one — reproduces `attrs` exactly, including a public value that survives a LATER
 * private write for the same predicate.
 */
export function characterSourceFromProjection(
  projection: CanonWorldProjection,
  characterId: string,
): Record<string, unknown> {
  const source: Record<string, unknown> = { id: characterId };
  const currentLocationId = projection.characterLocations[characterId];
  if (currentLocationId !== undefined) source.currentLocationId = currentLocationId;
  const state = projection.characterStates[characterId] as Record<string, unknown> | undefined;
  if (state) {
    for (const [field, target] of Object.entries(CHARACTER_STATE_FIELD_MAP)) {
      const value = state[field];
      if (value !== undefined) source[target] = value as string | boolean | string[];
    }
  }
  const attrs = new Map<string, string | number | boolean>();
  for (const fact of projection.facts) {
    if (fact.subjectType !== 'character' || fact.subjectId !== characterId) continue;
    if (fact.visibility === 'public' || fact.visibility === 'canon') attrs.set(fact.predicate, fact.value);
  }
  for (const [predicate, value] of attrs) {
    if (!(predicate in source)) source[predicate] = value;
  }
  return source;
}

/** The most recent `limit` accepted events for a world, OLDEST first — `events.slice(-limit)` on
 * the full log without reading the full log: a bounded `.order('desc').take(limit)` reversed.
 * Used for `sourceEventIds` provenance stamping on the snapshot fast path, where the caller does
 * not otherwise load the full event array to slice from. */
async function loadRecentWorldEvents(ctx: Ctx, worldId: string, limit: number): Promise<AcceptedEvent[]> {
  const rows = await ctx.db.query('canonEvents')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
    .order('desc')
    .take(limit);
  return rows.map(rowToAcceptedEvent).reverse();
}

/**
 * A world's current projection, resumed from an ALREADY-FETCHED snapshot — the same substitution
 * `readProjectionViaSnapshot` (`convex/canon/snapshotReplay.ts`) makes, but taking the snapshot as
 * a parameter instead of reading it again, since both call sites here already read it once to
 * decide whether to take the fast path at all. Reads only the events after `snapshot`, bounded to
 * roughly one world day's worth (stage 20 writes a daily snapshot), never the full log.
 */
async function loadProjectionSince(ctx: Ctx, worldId: string, snapshot: CanonSnapshot): Promise<CanonWorldProjection> {
  const tailRows = await ctx.db.query('canonEvents')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).gt('sequenceNumber', snapshot.lastSequenceNumber))
    .collect();
  return replayFromSnapshot(snapshot, tailRows.map(rowToAcceptedEvent));
}

async function loadWorldEvents(ctx: Ctx, worldId: string): Promise<AcceptedEvent[]> {
  const rows = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
  return rows.map(rowToAcceptedEvent);
}

/** The full-log fold (`characterSourceFrom`, unchanged) plus its matching provenance window,
 * shared by every escape-hatch branch of `rebuildCharacterProjection`. */
async function fullCharacterFold(
  ctx: Ctx,
  worldId: string,
  characterId: string,
  withheldSceneIds: ReadonlySet<string>,
): Promise<{ source: Record<string, unknown>; sourceEventIds: string[] }> {
  const events = await loadWorldEvents(ctx, worldId);
  return {
    source: characterSourceFrom(events, characterId, withheldSceneIds),
    sourceEventIds: events.slice(-RECENT_EVENTS_WINDOW).map((event) => event.eventId),
  };
}

/**
 * Rebuild and publish the World projection (AC#1/#3).
 *
 * ART-100: reads the newest snapshot + only the events after it when one exists, falling back to
 * the full log for a world that has never been snapshotted (`readLatestSnapshot` returns `null`
 * before Canon's first daily snapshot, and for a freshly imported world with only its `initial`
 * snapshot the very next event already puts a row in the tail). No OTHER fallback trigger is
 * needed here — see this module's header for why the World rebuild has no safety-gate hazard to
 * guard against.
 */
export const rebuildWorldProjection = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) throw new Error('PROJECTION_INVALID');
    const [snapshot, scheduleRow] = await Promise.all([
      readLatestSnapshot(ctx.db, args.worldId),
      ctx.db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique(),
    ]);
    const schedule = scheduleRow ? { mode: scheduleRow.mode, status: scheduleRow.status } : null;

    let source: Record<string, unknown>;
    let publicFacts: PublicFact[];
    let sourceEventIds: string[];
    if (!snapshot) {
      const events = await loadWorldEvents(ctx, args.worldId);
      source = worldSourceFrom(events, schedule);
      publicFacts = publicFactsFrom(events).filter((fact) => fact.subjectType === 'world' || fact.subjectType === 'location');
      sourceEventIds = events.slice(-RECENT_EVENTS_WINDOW).map((event) => event.eventId);
    } else {
      const [projection, recentEvents] = await Promise.all([
        loadProjectionSince(ctx, args.worldId, snapshot),
        loadRecentWorldEvents(ctx, args.worldId, RECENT_EVENTS_WINDOW),
      ]);
      const latest = recentEvents[recentEvents.length - 1] ?? null;
      publicFacts = publicFactsFromProjection(projection, ['world', 'location']);
      source = worldSourceFromProjection(publicFactsFromProjection(projection, ['world']), latest, schedule);
      sourceEventIds = recentEvents.map((event) => event.eventId);
    }

    const payload = buildWorldProjection({ worldId: args.worldId, source, publicFacts });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: WORLD_MODEL_KIND, modelRef: `world:${args.worldId}`,
      payload, sourceEventIds, status: 'published', now: args.now,
    });
    return { modelRef: `world:${args.worldId}`, version: result.version, deduplicated: result.deduplicated };
  },
});

/**
 * Rebuild and publish a Character projection (AC#2/#3).
 *
 * The safety gate is applied HERE, at rebuild time, for the reason ART-132 states for the
 * dynamic surface: the public read path serves published snapshots and nothing else, so a
 * refused biography must never be written into the payload in the first place. An operator
 * override re-runs the rebuild, which is what makes a retroactive withhold take effect
 * immediately instead of at the next Canon commit.
 *
 * ART-100: prefers the snapshot fast path (`characterSourceFromProjection`), falling back to the
 * full-log fold (`characterSourceFrom`, unchanged) when either precondition that function's
 * docblock lists is not met — no snapshot yet, some Scene in the world is currently withheld, or
 * this character has ever had a `character_life_changed` event. The middle condition is the
 * escape hatch the retroactive-withhold hazard requires: an operator refusing or releasing a
 * day-5 Scene on day 9 changes the withheld set for events already folded, which neither adding
 * nor releasing a withhold can be expressed as an append onto — so any rebuild running while a
 * withhold is active anywhere in the world takes the full, per-event, withhold-aware path rather
 * than trusting the reducer's un-gated collapse.
 */
export const rebuildCharacterProjection = internalMutation({
  args: { worldId: v.string(), characterId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.characterId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new Error('PROJECTION_INVALID');
    }
    // Two reads that do not scale with history, not one lookup per event. See the module header
    // of `effectiveSafetyLabels.ts` on why a rebuild must ask the inverted question.
    const [withheldSceneLabels, snapshot] = await Promise.all([
      readWithheldSceneLabels(ctx.db, args.worldId),
      readLatestSnapshot(ctx.db, args.worldId),
    ]);
    const hasActiveWithholds = Object.keys(withheldSceneLabels).length > 0;

    let source: Record<string, unknown>;
    let sourceEventIds: string[];
    if (!snapshot || hasActiveWithholds) {
      ({ source, sourceEventIds } = await fullCharacterFold(
        ctx, args.worldId, args.characterId, new Set(Object.keys(withheldSceneLabels)),
      ));
    } else if (args.characterId in snapshot.projection.characterAlive) {
      // The `active`/life-change escape hatch — see `characterSourceFromProjection`'s docblock.
      // Decided from the ALREADY-FETCHED snapshot alone (zero extra reads) when the death is old
      // enough to already be folded into it, which is the common case for an escape this rare.
      ({ source, sourceEventIds } = await fullCharacterFold(ctx, args.worldId, args.characterId, new Set()));
    } else {
      // NOT parallelised with the provenance-window read below: that read is only useful on the
      // fast branch, and fetching it up front would waste a bounded-but-real 20-document read on
      // every escape to the full fold the death check below causes.
      const projection = await loadProjectionSince(ctx, args.worldId, snapshot);
      if (args.characterId in projection.characterAlive) {
        // Same escape hatch, for a death that happened within the tail (after the snapshot).
        ({ source, sourceEventIds } = await fullCharacterFold(ctx, args.worldId, args.characterId, new Set()));
      } else {
        const recentEvents = await loadRecentWorldEvents(ctx, args.worldId, RECENT_EVENTS_WINDOW);
        source = characterSourceFromProjection(projection, args.characterId);
        sourceEventIds = recentEvents.map((event) => event.eventId);
      }
    }

    const payload = buildCharacterProjection({ worldId: args.worldId, source });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: CHARACTER_MODEL_KIND, modelRef: `character:${args.characterId}`,
      payload, sourceEventIds, status: 'published', now: args.now,
    });
    return { modelRef: `character:${args.characterId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
