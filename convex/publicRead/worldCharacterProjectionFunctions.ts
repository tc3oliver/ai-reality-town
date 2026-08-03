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
import type { AcceptedEvent } from '../canon/model';
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

const CHARACTER_STATE_FIELD_MAP: Record<string, string> = {
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

function characterSourceFrom(events: readonly AcceptedEvent[], characterId: string): Record<string, unknown> {
  const source: Record<string, unknown> = { id: characterId };
  const attrs = new Map<string, string | number | boolean>();
  for (const event of events) {
    for (const change of event.stateChanges) {
      if (change.type === 'character_location_changed' && change.characterId === characterId) {
        source.currentLocationId = change.toLocationId;
      } else if (change.type === 'character_life_changed' && change.characterId === characterId) {
        source.alive = change.alive;
      } else if (change.type === 'character_state_changed' && change.characterId === characterId) {
        const target = CHARACTER_STATE_FIELD_MAP[change.field];
        if (target) source[target] = change.toValue;
      } else if (change.type === 'fact_created' && change.subjectType === 'character' && change.subjectId === characterId
        && (change.visibility === 'public' || change.visibility === 'canon')) {
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

/** Rebuild and publish a Character projection (AC#2/#3). */
export const rebuildCharacterProjection = internalMutation({
  args: { worldId: v.string(), characterId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.characterId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new Error('PROJECTION_INVALID');
    }
    const events = await loadWorldEvents(ctx, args.worldId);
    const payload = buildCharacterProjection({
      worldId: args.worldId,
      source: characterSourceFrom(events, args.characterId),
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: CHARACTER_MODEL_KIND, modelRef: `character:${args.characterId}`,
      payload, sourceEventIds: events.slice(-20).map((event) => event.eventId), status: 'published', now: args.now,
    });
    return { modelRef: `character:${args.characterId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
