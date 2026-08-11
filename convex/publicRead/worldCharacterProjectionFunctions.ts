/**
 * Convex wiring for the public World and Character projections (PRD §13.1/§13.2,
 * FR-I005). Independent rebuild entry points: gather accepted events (+ world
 * schedule), derive the publication-safe projection via explicit-allowlist pure
 * builders, and publish through the public read-model store. Public reads reuse
 * the generic failure-isolated getPublishedReadModel. Zero canon writes.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import { EXISTENCE_CHARACTER_STATE_FIELDS } from '../canon/eventTypes';
import type { AcceptedEvent } from '../canon/model';
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

async function loadWorldEvents(ctx: Ctx, worldId: string): Promise<AcceptedEvent[]> {
  const rows = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
  return rows.map(rowToAcceptedEvent);
}

/** Rebuild and publish the World projection (AC#1/#3). */
export const rebuildWorldProjection = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) throw new Error('PROJECTION_INVALID');
    const [events, scheduleRow] = await Promise.all([
      loadWorldEvents(ctx, args.worldId),
      ctx.db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique(),
    ]);
    const schedule = scheduleRow ? { mode: scheduleRow.mode, status: scheduleRow.status } : null;
    const payload = buildWorldProjection({
      worldId: args.worldId,
      source: worldSourceFrom(events, schedule),
      publicFacts: publicFactsFrom(events).filter((fact) => fact.subjectType === 'world' || fact.subjectType === 'location'),
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: WORLD_MODEL_KIND, modelRef: `world:${args.worldId}`,
      payload, sourceEventIds: events.slice(-20).map((event) => event.eventId), status: 'published', now: args.now,
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
 */
export const rebuildCharacterProjection = internalMutation({
  args: { worldId: v.string(), characterId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.characterId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new Error('PROJECTION_INVALID');
    }
    // Two reads that do not scale with history, not one lookup per event. See the module header
    // of `effectiveSafetyLabels.ts` on why a rebuild must ask the inverted question.
    const [events, withheldSceneLabels] = await Promise.all([
      loadWorldEvents(ctx, args.worldId),
      readWithheldSceneLabels(ctx.db, args.worldId),
    ]);
    const payload = buildCharacterProjection({
      worldId: args.worldId,
      source: characterSourceFrom(events, args.characterId, new Set(Object.keys(withheldSceneLabels))),
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: CHARACTER_MODEL_KIND, modelRef: `character:${args.characterId}`,
      payload, sourceEventIds: events.slice(-20).map((event) => event.eventId), status: 'published', now: args.now,
    });
    return { modelRef: `character:${args.characterId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
