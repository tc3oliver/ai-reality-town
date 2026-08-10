/**
 * Reading the safety label that governs a Scene RIGHT NOW (FR-P004 / ART-132).
 *
 * `postGenerationSafetyClassifications` records what the classifier decided when the Scene was
 * generated; `safetyStatusOverrides` records every operator revision of that decision since.
 * Neither answers the question a public projection actually asks — "may this Scene's text be
 * shown at this moment" — so this module joins them and applies
 * {@link resolveEffectiveSafetyLabel}, which is the one definition of "latest wins".
 *
 * TWO ACCESS PATTERNS, AND THE READ BUDGET IS WHY THERE ARE TWO
 * ------------------------------------------------------------
 * {@link readEffectiveSafetyLabels} answers "what governs these particular Scenes", which is
 * what the override command needs in order to verify its own effect. It is only ever called
 * with a bounded list.
 *
 * {@link readWithheldSceneLabels} answers "which Scenes in this world are refused right now",
 * which is what a rebuild needs — and a rebuild must NOT ask that Scene by Scene. It folds the
 * world's entire accepted history, so a per-Scene lookup would grow without bound as the world
 * ages; the first time that tripped a transaction limit, `rebuildLiveProjection` would throw,
 * the `liveState` model would stop republishing, the public projection would freeze on its
 * last-known-good snapshot, and a subsequent operator withhold would never reach a viewer. A
 * safety gate whose failure mode is "safety updates stop propagating" is worse than no gate,
 * because it looks like one.
 *
 * So the rebuild asks the inverted question, in reads that do not scale with history: the
 * REFUSED classifications (by `by_world_and_label`, so allowed content is never read at all)
 * and the world's overrides (operator actions, bounded by human effort). Everything absent from
 * their union is showable — the same answer, derived from the small side of the join.
 *
 * A Scene with NO classification row resolves to `allow`, deliberately rather than as a
 * fail-open oversight. Canon carries system and remediation events that no LLM ever wrote and
 * no post-generation classifier ever saw; treating their absence as "withheld" would blank the
 * public map for content that was never in scope for the classifier. Content the classifier DID
 * see and refuse is withheld by its own row, which is the case this gate exists for.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import {
  resolveEffectiveSafetyLabel,
  type PostGenerationLabel,
  type SafetyStatusOverrideLike,
} from './postGeneration';

type Db = GenericQueryCtx<DataModel>['db'];

/** Labels that refuse publication. Both gate identically. */
export const WITHHOLDING_LABELS: readonly PostGenerationLabel[] = ['withhold', 'human_review_required'];

export function isWithholdingLabel(label: PostGenerationLabel | undefined): boolean {
  return label === 'withhold' || label === 'human_review_required';
}

/**
 * The classification governing one Scene, or `null`.
 *
 * Newest wins, ties broken by ascending classification id. A Scene normally has exactly one
 * classification; a re-simulated Scene can have a second under a new run id, and picking by row
 * order instead would let two rebuilds of an unchanged world disagree.
 */
async function classificationForScene(db: Db, worldId: string, sourceId: string) {
  const rows = await db
    .query('postGenerationSafetyClassifications')
    .withIndex('by_world_and_source', (q) => q.eq('worldId', worldId).eq('sourceId', sourceId))
    .collect();
  return rows.sort((left, right) => right.createdAt - left.createdAt
    || left.classificationId.localeCompare(right.classificationId))[0] ?? null;
}

/** The newest override for one Scene, as a `take(1)` rather than a collect-and-sort. */
async function latestOverrideForScene(db: Db, worldId: string, sourceId: string) {
  const rows = await db
    .query('safetyStatusOverrides')
    .withIndex('by_world_source_and_created', (q) => q.eq('worldId', worldId).eq('sourceId', sourceId))
    .order('desc')
    .take(1);
  return rows[0] ?? null;
}

/** The label governing one Scene right now. */
export async function readEffectiveSafetyLabel(
  db: Db,
  worldId: string,
  sourceId: string,
): Promise<PostGenerationLabel> {
  const [classification, override] = await Promise.all([
    classificationForScene(db, worldId, sourceId),
    latestOverrideForScene(db, worldId, sourceId),
  ]);
  return resolveEffectiveSafetyLabel(
    { label: classification?.label ?? 'allow' },
    override ? [{ label: override.label, createdAt: override.createdAt }] : [],
  );
}

/**
 * The effective label of every named Scene, keyed by Scene id.
 *
 * Deduplicated and resolved in parallel. Only ever called with a BOUNDED list — see the module
 * header on why a rebuild must not reach this function with one Scene id per event in history.
 */
export async function readEffectiveSafetyLabels(
  db: Db,
  worldId: string,
  sceneIds: readonly string[],
): Promise<Record<string, PostGenerationLabel>> {
  const unique = [...new Set(sceneIds)].filter((sceneId) => sceneId.length > 0);
  const resolved = await Promise.all(
    unique.map(async (sceneId) => [sceneId, await readEffectiveSafetyLabel(db, worldId, sceneId)] as const),
  );
  return Object.fromEntries(resolved);
}

/**
 * Every Scene in this world whose text is refused right now, with the label that refuses it.
 *
 * Reads the REFUSED classifications (one indexed sweep per withholding label, so allowed
 * content is never read) plus the world's overrides. The union of their Scene ids is the
 * complete candidate set: a Scene absent from both was neither refused by the classifier nor
 * touched by an operator, so it is showable and never needed to be read. Each candidate is then
 * resolved through the same "latest override wins" rule, which is what lets an override RELEASE
 * refused content (it drops out of the result) as well as refuse allowed content (it appears).
 */
export async function readWithheldSceneLabels(
  db: Db,
  worldId: string,
): Promise<Record<string, PostGenerationLabel>> {
  const [refusedGroups, overrideRows] = await Promise.all([
    Promise.all(WITHHOLDING_LABELS.map((label) => db
      .query('postGenerationSafetyClassifications')
      .withIndex('by_world_and_label', (q) => q.eq('worldId', worldId).eq('label', label))
      .collect())),
    db
      .query('safetyStatusOverrides')
      .withIndex('by_world_source_and_created', (q) => q.eq('worldId', worldId))
      .collect(),
  ]);

  // Newest classification wins, decided the same way `classificationForScene` decides it, so
  // the two entry points cannot disagree about which run governs a re-classified Scene.
  const refusedBySource = new Map<string, { label: PostGenerationLabel; createdAt: number; classificationId: string }>();
  for (const row of refusedGroups.flat()) {
    const prior = refusedBySource.get(row.sourceId);
    const newer = prior === undefined
      || row.createdAt > prior.createdAt
      || (row.createdAt === prior.createdAt && row.classificationId.localeCompare(prior.classificationId) < 0);
    if (newer) {
      refusedBySource.set(row.sourceId, {
        label: row.label, createdAt: row.createdAt, classificationId: row.classificationId,
      });
    }
  }

  const overridesBySource = new Map<string, SafetyStatusOverrideLike[]>();
  for (const row of overrideRows) {
    const entry = { label: row.label, createdAt: row.createdAt };
    const existing = overridesBySource.get(row.sourceId);
    if (existing) existing.push(entry);
    else overridesBySource.set(row.sourceId, [entry]);
  }

  const withheld: Record<string, PostGenerationLabel> = {};
  for (const sourceId of new Set([...refusedBySource.keys(), ...overridesBySource.keys()])) {
    const label = resolveEffectiveSafetyLabel(
      // A Scene reachable only through the override table has no REFUSED classification, and
      // its own classification (if any) said something publishable — `allow` is that fact, not
      // a guess, because the refused sweep above would have found it otherwise.
      { label: refusedBySource.get(sourceId)?.label ?? 'allow' },
      overridesBySource.get(sourceId) ?? [],
    );
    if (isWithholdingLabel(label)) withheld[sourceId] = label;
  }
  return withheld;
}

/**
 * The Scene a classification run examined, or `null` when no such run exists.
 *
 * The override command takes a classification id — that is what an operator has in front of
 * them — but records its decision against the Scene, so the translation happens once, here,
 * rather than being re-derived by anything that reads the ledger.
 */
export async function sourceIdForClassification(
  db: Db,
  worldId: string,
  classificationId: string,
): Promise<string | null> {
  const row = await db
    .query('postGenerationSafetyClassifications')
    .withIndex('by_world_and_classification', (q) => q.eq('worldId', worldId).eq('classificationId', classificationId))
    .unique();
  return row?.sourceId ?? null;
}

/** The same join, for callers that hold a function reference rather than a database handle. */
export const getEffectiveSafetyLabels = internalQuery({
  args: { worldId: v.string(), sceneIds: v.array(v.string()) },
  handler: (ctx, args): Promise<Record<string, PostGenerationLabel>> =>
    readEffectiveSafetyLabels(ctx.db, args.worldId, args.sceneIds),
});

/** Operator-facing sweep: every Scene this world currently refuses to publish. */
export const getWithheldSceneLabels = internalQuery({
  args: { worldId: v.string() },
  handler: (ctx, args): Promise<Record<string, PostGenerationLabel>> =>
    readWithheldSceneLabels(ctx.db, args.worldId),
});
