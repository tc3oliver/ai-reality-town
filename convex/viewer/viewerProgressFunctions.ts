/**
 * Convex wiring for §13.12 Viewer Progress (FR-H004 / ART-39).
 *
 * ## The second viewer-reachable write, and why the boundary was raised to allow it
 *
 * Before this task, `architecture/module-boundaries.json` capped the deployment at ONE
 * viewer-gated mutation (ART-45's ballot). FR-H004 AC#3 requires an unauthenticated viewer to
 * have device-level progress, and §13.12 defines Viewer Progress as a persisted entity with an
 * `id` and a `viewerId` — a record, not a client-side preference. So the cap moved from 1 to 2,
 * which the checker deliberately makes cost two edits in two places (`publicFunctionSurface` and
 * `viewerWriteBoundary`) rather than one word in one. `docs/device-return-recap.md` §3 records
 * the alternative that was rejected — keeping the progress only in `localStorage` — and why a
 * store nothing on the server can read would have satisfied neither AC#7 nor ART-71.
 *
 * ## Why the READ takes a device key when the ballot read deliberately does not
 *
 * {@link ../viewer/environmentVoteFunctions.ts} argues that `getEnvironmentVoteBallot` must NOT
 * take a `deviceKey`: the ballot is the same for every viewer, so an identifier in the query
 * arguments would put it into a cached read of a page anyone can load, to save a round trip and
 * tell the client something it already knows.
 *
 * None of that holds here. This read has no world-wide answer — the row IS per-viewer, and there
 * is no version of「這個裝置讀到哪裡」that can be answered without the caller saying which device
 * it is. The identifier is therefore intrinsic to the request rather than added to it. It is
 * digested before it touches a row, never stored raw, and the read is gated `viewer` rather than
 * `anonymous` so the policy records that this is a per-viewer read and not part of the anonymous
 * public surface.
 *
 * ## What is true about isolation, stated once and not overstated
 *
 * Both functions resolve the row through `by_world_and_viewer` on a digest of the CALLER'S OWN
 * token. There is no caller-supplied row id, no listing, and no scan, so no request can reach a
 * row other than its own. That defeats accident and enumeration. It does NOT defeat an adversary
 * holding someone else's token — see {@link ./viewerProgress.ts} and
 * `docs/device-return-recap.md` §5. AC#7 is deliberately left unchecked on ART-39 for that
 * reason and for the missing authenticated half.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { mutation, query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { serveReadModel } from '../publicRead/readModel';
import { readStore } from '../publicRead/readModelFunctions';
import {
  DEFAULT_SPOILER_MODE,
  deviceViewerKey,
  evaluateViewerProgressSubmission,
  isProgressDeviceKey,
  refusalWritesNothing,
  validateViewerProgressRecord,
  viewerProgressEpisodeId,
  VIEWER_PROGRESS_SCHEMA_VERSION,
  type PublishedWorldContent,
} from './viewerProgress';

type QueryDb = GenericQueryCtx<DataModel>['db'];

/**
 * The row for one (world, viewer), or null.
 *
 * The ONLY row accessor in this module, taking a `viewerKey` the caller can never supply
 * directly. Concentrating it here is what makes「每一次讀寫都以呼叫端自己的 digest 走索引」a
 * property of the file rather than a habit of two handlers.
 */
async function loadProgressRow(db: QueryDb, worldId: string, viewerKey: string) {
  return db
    .query('viewerProgress')
    .withIndex('by_world_and_viewer', (q) => q.eq('worldId', worldId).eq('viewerKey', viewerKey))
    .unique();
}

/**
 * The world's published character / arc / episode vocabulary, or `null` when the world has
 * published no episode index at all.
 *
 * One published row carries all three, which is why the episode index is the source rather than
 * three separate reads: the union arc and character id sets are already materialised on it for
 * the FR-I004 filter UI.
 *
 * `null` is load-bearing and is NOT the same as three empty sets. A published-but-empty index is
 * a real world that has not shipped an episode yet; the absence of the row is the only evidence
 * available that the `worldId` the caller handed in names nothing. Collapsing the two let an
 * anonymous caller allocate a row and a fresh counter in an unbounded number of invented worlds,
 * because an empty submission satisfies every referential check vacuously.
 */
async function publishedWorldContent(
  db: QueryDb,
  worldId: string,
): Promise<PublishedWorldContent | null> {
  const served = await serveReadModel(readStore(db), worldId, 'episode', `episodes:${worldId}`);
  if (served === null) return null;
  const payload = (served.payload ?? null) as {
    episodes?: Array<{ worldDay?: unknown }>;
    arcIds?: unknown;
    characterIds?: unknown;
  } | null;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  const episodeRows = payload !== null && Array.isArray(payload.episodes) ? payload.episodes : [];
  const episodeIds = episodeRows
    .flatMap((episode) =>
      typeof episode?.worldDay === 'number'
        ? [viewerProgressEpisodeId(worldId, episode.worldDay)]
        : []);
  return {
    characterIds: new Set(strings(payload?.characterIds)),
    arcIds: new Set(strings(payload?.arcIds)),
    episodeIds: new Set(episodeIds),
  };
}

const progressValidator = v.object({
  lastViewedEpisodeId: v.union(v.string(), v.null()),
  followedCharacterIds: v.array(v.string()),
  followedArcIds: v.array(v.string()),
  spoilerMode: v.string(),
  updatedAt: v.number(),
});

/**
 * This device's progress in this world, or `null` (AC#3, AC#7 read half).
 *
 * `null` covers both「還沒有記錄」and「這把 key 的形狀不對」, and the malformed case returns
 * before any row is read. That is not politeness: a distinct error for a malformed key would make
 * the read report something about the key itself, and returning the same nothing for both keeps
 * the surface silent about everything except the caller's own recorded progress.
 *
 * The stored row is validated on the way out ({@link validateViewerProgressRecord}, AC#6). A row
 * this build cannot understand is served as `null` rather than coerced — the recap degrades to
 * 「還沒有進度」instead of rendering a spoiler mode nobody chose.
 */
export const getViewerProgress = query({
  args: { worldId: v.string(), deviceKey: v.string() },
  returns: v.union(progressValidator, v.null()),
  handler: async (ctx, args) => {
    // Before any row access, as the note above claims. Digesting garbage yields a perfectly
    // well-formed digest, so without this the read would go looking for a row that cannot exist
    // -- and the claim would describe a code path that was not there.
    if (!isProgressDeviceKey(args.deviceKey)) return null;
    const viewerKey = deviceViewerKey(args.deviceKey);
    const row = await loadProgressRow(ctx.db, args.worldId, viewerKey);
    if (!row) return null;
    try {
      const record = validateViewerProgressRecord(row);
      return {
        lastViewedEpisodeId: record.lastViewedEpisodeId,
        followedCharacterIds: record.followedCharacterIds,
        followedArcIds: record.followedArcIds,
        spoilerMode: record.spoilerMode,
        updatedAt: row.updatedAt,
      };
    } catch {
      return null;
    }
  },
});

const progressResultValidator = v.object({
  accepted: v.boolean(),
  code: v.union(v.string(), v.null()),
});

/**
 * Record this device's progress (FR-H004 AC#3, §13.12).
 *
 * The whole decision is {@link evaluateViewerProgressSubmission}, a pure function; this handler
 * only fetches the rows it needs and applies the verdict. The same three properties the ballot
 * rests on hold here:
 *
 *  - **The attempt is recorded whether or not it is accepted.** A refusal that cost nothing would
 *    make the attempt budget decorative, and the endpoint an oracle for enumerating which
 *    character and arc ids a world has.
 *  - **A device past its budget writes NOTHING AT ALL.** Past the budget the surface stops being
 *    a way to create or touch rows, so an exhausted caller cannot even keep a row's `updatedAt`
 *    moving.
 *  - **No submitted value is echoed.** The result is `accepted` plus a stable code. A caller
 *    learns the verdict on their own submission and nothing about the world or any other device.
 */
export const recordViewerProgress = mutation({
  args: {
    worldId: v.string(),
    deviceKey: v.string(),
    lastViewedEpisodeId: v.union(v.string(), v.null()),
    followedCharacterIds: v.array(v.string()),
    followedArcIds: v.array(v.string()),
    spoilerMode: v.string(),
  },
  returns: progressResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const viewerKey = deviceViewerKey(args.deviceKey);
    const existing = await loadProgressRow(ctx.db, args.worldId, viewerKey);
    const counter = await ctx.db
      .query('viewerProgressCounters')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .unique();

    const decision = evaluateViewerProgressSubmission({
      submission: {
        worldId: args.worldId,
        deviceKey: args.deviceKey,
        lastViewedEpisodeId: args.lastViewedEpisodeId,
        followedCharacterIds: args.followedCharacterIds,
        followedArcIds: args.followedArcIds,
        spoilerMode: args.spoilerMode,
      },
      history: { attempts: existing?.attempts ?? 0 },
      published: await publishedWorldContent(ctx.db, args.worldId),
      rowCount: counter?.rowCount ?? 0,
      hasExistingRow: existing !== null,
    });

    // Derived from {@link NON_WRITING_REJECTION_CODES} rather than from a code named here, so the
    // rule and its justification live in one place. Four refusals write nothing at all: the
    // attempt budget (past it, the surface stops being a way to touch a row), a malformed key
    // (it can never succeed, so spending a row on it is pure waste), an unknown world, and a
    // full one. The last two are ALLOCATION refusals -- writing their attempt would allocate the
    // row they exist to refuse and push `rowCount` past the ceiling.
    if (!decision.accepted && refusalWritesNothing(decision.code)) {
      return { accepted: false, code: decision.code };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        attempts: existing.attempts + 1,
        ...(decision.accepted
          ? {
              lastViewedEpisodeId: decision.record.lastViewedEpisodeId ?? undefined,
              followedCharacterIds: decision.record.followedCharacterIds,
              followedArcIds: decision.record.followedArcIds,
              spoilerMode: decision.record.spoilerMode,
            }
          : {}),
        updatedAt: now,
      });
    } else {
      // A refused FIRST submission still writes its row, for the same reason the ballot does:
      // otherwise the attempt budget only ever applies to callers who have already succeeded.
      await ctx.db.insert('viewerProgress', {
        schemaVersion: VIEWER_PROGRESS_SCHEMA_VERSION,
        worldId: args.worldId,
        viewerKey,
        ...(decision.accepted && decision.record.lastViewedEpisodeId !== null
          ? { lastViewedEpisodeId: decision.record.lastViewedEpisodeId }
          : {}),
        followedCharacterIds: decision.accepted ? decision.record.followedCharacterIds : [],
        followedArcIds: decision.accepted ? decision.record.followedArcIds : [],
        spoilerMode: decision.accepted ? decision.record.spoilerMode : DEFAULT_SPOILER_MODE,
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      });
      if (counter) {
        await ctx.db.patch(counter._id, { rowCount: counter.rowCount + 1, updatedAt: now });
      } else {
        await ctx.db.insert('viewerProgressCounters', {
          schemaVersion: 1,
          worldId: args.worldId,
          rowCount: 1,
          updatedAt: now,
        });
      }
    }

    return { accepted: decision.accepted, code: decision.accepted ? null : decision.code };
  },
});
