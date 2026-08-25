import { cronJobs } from 'convex/server';
import { DELETE_BATCH_SIZE, VACUUM_MAX_AGE } from './constants';
import { internalMutation } from './_generated/server';
import { TableNames } from './_generated/dataModel';
import { v } from 'convex/values';
import { internalFunctionRef } from './shared/internalFunctionRef';
import type { tickAllPublicSchedules as tickAllPublicSchedulesExport } from './simulation/schedulerOperations';
import type { captureAllPublicRuntimeSnapshots as captureAllPublicRuntimeSnapshotsExport } from './publicRead/runtimeSnapshotFunctions';
import type { tickEnvironmentVoteRounds as tickEnvironmentVoteRoundsExport } from './viewer/environmentVoteFunctions';

const crons = cronJobs();

const tickAllPublicSchedulesRef = internalFunctionRef<typeof tickAllPublicSchedulesExport>(
  'simulation/schedulerOperations:tickAllPublicSchedules',
);
const captureAllPublicRuntimeSnapshotsRef = internalFunctionRef<typeof captureAllPublicRuntimeSnapshotsExport>(
  'publicRead/runtimeSnapshotFunctions:captureAllPublicRuntimeSnapshots',
);
// `vacuumOldEntries`/`vacuumTable` are declared further down in this same file; a `typeof`
// type query resolves across the whole module regardless of declaration order, and these
// refs are only ever called from inside handler closures that run after module load.
const vacuumOldEntriesRef = internalFunctionRef<typeof vacuumOldEntries>('crons:vacuumOldEntries');
const vacuumTableRef = internalFunctionRef<typeof vacuumTable>('crons:vacuumTable');

const tickEnvironmentVoteRoundsRef = internalFunctionRef<typeof tickEnvironmentVoteRoundsExport>(
  'viewer/environmentVoteFunctions:tickEnvironmentVoteRounds',
);

// ART-112: the "stop inactive worlds" and "restart dead worlds" crons drove the retired
// a16z engine's own lifecycle (internal.world.stopInactiveWorlds / restartDeadWorlds, both
// deleted with convex/world.ts). Removed, not disabled -- there is no engine left to manage.

crons.interval(
  'reserve due AI Reality Town world slots',
  { seconds: 60 },
  tickAllPublicSchedulesRef,
);

// FR-N007: re-observe every public world, paused ones included. Hourly gives a 12x margin
// under the 12h observation threshold at which a snapshot is reported stale, and content-hash
// dedup keeps an idle world at one `observedAt` patch per run rather than a new row.
crons.interval(
  'capture public runtime snapshots',
  { hours: 1 },
  captureAllPublicRuntimeSnapshotsRef,
);

// FR-J001. Opens a world's daily ballot and closes it once the cutoff passes or the world moves
// past the day being voted on. Five minutes is a deliberate compromise: the interval bounds how
// long a closed round can sit un-elected before its winner is queued, and the winner has to be
// queued before the world reaches the slot it affects. A slower cron would let a vote expire
// unheard; a faster one would re-scan every public world for no gain, since a round changes
// state at most twice in its life.
crons.interval('tick environment vote rounds', { minutes: 5 }, tickEnvironmentVoteRoundsRef);

crons.daily('vacuum old entries', { hourUTC: 4, minuteUTC: 20 }, vacuumOldEntriesRef);

export default crons;

const TablesToVacuum: TableNames[] = [
  // Un-comment this to also clean out old conversations.
  // 'conversationMembers', 'conversations', 'messages',

  // Inputs aren't useful unless you're trying to replay history.
  // If you want to support that, you should add a snapshot table, so you can
  // replay from a certain time period. Or stop vacuuming inputs and replay from
  // the beginning of time
  'inputs',

  // We can keep memories without their embeddings for inspection, but we won't
  // retrieve them when searching memories via vector search.
  'memories',
  // We can vacuum fewer tables without serious consequences, but the only
  // one that will cause issues over time is having >>100k vectors.
  'memoryEmbeddings',

  // FR-Q001: attributed dynamic-view defects. Per-occurrence and therefore unbounded in a
  // world that keeps rebuilding with an unbound binding, so the standard two-week
  // retention applies — a defect nobody looked at for a fortnight is not evidence.
  // `dynamicViewMetricRollups` is deliberately NOT here: it holds one row per world, and
  // vacuuming by `_creationTime` would delete a long-quiet world's only metrics row rather
  // than trimming it. Same reasoning excludes `publicRuntimeSnapshots`.
  'dynamicViewIncidents',
];

export const vacuumOldEntries = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const before = Date.now() - VACUUM_MAX_AGE;
    for (const tableName of TablesToVacuum) {
      console.log(`Checking ${tableName}...`);
      const exists = await ctx.db
        .query(tableName)
        .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
        .first();
      if (exists) {
        console.log(`Vacuuming ${tableName}...`);
        await ctx.scheduler.runAfter(0, vacuumTableRef, {
          tableName,
          before,
          cursor: null,
          soFar: 0,
        });
      }
    }
  },
});

export const vacuumTable = internalMutation({
  args: {
    tableName: v.string(),
    before: v.number(),
    cursor: v.union(v.string(), v.null()),
    soFar: v.number(),
  },
  handler: async (ctx, { tableName, before, cursor, soFar }) => {
    const results = await ctx.db
      .query(tableName as TableNames)
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
      .paginate({ cursor, numItems: DELETE_BATCH_SIZE });
    for (const row of results.page) {
      await ctx.db.delete(row._id);
    }
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, vacuumTableRef, {
        tableName,
        before,
        soFar: results.page.length + soFar,
        cursor: results.continueCursor,
      });
    } else {
      console.log(`Vacuumed ${soFar + results.page.length} entries from ${tableName}`);
    }
  },
});
