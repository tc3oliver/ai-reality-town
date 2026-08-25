/**
 * Operator controls for the public dynamic view (FR-Q002 / ART-134).
 *
 * ## Append-only, and derived — the same shape ART-132 chose, for the same reason
 *
 * Every control is a row appended to a ledger, and the EFFECTIVE state is derived by replaying
 * it (latest wins per control). Nothing is ever mutated in place.
 *
 * That is not tidiness. An operator control decides what the public can see, so the question
 * asked afterwards is never only "is it hidden now" — it is "who hid it, when, why, and what
 * did they un-hide". A mutable `hidden: boolean` answers the first and destroys the rest.
 * `safetyStatusOverrides` (FR-P004 / ART-132) reached this conclusion first and this follows
 * it deliberately rather than inventing a second shape for the same problem.
 *
 * ## What these controls cannot do (AC#6, AC#7)
 *
 * They govern the PROJECTION — the derived, republishable view of the world — and nothing else.
 * Canon is append-only and is corrected through FR-K005's correction workflow; hiding a
 * character's sprite does not edit an event, does not withdraw an accepted fact, and does not
 * compensate anything. The distinction is load-bearing rather than stylistic: an operator who
 * could quietly delete a Canon event through a visibility control would have a correction path
 * with no compensating record, which is precisely what the correction workflow exists to
 * prevent.
 *
 * That is enforced structurally, not by intention: this module is pure (no Convex import at
 * all), and `dynamicViewControls.boundary.test.ts` pins that neither it nor its Convex wiring
 * can reach a Canon write path or a correction function.
 *
 * ## Hiding is not safety withholding
 *
 * FR-P004's safety gate removes content a CLASSIFIER refused. This removes content an OPERATOR
 * chose to pull, for reasons the classifier has no opinion about — a binding that renders
 * wrongly, a scene mid-incident, a character whose sprite is being re-authored. Keeping them
 * separate means neither can be mistaken for the other in an audit, and un-hiding here cannot
 * un-withhold something safety refused.
 *
 * ## Why this lives in `shared`
 *
 * Two modules must agree on it. `operations` owns the COMMANDS (authorise, append, audit) and
 * `publicRead` must apply the result when it builds the projection — but
 * `architecture/module-boundaries.json` forbids `publicRead` from depending on `operations`,
 * and rightly: `operations` already depends on `publicRead`, so the reverse edge would be a
 * cycle.
 *
 * The alternative was for the projection builder to re-derive the effective state itself. That
 * is two implementations of "what is hidden", and the way two implementations of that diverge
 * is that something an operator hid stays on screen — silently, because the console would keep
 * reporting it as hidden. `shared` depends on nothing, so both sides import the SAME resolver
 * and the divergence is structurally impossible.
 *
 * Pure module: no Convex, no clock, no randomness. `now` is always a parameter.
 */

/** What an operator can do to the dynamic view. One per acceptance criterion. */
export const DYNAMIC_CONTROL_KINDS = [
  /** AC#1 — stop republishing the public projection. Canon keeps running. */
  'pause_updates',
  /** AC#2 — serve the last valid runtime snapshot instead of the live projection. */
  'pin_snapshot',
  /** AC#3 — remove one character's public visual. */
  'hide_character',
  /** AC#3 — remove one scene's public visual. */
  'hide_scene',
] as const;

export type DynamicControlKind = (typeof DYNAMIC_CONTROL_KINDS)[number];

/** Whether a control kind names a specific thing, or governs the whole world's view. */
export const TARGETED_CONTROL_KINDS: readonly DynamicControlKind[] = [
  'hide_character',
  'hide_scene',
];

export type DynamicViewControlEntry = {
  worldId: string;
  kind: DynamicControlKind;
  /** The character or scene id for a targeted control; `null` for a world-wide one. */
  target: string | null;
  /** `true` engages the control, `false` releases it. Both are appended, never overwritten. */
  engaged: boolean;
  reason: string;
  /** The operator identity, as `operatorAuditLog.operatorId` records it. */
  actor: string;
  createdAt: number;
};

export class DynamicViewControlError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'DynamicViewControlError';
  }
}

/**
 * The state the projection builder and the public read path act on.
 *
 * Sets rather than arrays, because every consumer asks "is this one hidden" and nothing asks
 * for the list in order.
 */
export type EffectiveDynamicViewControls = {
  /** AC#1. The projection is not republished while this holds. */
  updatesPaused: boolean;
  /** AC#2. The public read serves the last valid snapshot. */
  snapshotPinned: boolean;
  hiddenCharacterIds: ReadonlySet<string>;
  hiddenSceneIds: ReadonlySet<string>;
};

export const NO_DYNAMIC_VIEW_CONTROLS: EffectiveDynamicViewControls = {
  updatesPaused: false,
  snapshotPinned: false,
  hiddenCharacterIds: new Set(),
  hiddenSceneIds: new Set(),
};

/**
 * Validate one entry before it is written.
 *
 * A targeted control without a target, or a world-wide one with one, is refused rather than
 * normalised: both mean the caller believed something different from what the ledger would
 * record, and silently fixing it would put a row in the audit trail that does not describe what
 * anyone asked for.
 */
export function assertDynamicViewControlEntry(entry: DynamicViewControlEntry): void {
  if (entry.worldId.trim().length === 0) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', 'worldId must be non-empty');
  }
  if (!(DYNAMIC_CONTROL_KINDS as readonly string[]).includes(entry.kind)) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', `unknown kind: ${entry.kind}`);
  }
  // NFR-005: a privileged action states why. Enforced here as well as at the console gate, so
  // a second caller cannot append an unreasoned row.
  if (entry.reason.trim().length === 0) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', 'reason must be non-empty');
  }
  if (entry.actor.trim().length === 0) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', 'actor must be non-empty');
  }
  if (!Number.isFinite(entry.createdAt) || entry.createdAt < 0) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', 'createdAt must be a finite, non-negative number');
  }

  const targeted = TARGETED_CONTROL_KINDS.includes(entry.kind);
  if (targeted && (entry.target === null || entry.target.trim().length === 0)) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', `${entry.kind} requires a target`);
  }
  if (!targeted && entry.target !== null) {
    throw new DynamicViewControlError('DYNAMIC_CONTROL_INVALID', `${entry.kind} takes no target`);
  }
}

/**
 * Replay the ledger into the effective state.
 *
 * Latest wins per `(kind, target)`, ordered by `createdAt` with the array order breaking ties —
 * two rows written in the same millisecond are ordered by the sequence the store returned,
 * which for an append-only table is the order they were appended. Sorting is stable, so this is
 * deterministic rather than merely usually right.
 *
 * A RELEASE is a row like any other, so "hidden then un-hidden" resolves to visible and the
 * ledger still shows both. Deleting the engage row instead would leave no record that anything
 * was ever hidden.
 */
export function resolveDynamicViewControls(
  entries: readonly DynamicViewControlEntry[],
): EffectiveDynamicViewControls {
  const latest = new Map<string, DynamicViewControlEntry>();
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  for (const entry of ordered) {
    latest.set(`${entry.kind}:${entry.target ?? ''}`, entry);
  }

  const hiddenCharacterIds = new Set<string>();
  const hiddenSceneIds = new Set<string>();
  let updatesPaused = false;
  let snapshotPinned = false;

  for (const entry of latest.values()) {
    if (!entry.engaged) continue;
    switch (entry.kind) {
      case 'pause_updates': updatesPaused = true; break;
      case 'pin_snapshot': snapshotPinned = true; break;
      case 'hide_character': if (entry.target !== null) hiddenCharacterIds.add(entry.target); break;
      case 'hide_scene': if (entry.target !== null) hiddenSceneIds.add(entry.target); break;
    }
  }

  return { updatesPaused, snapshotPinned, hiddenCharacterIds, hiddenSceneIds };
}

/**
 * A published projection with the hidden things removed (AC#3).
 *
 * ## Why this runs at BUILD time, not at read time
 *
 * A read-time filter would leave the hidden character in the stored payload, and FR-O010's
 * last-known-good fallback would keep serving it the moment the current version could not be
 * read — the hidden thing would come back, from the mechanism designed to keep the page alive.
 * FR-P004's safety gate is applied at build time for exactly this reason, and this follows it.
 *
 * ## A hidden character is REMOVED, not blanked
 *
 * The opposite of FR-P004's choice for scenes, and deliberately. A withheld scene becomes a
 * placeholder because the map's job is to show where the world is, and a character standing at
 * a location whose scene has vanished is a bigger lie than 「內容審核中」. A hidden CHARACTER is
 * different: there is no honest placeholder for a person's position, and drawing a marker that
 * says "someone is here but we will not say who" tells a viewer more than hiding does.
 *
 * A hidden SCENE is removed entirely rather than placeheld, because unlike a safety withhold
 * this is not a statement that the content was reviewed and refused — it is an operator taking
 * the visual down, and a placeholder would imply a judgement nobody made.
 */
export function applyDynamicViewControls<
  TProjection extends {
    characters: Array<{ characterId: string }>;
    activeScenes: Array<{ sceneId?: string; participantCharacterIds?: string[] }>;
  },
>(projection: TProjection, controls: EffectiveDynamicViewControls): TProjection {
  if (controls.hiddenCharacterIds.size === 0 && controls.hiddenSceneIds.size === 0) {
    // Identity when nothing is hidden, so the overwhelmingly common path allocates nothing and
    // the content hash the read-model store dedupes on is unchanged.
    return projection;
  }

  return {
    ...projection,
    characters: projection.characters.filter(
      (character) => !controls.hiddenCharacterIds.has(character.characterId),
    ),
    activeScenes: projection.activeScenes
      .filter((scene) => scene.sceneId === undefined || !controls.hiddenSceneIds.has(scene.sceneId))
      .map((scene) =>
        scene.participantCharacterIds === undefined
          ? scene
          : {
              ...scene,
              // A hidden character is removed from the participant lists too. Leaving them
              // there would publish "this person is in that scene" for someone the operator
              // just took off the map — the id is the thing being hidden, and it would still
              // be on screen in the scene panel.
              participantCharacterIds: scene.participantCharacterIds.filter(
                (id) => !controls.hiddenCharacterIds.has(id),
              ),
            }),
  };
}

/** A stored `dynamicViewControls` row, as either side reads it back. */
export type DynamicViewControlRow = {
  worldId: string;
  kind: string;
  target?: string;
  engaged: boolean;
  reason: string;
  actor: string;
  createdAt: number;
};

/**
 * Rows to entries, then to effective state, in one call.
 *
 * Both the operator console and the projection builder go through this, so the `target ?? null`
 * normalisation and the replay happen once. Splitting the mapping from the resolution is how
 * two readers end up agreeing on the resolver and disagreeing on the rows.
 */
export function resolveDynamicViewControlRows(
  rows: readonly DynamicViewControlRow[],
): EffectiveDynamicViewControls {
  return resolveDynamicViewControls(
    rows
      .filter((row): row is DynamicViewControlRow & { kind: DynamicControlKind } =>
        (DYNAMIC_CONTROL_KINDS as readonly string[]).includes(row.kind))
      .map((row) => ({
        worldId: row.worldId,
        kind: row.kind,
        target: row.target ?? null,
        engaged: row.engaged,
        reason: row.reason,
        actor: row.actor,
        createdAt: row.createdAt,
      })),
  );
}
