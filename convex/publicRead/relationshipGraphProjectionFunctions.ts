/**
 * Convex wiring for the scoped relationship graph (FR-I007 + NFR-002 / ART-44).
 *
 * ## What this reads
 *
 * Canon, plus the two index-scoped story reads `rebuildLiveProjection` already makes on this same
 * commit path:
 *
 *   - `canonEvents` by `by_world_and_sequence`, replayed through the deterministic reducer, for
 *     `relationshipHistory` — the day, all six deltas, the reason and the visibility of every
 *     relationship change (`convex/canon/model.ts` `RelationshipHistoryEntry`).
 *   - `storyArcLifecycles` + `storyArcProjectionEvents`, both `eq('worldId', …)` on existing
 *     indexes, for the current arc's status and `coreCharacterIds`.
 *
 * Why Canon rather than the published `relationship:<pairKey>` model — the shape argument, the
 * ART-95 independence argument, and the privacy trap in Canon's own accumulated
 * `RelationshipState` — is set out in the pure module's docblock. Read that before changing the
 * source of any of this.
 *
 * NONE of the `v.any()` generation-blob tables (`directorPlans.context`, `groupedSceneRuns.result`,
 * `sceneSimulationRuns.result`) is touched; those were the ART-46 review finding, and they are
 * what "no unbounded whole-world collect in a rebuild path" is actually about.
 *
 * `canonEvents` IS read whole. That is the same read `rebuildTimelineProjection`,
 * `rebuildLiveProjection` and `rebuildRelationshipProjection` already make on this path, and it is
 * unavoidable for an accumulated level: a relationship's current standing is a fold over its
 * entire history, so no suffix of the log answers it. ART-100 tracks making these incremental;
 * when it lands this rebuild moves with the others rather than needing its own design.
 *
 * ## No character text is published here
 *
 * A node carries `characterId`, `isCoreCharacter`, `hop` and `edgeCount` — who is on the graph and
 * how they got there — and nothing describing them. 人物摘要 (AC#2) is read by the VIEW from
 * `character:<id>`.
 *
 * That is a safety requirement, not a layering preference. Character text is subject to ART-132's
 * RETROACTIVE withhold: a day-5 Scene can be refused on day 9, through either
 * `postGenerationSafetyClassifications` or `safetyStatusOverrides`. This model is published for a
 * day while that day is current and is never rebuilt afterwards, so any summary baked into it
 * would freeze at publication and could never self-heal — permanently, for every past day.
 * `character:<id>` IS rebuilt whenever the character moves, so reading it live makes the withhold
 * automatic.
 *
 * An earlier revision derived summaries here via `characterSourceFrom` + `buildCharacterProjection`
 * and claimed the redaction "applies to both". It did not, and it also cost one full pass over the
 * event history per rendered node on the hot path. Both problems are gone with the field.
 *
 * What this model DOES publish as text is each edge's change reason, gated on Canon's own
 * `visibility === 'public'` — the identical gate `relationship:<pairKey>` applies. See
 * `docs/scoped-relationship-graph.md` §9 for what that gate does and does not cover.
 *
 * Public reads reuse ART-40's `getPublishedReadModel`; no new public query is added, so the public
 * function surface is unchanged and neither `publicReadOnlyGuarantee.test.ts` nor
 * `architecture/module-boundaries.json` needs an entry. This task adds NO mutation of any kind.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import { relationshipGraphModelRef } from '../shared/relationshipGraphRef';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';
import {
  buildRelationshipGraphProjection,
  groupPublicRelationships,
  RelationshipGraphError,
  RELATIONSHIP_GRAPH_MODEL_KIND,
  type CanonRelationshipHistoryEntry,
  type GraphArcInput,
} from './relationshipGraphProjection';

type MutationDb = GenericMutationCtx<DataModel>['db'];

type ArcLifecycleRow = { arcId: string; status: string };
type ArcProjectionEventRow = { arcId: string; revision: number; fields: unknown };

/**
 * Rebuild and publish the scoped relationship graph for one world day (AC#1/#2/#3).
 *
 * A plain function over a mutation `db` rather than the registered mutation itself, matching
 * `voteConsequenceProjectionFunctions.rebuildForDay`, so a caller that needs several days in one
 * transaction does not pay a `ctx.runMutation` round trip per day.
 */
async function rebuildForDay(
  db: MutationDb,
  args: { worldId: string; targetWorldDay: number; now: number },
): Promise<{ modelRef: string; version: number; deduplicated: boolean }> {
  if (args.worldId.trim().length === 0
    || !Number.isSafeInteger(args.targetWorldDay) || args.targetWorldDay < 0
    || !Number.isFinite(args.now)) {
    throw new RelationshipGraphError(
      'RELATIONSHIP_GRAPH_INVALID',
      'worldId, a non-negative targetWorldDay, and a finite now are required',
    );
  }

  const [canonRows, lifecycleRows, projectionRows] = await Promise.all([
    db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
    db.query('storyArcLifecycles')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect(),
    db.query('storyArcProjectionEvents')
      .withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId)).collect(),
  ]);

  const acceptedEvents = canonRows.map(rowToAcceptedEvent);
  const projection = replayWorldEvents(emptyProjection(args.worldId), acceptedEvents);

  /**
   * Canon's relationship history, flattened.
   *
   * `projection.relationships` — the accumulated `RelationshipState` sitting right beside this —
   * is deliberately NOT read. It folds private changes in with public ones and is internal-only
   * for exactly that reason (`convex/canon/queries.ts`). `groupPublicRelationships` re-folds the
   * public entries alone.
   */
  const history = Object.values(projection.relationshipHistory)
    .flat() as CanonRelationshipHistoryEntry[];
  const relationships = groupPublicRelationships(history);

  // Latest projection fields per arc, read the way `rebuildLiveProjection` reads them.
  const latestFieldsByArc = new Map<string, { revision: number; fields: unknown }>();
  for (const row of projectionRows as ArcProjectionEventRow[]) {
    const prior = latestFieldsByArc.get(row.arcId);
    if (!prior || row.revision > prior.revision) {
      latestFieldsByArc.set(row.arcId, { revision: row.revision, fields: row.fields });
    }
  }
  const arcs: GraphArcInput[] = (lifecycleRows as ArcLifecycleRow[]).flatMap((lifecycle) => {
    const latest = latestFieldsByArc.get(lifecycle.arcId);
    if (!latest) return [];
    const fields = parseArcProjectionFields(latest.fields);
    return [{
      arcId: lifecycle.arcId,
      title: fields.title,
      status: lifecycle.status,
      coreCharacterIds: fields.coreCharacterIds,
    }];
  });

  const payload = buildRelationshipGraphProjection({
    worldId: args.worldId, targetWorldDay: args.targetWorldDay, arcs, relationships,
  });

  const modelRef = relationshipGraphModelRef(args.worldId, args.targetWorldDay);
  const result = await commitReadModelVersion(writeStore(db), {
    worldId: args.worldId,
    modelKind: RELATIONSHIP_GRAPH_MODEL_KIND,
    modelRef,
    payload,
    sourceEventIds: payload.sourceEventIds,
    status: 'published',
    now: args.now,
  });
  return { modelRef, version: result.version, deduplicated: result.deduplicated };
}

/** Rebuild and publish the scoped relationship graph for one world day (AC#1/#2/#3). */
export const rebuildRelationshipGraphProjection = internalMutation({
  args: { worldId: v.string(), targetWorldDay: v.number(), now: v.number() },
  handler: (ctx, args) => rebuildForDay(ctx.db, args),
});
