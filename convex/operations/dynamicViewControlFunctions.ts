import { v } from 'convex/values';

import { mutation, query, type QueryCtx } from '../_generated/server';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import type { rebuildLiveProjection as rebuildLiveProjectionExport } from '../publicRead/liveStateFunctions';
import {
  assertDynamicViewControlEntry,
  resolveDynamicViewControls,
  type DynamicControlKind,
  type DynamicViewControlEntry,
  type EffectiveDynamicViewControls,
} from '../shared/dynamicViewControls';
import {
  commandArgs,
  credentialArgs,
  operatorNow,
  recordAudit,
  requireOperator,
} from './opsConsoleFunctions';

/**
 * Convex wiring for the dynamic view's operator controls (FR-Q002 / ART-134).
 *
 * ## Every command goes through THE gate, not a second one
 *
 * `requireOperator` and `recordAudit` are imported from `opsConsoleFunctions` rather than
 * reimplemented, which is AC#8 stated as a structure. The console's own doc comment already
 * asks for this ("exported so every additional authorized console surface passes through THIS
 * gate instead of standing up a second authorization mechanism"), and FR-K006's emergency-stop
 * controls set the precedent.
 *
 * The consequence worth noticing: these commands inherit the whole gate, not just the check.
 * They fail closed on an unset registry, they honour the identity-over-token precedence and the
 * `CLERK_JWT_ISSUER_DOMAIN` cutover, and their audit row is written inside the command's own
 * transaction — so a control that throws leaves no audit row claiming it applied, and a control
 * whose audit row cannot be built does not apply.
 *
 * ## What these cannot do (AC#6, AC#7)
 *
 * Nothing here imports `convex/canon`. The controls append to one ledger and read published
 * projections; there is no path from a visibility control to a Canon event, and no path that
 * skips FR-K005's correction workflow. `dynamicViewControls.boundary.test.ts` asserts that by
 * reading this file rather than by trusting the description.
 *
 * A rebuild (AC#5) re-derives the projection from Canon as it already stands. It is the one
 * command that touches the projection pipeline, and it is a READ of Canon followed by a write
 * to the read-model store — the same thing the post-commit orchestrator does on every accepted
 * event, with no new authority over what Canon contains.
 */

/**
 * The projection rebuild, referenced the way every other caller references it.
 *
 * `rebuildLiveProjection` is an `internalMutation` and stays one: making it publicly callable
 * to satisfy AC#5 would put an unauthenticated rebuild on the public surface, which
 * `publicFunctionSurface` would refuse and rightly. The operator command below is the gate; the
 * rebuild itself is unchanged, and it is the SAME one the post-commit orchestrator runs after
 * every accepted event.
 */
const rebuildLiveProjectionRef = internalFunctionRef<typeof rebuildLiveProjectionExport>(
  'publicRead/liveStateFunctions:rebuildLiveProjection',
);

/** Every control the console exposes, and the capability each needs. */
const CONTROL_CAPABILITY = {
  pause_updates: 'dynamic.pause',
  pin_snapshot: 'dynamic.pin_snapshot',
  hide_character: 'dynamic.hide',
  hide_scene: 'dynamic.hide',
} as const satisfies Record<DynamicControlKind, string>;

/** Read the ledger for a world, oldest first. Bounded by the index, not by a scan. */
async function loadControlEntries(
  ctx: QueryCtx,
  worldId: string,
): Promise<DynamicViewControlEntry[]> {
  const rows = await ctx.db
    .query('dynamicViewControls')
    .withIndex('by_world_and_created', (q) => q.eq('worldId', worldId))
    .collect();
  return rows.map((row) => ({
    worldId: row.worldId,
    kind: row.kind,
    target: row.target ?? null,
    engaged: row.engaged,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.createdAt,
  }));
}

/**
 * The effective controls for a world.
 *
 * Exported so the projection builder and the public read path resolve the SAME state this
 * console reports. Two resolvers would eventually disagree, and the way they would disagree is
 * that something an operator hid would still be on screen.
 */
export async function effectiveDynamicViewControls(
  ctx: QueryCtx,
  worldId: string,
): Promise<EffectiveDynamicViewControls> {
  return resolveDynamicViewControls(await loadControlEntries(ctx, worldId));
}

const controlArgs = {
  ...commandArgs,
  engaged: v.boolean(),
  now: v.optional(v.number()),
} as const;

/**
 * Append one control row, having authorised it and audited it.
 *
 * One helper for all four commands rather than four near-identical handlers: the ordering here
 * — authorise, validate, append, audit, all in one transaction — is the part that must not vary
 * between them, and four copies of it is four chances for one to drift.
 */
async function applyControl(
  ctx: Parameters<typeof recordAudit>[0],
  kind: DynamicControlKind,
  args: { worldId: string; reason: string; engaged: boolean; now?: number; target?: string;
    operatorId?: string; operatorToken?: string },
): Promise<{ applied: boolean; resultCode: string }> {
  const capability = CONTROL_CAPABILITY[kind];
  const principal = await requireOperator(ctx, capability, args);
  const at = operatorNow(args.now);

  const entry: DynamicViewControlEntry = {
    worldId: args.worldId,
    kind,
    target: args.target ?? null,
    engaged: args.engaged,
    reason: args.reason,
    actor: principal.operatorId,
    createdAt: at,
  };
  assertDynamicViewControlEntry(entry);

  // Read the state BEFORE appending, so the audit row can say whether this changed anything.
  // A no-op is still recorded — an operator pressing "hide" on something already hidden is part
  // of the account of what happened, and a silent drop would leave a gap in it.
  const before = await effectiveDynamicViewControls(ctx, args.worldId);
  const wasEngaged = isEngaged(before, kind, entry.target);
  const outcome = wasEngaged === args.engaged ? 'no_op' : 'applied';

  await ctx.db.insert('dynamicViewControls', {
    worldId: entry.worldId,
    kind: entry.kind,
    ...(entry.target === null ? {} : { target: entry.target }),
    engaged: entry.engaged,
    reason: entry.reason,
    actor: entry.actor,
    createdAt: entry.createdAt,
  });

  await recordAudit(ctx, {
    principal,
    worldId: args.worldId,
    capability,
    target: entry.target ?? args.worldId,
    reason: args.reason,
    outcome,
    resultCode: outcome === 'applied' ? 'OPS_OK' : 'OPS_NO_OP',
    at,
  });

  return { applied: outcome === 'applied', resultCode: outcome === 'applied' ? 'OPS_OK' : 'OPS_NO_OP' };
}

function isEngaged(
  controls: EffectiveDynamicViewControls,
  kind: DynamicControlKind,
  target: string | null,
): boolean {
  switch (kind) {
    case 'pause_updates': return controls.updatesPaused;
    case 'pin_snapshot': return controls.snapshotPinned;
    case 'hide_character': return target !== null && controls.hiddenCharacterIds.has(target);
    case 'hide_scene': return target !== null && controls.hiddenSceneIds.has(target);
  }
}

/** AC#1 — pause or resume republishing of the public projection. Canon keeps running. */
export const setDynamicUpdatesPaused = mutation({
  args: controlArgs,
  handler: (ctx, args) => applyControl(ctx, 'pause_updates', args),
});

/** AC#2 — serve the last valid runtime snapshot instead of the live projection. */
export const setSnapshotPinned = mutation({
  args: controlArgs,
  handler: (ctx, args) => applyControl(ctx, 'pin_snapshot', args),
});

/** AC#3 — hide or restore one character's public visual. */
export const setCharacterVisualHidden = mutation({
  args: { ...controlArgs, characterId: v.string() },
  handler: (ctx, args) => applyControl(ctx, 'hide_character', { ...args, target: args.characterId }),
});

/** AC#3 — hide or restore one scene's public visual. */
export const setSceneVisualHidden = mutation({
  args: { ...controlArgs, sceneId: v.string() },
  handler: (ctx, args) => applyControl(ctx, 'hide_scene', { ...args, target: args.sceneId }),
});

/**
 * AC#5 — rebuild the public dynamic projection on demand.
 *
 * The one command here that touches the projection pipeline, and it is deliberately the least
 * powerful thing that satisfies the criterion: a READ of Canon as it already stands, followed
 * by a write to the read-model store. Exactly what the post-commit orchestrator does after
 * every accepted event, with no new authority over what Canon contains — which is why AC#6 and
 * AC#7 survive it.
 *
 * Rebuilding while updates are PAUSED is refused rather than silently performed. The pause is
 * an operator's statement that the public view should stop moving; honouring the rebuild would
 * move it, and doing that quietly is worse than refusing. Releasing the pause is one call away
 * and appears in the audit trail, which is where a decision to override another decision
 * belongs.
 */
export const rebuildDynamicProjection = mutation({
  args: { ...commandArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'dynamic.rebuild', args);
    const at = operatorNow(args.now);
    const controls = await effectiveDynamicViewControls(ctx, args.worldId);

    if (controls.updatesPaused) {
      await recordAudit(ctx, {
        principal, worldId: args.worldId, capability: 'dynamic.rebuild', target: args.worldId,
        reason: args.reason, outcome: 'refused', resultCode: 'DYNAMIC_UPDATES_PAUSED', at,
      });
      return { rebuilt: false, resultCode: 'DYNAMIC_UPDATES_PAUSED', modelRef: null };
    }

    const { modelRef } = await ctx.runMutation(rebuildLiveProjectionRef, {
      worldId: args.worldId,
      now: at,
    });
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'dynamic.rebuild', target: args.worldId,
      reason: args.reason, outcome: 'applied', resultCode: 'OPS_OK', at,
    });
    return { rebuilt: true, resultCode: 'OPS_OK', modelRef };
  },
});

/**
 * The controls currently in force, and every control ever applied.
 *
 * ## AC#4 is already delivered, and this does NOT re-deliver it
 *
 * "Operators can inspect binding and synchronization errors" is satisfied by ART-133's
 * `inspectDynamicViewMetrics` (`convex/operations/dynamicViewMetricsFunctions.ts`), which
 * already derives `missingCharacterBinding`, `missingLocationBinding` and
 * `canonRuntimeLocationMismatch` as `server_measured`, behind the same operator gate. Calling
 * it from here and re-exporting its output would give the console two places to read the same
 * numbers from, and the way that ends is one of them reporting a different figure for the same
 * world. Recorded as met-by-ART-133 rather than rebuilt.
 *
 * What this adds is the half ART-133 has no view of: which controls an operator has engaged,
 * and the history of who engaged them.
 *
 * A `query`, and `dynamic.inspect` is a `viewer` capability, so reading the state of the public
 * view does not require the authority to change it.
 */
export const inspectDynamicViewControls = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'dynamic.inspect', args);
    const controls = await effectiveDynamicViewControls(ctx, args.worldId);
    return {
      controls: {
        updatesPaused: controls.updatesPaused,
        snapshotPinned: controls.snapshotPinned,
        // Sorted, so two reads of an unchanged world return the same bytes and a console
        // diffing them does not report a change that did not happen.
        hiddenCharacterIds: [...controls.hiddenCharacterIds].sort(),
        hiddenSceneIds: [...controls.hiddenSceneIds].sort(),
      },
      /** Every control ever applied, newest first. The account, not just the current state. */
      history: (await loadControlEntries(ctx, args.worldId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((entry) => ({
          kind: entry.kind,
          target: entry.target,
          engaged: entry.engaged,
          reason: entry.reason,
          actor: entry.actor,
          createdAt: entry.createdAt,
        })),
    };
  },
});
