/**
 * Convex wiring for episode-derived share formats (FR-G005 / ART-36).
 *
 * Turns one already-accepted Daily Episode into the four outreach formats and records the
 * result. The derivation itself lives in `derived/shareFormats.ts`, which the architecture
 * checker forbids from reaching any write surface at all; this file is the adapter that reads
 * the Episode, supplies the INDEPENDENT accepted-event set the validator checks provenance
 * against, and applies the existing safety gate.
 *
 * ## Reads are bounded (house rule: no world-wide sweep in a per-day path)
 *
 * Three point/range reads, all index-scoped: the Episode row and the day's accepted events by
 * `by_world_and_day`, and the derived copy's own safety verdict through
 * `readEffectiveSafetyLabel`, which is two indexed lookups keyed on the source id. Nothing here
 * grows with the world's history. The accepted-event read is the same bound
 * `generateAcceptedEventEpisode` already takes for the same day.
 *
 * ## Why the accepted events are re-read at all
 *
 * `validateEpisodeShareFormats` checks that every event a share format cites is an accepted
 * event. Handing it the ids off the Episode object the formats were derived FROM would make that
 * check a tautology — it would pass for any input, including a format citing an id that no
 * commit ever produced. So the accepted set is read from the accepted-event log independently,
 * and the check can actually fail.
 *
 * ## No Canon write, ever (AC#1)
 *
 * This file inserts into one derived table and creates a publication record. It reads the
 * accepted-event log and writes nothing back to it; there is no proposal, no commit, no
 * reduction. The module that composes the copy cannot even name those things.
 */

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import { deriveEventId } from '../shared/ids';
import type { createEpisodePublication as createEpisodePublicationExport } from './publicationLifecycleFunctions';
import {
  deriveGatedShareFormats,
  shareFormatsContentRef,
  shareFormatsSafetySourceId,
  ShareFormatError,
  type ShareSourceEpisode,
} from './derived/shareFormats';

const createEpisodePublicationRef = internalFunctionRef<typeof createEpisodePublicationExport>(
  'editorial/publicationLifecycleFunctions:createEpisodePublication',
);

/** Server actor for the automated pipeline. FR-K004 reserves `publish` for an administrator. */
const SYSTEM_ACTOR = { type: 'system' as const, id: 'episode-share-formats' };

/**
 * The subset of a persisted `dailyEpisodes.episode` blob the share formats read.
 *
 * The column is `v.any()`, so what comes back is `unknown` and has to be narrowed before it can
 * be trusted. Narrowed here rather than inside the derivation module, which by design cannot
 * depend on anything that knows what a stored Episode looks like.
 */
function asSourceEpisode(value: unknown): ShareSourceEpisode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const strings = (candidate: unknown): string[] | null => Array.isArray(candidate)
    && candidate.every((entry) => typeof entry === 'string') ? candidate as string[] : null;
  const sourceEventIds = strings(row.sourceEventIds);
  const newQuestions = strings(row.newQuestions);
  if (typeof row.worldId !== 'string' || typeof row.worldDay !== 'number' || typeof row.episodeNumber !== 'number'
      || typeof row.title !== 'string' || typeof row.headline !== 'string' || typeof row.oneLineSummary !== 'string'
      || typeof row.nextEpisodeTease !== 'string' || !Array.isArray(row.keyScenes)
      || sourceEventIds === null || newQuestions === null) {
    return null;
  }
  // Built mutably here and handed over as `readonly`: the derivation module's input type is
  // read-only all the way down on purpose, so the assembly has to happen on this side of it.
  const keyScenes: { title: string; summary: string; sourceEventIds: string[] }[] = [];
  for (const entry of row.keyScenes) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const scene = entry as Record<string, unknown>;
    const sceneSources = strings(scene.sourceEventIds);
    if (typeof scene.title !== 'string' || typeof scene.summary !== 'string' || sceneSources === null) return null;
    keyScenes.push({ title: scene.title, summary: scene.summary, sourceEventIds: sceneSources });
  }
  return {
    worldId: row.worldId, worldDay: row.worldDay, episodeNumber: row.episodeNumber,
    title: row.title, headline: row.headline, oneLineSummary: row.oneLineSummary,
    keyScenes, newQuestions, nextEpisodeTease: row.nextEpisodeTease, sourceEventIds,
  };
}

/**
 * Derive, gate and record the four FR-G005 share formats for one world day.
 *
 * Idempotent per world day: a repeated call returns the existing row untouched, matching how
 * `generateAcceptedEventEpisode` deduplicates. Returns without writing when the day has no
 * Episode at all — a day that was never assembled has nothing to reframe, and inserting a
 * `failed` row for it would report a defect where there is only an ordering.
 *
 * Never reaches `published`: the publication record is created by the `system` actor, which the
 * FR-K004 lifecycle refuses `publish` to.
 */
export const generateEpisodeShareFormats = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isSafeInteger(args.worldDay) || args.worldDay < 0
        || !Number.isFinite(args.createdAt)) {
      throw new ShareFormatError('SHARE_INVALID_REQUEST', 'invalid share-format generation request');
    }
    const prior = await ctx.db.query('episodeShareFormats')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (prior) {
      return { status: prior.status, reasonCodes: prior.reasonCodes, episodeNumber: prior.episodeNumber, deduplicated: true };
    }
    const episodeRow = await ctx.db.query('dailyEpisodes')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (!episodeRow) return { status: 'absent' as const, reasonCodes: [], episodeNumber: null, deduplicated: false };

    const episodeNumber = episodeRow.episodeNumber;
    const insertBlocked = async (reasonCodes: string[], errorCode?: string) => {
      await ctx.db.insert('episodeShareFormats', {
        schemaVersion: 1, worldId: args.worldId, worldDay: args.worldDay, episodeNumber,
        status: errorCode ? 'failed' : 'blocked', reasonCodes, ...(errorCode ? { errorCode } : {}),
        sourceEventIds: episodeRow.sourceEventIds, createdAt: args.createdAt,
      });
      return {
        status: errorCode ? 'failed' : 'blocked',
        reasonCodes, episodeNumber, deduplicated: false, ...(errorCode ? { errorCode } : {}),
      };
    };

    const source = asSourceEpisode(episodeRow.episode);
    // A withheld or failed Episode carries no `episode` blob at all, so both refusals land here.
    // The reason code still distinguishes them, because "the gate refused this day" and "the
    // stored blob is malformed" are different problems for whoever reads the row.
    if (episodeRow.status !== 'ready' || source === null) {
      return source === null && episodeRow.status === 'ready'
        ? insertBlocked(['SHARE_SOURCE_EPISODE_UNREADABLE'], 'SHARE_SOURCE_EPISODE_UNREADABLE')
        : insertBlocked(['SHARE_SOURCE_EPISODE_NOT_READY']);
    }

    try {
      // The independent accepted set. Same index and same day bound the Episode builder used,
      // read from the accepted-event log rather than taken off the Episode object.
      const acceptedRows = await ctx.db.query('canonEvents')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).collect();
      const acceptedSourceEventIds = acceptedRows.map((row) => deriveEventId(args.worldId, row.sequenceNumber));

      // Any operator revision already recorded against this day's derived copy, in ledger order,
      // so a re-run after a withhold decision honours it instead of re-deciding from scratch.
      const sourceId = shareFormatsSafetySourceId(args.worldId, args.worldDay);
      const overrideRows = await ctx.db.query('safetyStatusOverrides')
        .withIndex('by_world_source_and_created', (q) => q.eq('worldId', args.worldId).eq('sourceId', sourceId))
        .collect();

      const { decision, classification, formats } = deriveGatedShareFormats({
        episode: source,
        acceptedSourceEventIds,
        sourceEpisodeStatus: episodeRow.status,
        safetyOverrides: overrideRows.map(({ label, createdAt }) => ({ label, createdAt })),
      });
      const classificationId = classification.classificationId;
      await ctx.db.insert('postGenerationSafetyClassifications', {
        policyVersion: 1, worldId: classification.worldId, classificationId,
        sourceId: classification.sourceId, kind: classification.kind, label: classification.label,
        reasonCodes: classification.reasonCodes, warningCodes: classification.warningCodes,
        classifiedTextHash: classification.classifiedTextHash, createdAt: args.createdAt,
      });
      await ctx.db.insert('episodeShareFormats', {
        schemaVersion: 1, worldId: args.worldId, worldDay: args.worldDay, episodeNumber,
        status: decision.outcome === 'blocked' ? 'blocked' : 'manual_release_required',
        ...(decision.formats ? { formats: decision.formats } : {}),
        safetyClassificationId: classificationId,
        reasonCodes: [...decision.reasonCodes],
        sourceEventIds: [...formats.sourceEpisode.sourceEventIds],
        createdAt: args.createdAt,
      });
      // The publication record exists for BOTH outcomes: a refused piece of copy still has a
      // reviewable history, and creating the record only on success would mean the one case an
      // administrator most needs to find left no trace in the lifecycle.
      const { status: publicationStatus } = await ctx.runMutation(createEpisodePublicationRef, {
        worldId: args.worldId, contentRef: shareFormatsContentRef(args.worldId, args.worldDay),
        contentKind: 'episode_share', summary: null, actor: SYSTEM_ACTOR,
        reason: 'episode-derived share formats', now: args.createdAt,
      });
      return {
        status: decision.outcome === 'blocked' ? 'blocked' as const : 'manual_release_required' as const,
        reasonCodes: decision.reasonCodes, episodeNumber, publicationStatus,
        omissions: formats.omissions.length, deduplicated: false,
      };
    } catch (error) {
      const errorCode = error instanceof ShareFormatError ? error.code : 'SHARE_GENERATION_FAILED';
      return insertBlocked([errorCode], errorCode);
    }
  },
});

/** Operations-only: the derived share formats recorded for one world day. */
export const getEpisodeShareFormats = internalQuery({
  args: { worldId: v.string(), worldDay: v.number() },
  handler: (ctx, args) => ctx.db.query('episodeShareFormats')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique(),
});
