/**
 * Convex wiring for recap coverage and spoiler validation (FR-G004).
 *
 * Derives the {@link CoverageSourceEvent} view from Accepted Events plus Story
 * Arc classifications, turns a stored daily Episode into a release candidate,
 * and exposes the pre-release gate the editorial publication path calls in
 * place of a bare `validate` transition.
 *
 * Reads canon; never writes it. The only write is the publication-record patch
 * for the `generated` -> `validated` transition, which governs visibility of
 * derived content only and never touches an Accepted Event.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import type { AcceptedEvent } from '../canon/model';
import { parseArcEventClassification } from '../story/classification';
import { dailyEpisodePublicText, type DailyEpisode } from '../editorial/episode';
import {
  transitionPublication,
  validatePublicationRecord,
  PublicationLifecycleError,
  type PublicationActor,
  type PublicationContentKind,
  type PublicationRecord,
} from '../editorial/publicationLifecycle';
import { deriveFactId } from './recapFormats';
import {
  deriveRelationshipChangeId,
  relationshipChangeMagnitude,
  validateRecapCoverage,
  RecapCoverageError,
  type CoverageCandidate,
  type CoverageReport,
  type CoverageSourceEvent,
} from './coverageValidation';

const actorArgs = v.object({ type: v.union(v.literal('admin'), v.literal('system')), id: v.string() });

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** Strip the `:fact:<n>` / `:relationship:<n>` suffix to recover the owning event ID. */
function ownerEventId(derivedId: string): string {
  return derivedId.replace(/:(?:fact|relationship):\d+$/, '');
}

/** Project one Accepted Event into the view the coverage gate needs. */
function toCoverageSource(event: AcceptedEvent, importance: number, turningPointArcIds: string[]): CoverageSourceEvent {
  return {
    eventId: event.eventId,
    worldDay: event.worldDay,
    importance,
    turningPointArcIds,
    relationshipChanges: event.stateChanges.flatMap((change, index) => change.type === 'relationship_changed'
      ? [{
        changeId: deriveRelationshipChangeId(event.eventId, index),
        sourceCharacterId: change.sourceCharacterId,
        targetCharacterId: change.targetCharacterId,
        magnitude: relationshipChangeMagnitude(change),
        visibility: change.visibility ?? 'private',
      }]
      : []),
    publicFactIds: event.stateChanges.flatMap((change, index) => change.type === 'fact_created' && change.visibility === 'public'
      ? [deriveFactId(event.eventId, index)] : []),
    privateFactIds: event.stateChanges.flatMap((change, index) => change.type === 'fact_created' && change.visibility !== 'public'
      ? [deriveFactId(event.eventId, index)] : []),
  };
}

type Classification = { importance: number; turningPointArcIds: string[] };

/** Story-arc importance and turning-point roles, keyed by source event sequence number. */
async function loadClassifications(
  db: GenericQueryCtx<DataModel>['db'],
  worldId: string,
): Promise<Map<number, Classification>> {
  const rows = await db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', worldId)).collect();
  return new Map(rows.map((row) => {
    const classification = parseArcEventClassification({
      schemaVersion: row.schemaVersion, worldId: row.worldId, sourceEventId: row.sourceEventId,
      sourceEventSequenceNumber: row.sourceEventSequenceNumber,
      memberships: row.memberships as unknown, newArc: row.newArc as unknown,
    });
    return [row.sourceEventSequenceNumber, {
      importance: classification.memberships.reduce((maximum, item) => Math.max(maximum, item.importance), 0),
      turningPointArcIds: classification.memberships.filter(({ role }) => role === 'turning_point').map(({ arcId }) => arcId),
    }] as const;
  }));
}

/**
 * Accepted Events of `worldDay`, plus any further event the candidate
 * references. Resolving referenced events individually keeps the read bounded
 * while still letting the gate see that a citation points at a later world day.
 */
async function loadCoverageSources(
  db: GenericQueryCtx<DataModel>['db'],
  worldId: string,
  worldDay: number,
  referencedEventIds: readonly string[],
): Promise<CoverageSourceEvent[]> {
  const classifications = await loadClassifications(db, worldId);
  const dayRows = await db.query('canonEvents')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).collect();
  const events = new Map(dayRows.map((row) => [row.sequenceNumber, rowToAcceptedEvent(row)]));
  const known = new Set([...events.values()].map(({ eventId }) => eventId));
  for (const eventId of unique(referencedEventIds)) {
    if (known.has(eventId)) continue;
    const sequenceNumber = Number(eventId.split('#').at(-1));
    if (!Number.isSafeInteger(sequenceNumber)) continue;
    const row = await db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber)).unique();
    if (!row) continue;
    const event = rowToAcceptedEvent(row);
    if (event.eventId !== eventId) continue;
    events.set(row.sequenceNumber, event);
  }
  return [...events.entries()]
    .sort(([left], [right]) => left - right)
    .map(([sequenceNumber, event]) => {
      const classification = classifications.get(sequenceNumber);
      return toCoverageSource(event, classification?.importance ?? 0, classification?.turningPointArcIds ?? []);
    });
}

/**
 * Turn a stored daily Episode into a release candidate. A relationship change
 * counts as mentioned when the Episode carries a `relationshipChanges` entry
 * for its source event — the Episode builder emits exactly one entry per public
 * relationship movement of an event.
 */
function episodeCandidate(worldId: string, contentRef: string, episode: DailyEpisode, sources: readonly CoverageSourceEvent[]): CoverageCandidate {
  const citedEventIds = unique([
    ...episode.sourceEventIds,
    ...episode.keyScenes.flatMap(({ sourceEventIds }) => sourceEventIds),
    ...episode.relationshipChanges.map(({ sourceEventId }) => sourceEventId),
  ]);
  const mentionedEvents = new Set(episode.relationshipChanges.map(({ sourceEventId }) => sourceEventId));
  return {
    worldId,
    contentRef,
    worldDay: episode.worldDay,
    coverageFromWorldDay: episode.worldDay,
    citedEventIds,
    mentionedRelationshipChangeIds: sources
      .filter(({ eventId }) => mentionedEvents.has(eventId))
      .flatMap(({ relationshipChanges }) => relationshipChanges
        .filter(({ visibility }) => visibility === 'public')
        .map(({ changeId }) => changeId)),
    mentionedFactIds: unique(episode.keyScenes.flatMap(({ publicFactIds }) => publicFactIds)),
    declaredExclusions: [],
    text: dailyEpisodePublicText(episode),
  };
}

async function buildEpisodeReport(
  db: GenericQueryCtx<DataModel>['db'],
  worldId: string,
  worldDay: number,
  contentRef: string,
): Promise<CoverageReport> {
  const row = await db.query('dailyEpisodes')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).unique();
  if (!row || row.episode === undefined) {
    throw new RecapCoverageError('COVERAGE_INVALID_SHAPE', 'no generated Episode to validate for the requested world day');
  }
  const episode = row.episode as DailyEpisode;
  const referenced = unique([
    ...episode.sourceEventIds,
    ...episode.keyScenes.flatMap(({ sourceEventIds }) => sourceEventIds),
    ...episode.keyScenes.flatMap(({ publicFactIds }) => publicFactIds).map(ownerEventId),
    ...episode.relationshipChanges.map(({ sourceEventId }) => sourceEventId),
  ]);
  const sources = await loadCoverageSources(db, worldId, worldDay, referenced);
  const secrets = await db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect();
  const secretValues = secrets.flatMap(({ payload }) => payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).content === 'string'
    ? [(payload as Record<string, unknown>).content as string] : []);
  return validateRecapCoverage(episodeCandidate(worldId, contentRef, episode, sources), sources, secretValues);
}

/**
 * Operations-only: the FR-G004 coverage report for a stored daily Episode. Pure
 * read — it performs no publication transition and no write of any kind, so it
 * can also feed the FR-M002 Recap Coverage and Spoiler Violation metrics.
 */
export const getEpisodeCoverageReport = internalQuery({
  args: { worldId: v.string(), worldDay: v.number(), contentRef: v.string() },
  handler: (ctx, args) => buildEpisodeReport(ctx.db, args.worldId, args.worldDay, args.contentRef),
});

/**
 * Pre-release gate for the editorial publication path. Computes the FR-G004
 * coverage report for the Episode behind `contentRef` and advances the current
 * publication record `generated` -> `validated` only when it is releasable;
 * otherwise it throws {@link RecapCoverageError} with every blocking finding and
 * leaves the record untouched. Zero canon writes.
 */
export const validateEpisodeCoverageGate = internalMutation({
  args: {
    worldId: v.string(), worldDay: v.number(), contentRef: v.string(),
    actor: actorArgs, reason: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.worldDay) || args.worldDay < 0 || !Number.isFinite(args.now)) {
      throw new RecapCoverageError('COVERAGE_INVALID_SHAPE', 'invalid coverage gate request');
    }
    const report = await buildEpisodeReport(ctx.db, args.worldId, args.worldDay, args.contentRef);
    if (!report.releasable) {
      const codes = unique(report.findings.map(({ code }) => code)).join(', ');
      throw new RecapCoverageError(report.findings[0].code, `Episode failed coverage validation: ${codes}`, report.findings);
    }
    const row = await ctx.db.query('publicationRecords')
      .withIndex('by_current', (q) => q.eq('worldId', args.worldId).eq('contentRef', args.contentRef).eq('isCurrent', true))
      .unique();
    if (!row) throw new PublicationLifecycleError('PUBLICATION_NOT_FOUND', 'no current publication for content reference');
    const record: PublicationRecord = validatePublicationRecord({
      schemaVersion: row.schemaVersion, publicationId: row.publicationId, worldId: row.worldId,
      contentKind: row.contentKind as PublicationContentKind, contentRef: row.contentRef, status: row.status,
      version: row.version, summary: row.summary ?? null, audit: row.audit as PublicationRecord['audit'],
    });
    const next = transitionPublication(record, 'validate', args.actor as PublicationActor, args.reason, args.now);
    await ctx.db.patch(row._id, { status: next.status, audit: next.audit, updatedAt: args.now });
    return { publicationId: next.publicationId, status: next.status, version: next.version, report };
  },
});
