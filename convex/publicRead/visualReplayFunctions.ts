/**
 * Convex wiring for the Visual Replay (FR-O013 / ART-121).
 *
 * One anonymous query, and the whole design of this file is in what it does at read time.
 *
 * **Text is resolved here, never stored.** `visualReplay.ts` builds a payload of addresses;
 * this query turns an address into a sentence by consulting the publication record that is
 * current *at the moment of the read*, and emits the text only when that record's `version`
 * matches the version the step pinned AND its status is `ready` or `published`. A step whose
 * episode has since been withheld, superseded or re-versioned therefore resolves to nothing:
 * the reference is simply absent from `texts`, and the client renders its own placeholder.
 *
 * That absence is the mechanism FR-P004 / ART-132 builds its invalidation on, for BOTH kinds
 * of reference:
 *
 *  - `episodeScene` — gated here, by the publication record's version and status.
 *  - `canonEventSummary` — gated UPSTREAM, at rebuild time. `rebuildLiveProjection` drops the
 *    `publicSummary` of every event whose Scene the safety gate refuses
 *    (`redactWithheldSummaries`) before it builds either read model, so a withheld sentence is
 *    never written into `recentEvents` and the lookup below finds nothing. An operator
 *    override runs that rebuild, which is what makes a withhold take effect at once.
 *
 * That placement is deliberate rather than incidental. A read-time safety filter here would
 * have to reach into `canonEvents` to learn which Scene an event came from — a public read
 * touching the simulation's own tables, which the paragraph below rules out — and it would
 * leave the refused sentence sitting in the published payload, where the last-known-good
 * fallback would keep serving it. Redacting at the producer means there is nothing left to
 * filter.
 *
 * The read path touches `publishedReadModels`, `publicationRecords` and `dailyEpisodes`, all
 * by index and all point reads. There is no Canon table scan: a `canonEventSummary` reference
 * is answered from the already-published `liveState` read model's `recentEvents`, which is
 * text a viewer can already read on the Live page.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { LIVE_MODEL_KIND } from './liveState';
import { serveReadModel } from './readModel';
import { readStore } from './readModelFunctions';
import {
  VISUAL_REPLAY_MODEL_KIND,
  episodeContentRefOf,
  parseCanonEventSummaryId,
  parseEpisodeSceneSummaryId,
  replayTextReferences,
  selectVisualReplay,
  REPLAY_PUBLISHED_RECORD_STATUSES,
  type VisualReplay,
} from './visualReplay';
import { visualReplayResponseValidator } from './visualReplayValidators';

export type ReplayResolvedText = {
  publicSummaryId: string;
  publicationVersion: number;
  text: string;
};

type Db = GenericQueryCtx<DataModel>['db'];

/** A `dailyEpisodes` row's `episode`, which is `v.any()` in the schema. */
type EpisodeBody = { keyScenes?: Array<{ summary?: unknown }> };

/**
 * The current publication record for a `contentRef`, or `null`.
 *
 * `by_current` is a point read on `(worldId, contentRef, isCurrent)`, so a replay naming
 * three episodes costs three lookups rather than a scan of the world's publication history.
 */
async function currentPublicationRecord(
  db: Db,
  worldId: string,
  contentRef: string,
): Promise<{ version: number; status: string } | null> {
  const row = await db
    .query('publicationRecords')
    .withIndex('by_current', (q) => q.eq('worldId', worldId).eq('contentRef', contentRef).eq('isCurrent', true))
    .unique();
  return row ? { version: row.version, status: row.status } : null;
}

async function readyEpisodeBody(db: Db, worldId: string, worldDay: number): Promise<EpisodeBody | null> {
  const row = await db
    .query('dailyEpisodes')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
    .unique();
  if (!row || row.status !== 'ready') return null;
  return (row.episode ?? null) as EpisodeBody | null;
}

/**
 * The already-published summaries of recent Canon events, keyed by event id.
 *
 * Read from the `liveState` read model rather than from `canonEvents`, and that is not an
 * optimisation. The public read path consults published snapshots only (NFR-001/002/005): a
 * query that reached into Canon to find a sentence would be a public read touching the
 * simulation's own tables, and it would serve text that had never been through the read
 * model's allowlist. A replayed event that has aged out of `recentEvents` simply resolves to
 * nothing, which is the same honest outcome as a withheld episode.
 */
async function publishedEventSummaries(db: Db, worldId: string): Promise<Map<string, string>> {
  const served = await serveReadModel(readStore(db), worldId, LIVE_MODEL_KIND, `live:${worldId}`);
  const summaries = new Map<string, string>();
  const payload = served?.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return summaries;
  const recentEvents = (payload as { recentEvents?: unknown }).recentEvents;
  if (!Array.isArray(recentEvents)) return summaries;
  for (const entry of recentEvents) {
    if (entry === null || typeof entry !== 'object') continue;
    const { eventId, summary } = entry as { eventId?: unknown; summary?: unknown };
    if (typeof eventId !== 'string' || eventId.length === 0) continue;
    if (typeof summary !== 'string' || summary.length === 0) continue;
    summaries.set(eventId, summary);
  }
  return summaries;
}

/**
 * Resolve every address a replay names, dropping the ones that no longer resolve.
 *
 * Exported so the version-and-status gate can be exercised directly against a stubbed
 * database: the interesting cases (a withheld record, a superseded one, a version that has
 * moved on) are cheap to state here and unreachable through the builder, which never sees
 * a publication record change.
 */
export async function resolveReplayTexts(
  db: Db,
  worldId: string,
  replay: VisualReplay,
): Promise<ReplayResolvedText[]> {
  const references = replayTextReferences(replay);
  const texts: ReplayResolvedText[] = [];

  const records = new Map<string, { version: number; status: string } | null>();
  const episodes = new Map<number, EpisodeBody | null>();
  let canonSummaries: Map<string, string> | null = null;

  for (const reference of references) {
    if (reference.refKind === 'episodeScene') {
      const parsed = parseEpisodeSceneSummaryId(reference.publicSummaryId);
      // An address for another world cannot be answered from this one's rows. Defensive: the
      // replay came from this world's own read model, so this only fires on a corrupt payload.
      if (!parsed || parsed.contentRef !== episodeContentRefOf(worldId, parsed.worldDay)) continue;

      if (!records.has(parsed.contentRef)) {
        records.set(parsed.contentRef, await currentPublicationRecord(db, worldId, parsed.contentRef));
      }
      const record = records.get(parsed.contentRef) ?? null;
      // THE GATE. Both halves are required: a matching version whose record has been withheld
      // must not resolve, and a `published` record at a newer version addresses different text
      // from the one this step pinned.
      if (!record) continue;
      if (record.version !== reference.publicationVersion) continue;
      if (!REPLAY_PUBLISHED_RECORD_STATUSES.includes(record.status)) continue;

      if (!episodes.has(parsed.worldDay)) {
        episodes.set(parsed.worldDay, await readyEpisodeBody(db, worldId, parsed.worldDay));
      }
      const keyScene = episodes.get(parsed.worldDay)?.keyScenes?.[parsed.sceneIndex];
      const summary = keyScene?.summary;
      if (typeof summary !== 'string' || summary.length === 0) continue;
      texts.push({
        publicSummaryId: reference.publicSummaryId,
        publicationVersion: reference.publicationVersion,
        text: summary,
      });
      continue;
    }

    if (reference.refKind === 'canonEventSummary') {
      const eventId = parseCanonEventSummaryId(reference.publicSummaryId);
      if (!eventId) continue;
      canonSummaries ??= await publishedEventSummaries(db, worldId);
      const summary = canonSummaries.get(eventId);
      if (summary === undefined) continue;
      texts.push({
        publicSummaryId: reference.publicSummaryId,
        publicationVersion: reference.publicationVersion,
        text: summary,
      });
      continue;
    }

    // `publicExcerpt` — ART-123 owns the store this would read. Nothing produces one today,
    // and an unresolved reference is already the correct behaviour for one that appears.
  }

  return texts;
}

/**
 * Public read of the Visual Replay (FR-O013).
 *
 * A query, never a mutation: watching a replay, skipping it or asking for another must not be
 * able to write anything, and there is no write on this path to reach. Serves through the
 * same read-model store as every other public read, so it inherits the last-known-good
 * fallback for free, and re-validates the payload on the way out so a version persisted under
 * an older contract yields `null` rather than reaching a client that only knows the current
 * one.
 *
 * `null` until the first rebuild publishes a replay, and `null` for a world whose only
 * activity is the slot currently under way — there is no completed scene to replay, and the
 * client goes straight to the ambient live state.
 */
export const getPublicVisualReplay = query({
  args: { worldId: v.string() },
  returns: v.union(visualReplayResponseValidator, v.null()),
  handler: async (ctx, args) => {
    const served = await serveReadModel(
      readStore(ctx.db),
      args.worldId,
      VISUAL_REPLAY_MODEL_KIND,
      `replay:${args.worldId}`,
    );
    if (!served) return null;
    const replay = selectVisualReplay(served.payload);
    if (!replay) return null;
    return { replay, texts: await resolveReplayTexts(ctx.db, args.worldId, replay) };
  },
});
