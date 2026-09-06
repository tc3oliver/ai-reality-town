/**
 * The Live surface's incremental fold state (ART-100, Slice 6).
 *
 * ## What this is for
 *
 * `rebuildLiveProjection` reads the WHOLE accepted-event log on every accepted event — the last
 * remaining O(total canon) read in the post-commit pipeline, and the largest single term in the
 * AC#1 measurement. Five separate consumers inside that handler need those events, so bounding any
 * one of them alone changes nothing: the collect stays until all five are bounded. This module is
 * the piece two of them need.
 *
 * Both of those consumers — `buildLiveProjection`'s location/character maps and
 * `excludedCharacterIds` — are **last-write-wins folds over the event sequence**. They have no
 * retroactive dependency: appending an event applies its own state changes and nothing else, so
 * `fold(events) === fold(fold(prefix), suffix)`. That is the same algebraic property
 * `replayWorldEvents` has and that `reducer.purity.test.ts` pins for Canon, and it is what makes a
 * checkpoint sound here.
 *
 * ## Why not resume from the Canon snapshot
 *
 * Because `locations` is one of `SEED_BASELINE_FIELDS`. A stored `CanonSnapshot` is
 * `replayWorldEvents(SEEDED_BASELINE, events)`, so its `locations` carries the world's imported
 * seed locations — which today's `buildLiveProjection` never publishes, because it folds from
 * empty over `location_state_changed` alone. Resuming the Live fold from a Canon snapshot would
 * silently add seed locations to a published payload, breaking AC#3. This state is therefore
 * folded from EMPTY and kept separately. That is the one part of the earlier
 * "structurally blocked" note on `liveStateFunctions.ts` that survives scrutiny.
 *
 * Subtracting the seed from a Canon snapshot instead was considered and rejected: an event may set
 * a location to a value equal to its seed value, so "differs from the initial snapshot" cannot
 * distinguish "never touched" from "touched back to the same value", and the ambiguity resolves
 * the wrong way — dropping a location an event really did write.
 *
 * ## One implementation, not two
 *
 * `buildLiveProjection` and `excludedCharacterIds` each used to walk the events themselves, with
 * overlapping but NOT identical rules (`aliveByCharacter` tracks only `character_life_changed`;
 * the exclusion set tracks that AND `character_state_changed` on `active`, and unlike the former
 * it type-checks `alive` before believing it). Both now derive from this single fold, so a
 * checkpoint cannot come to disagree with a replay about what the state was — which is the failure
 * mode a second implementation would eventually produce, silently, in published output.
 */

/**
 * A location as the Live surface publishes one.
 *
 * DECLARED HERE, not imported from `liveState.ts`, and re-exported from there for the callers that
 * already name it. This module must import NOTHING: it sits under both `liveState.ts` and
 * `publicDynamicProjection.ts`, and an import back up would be a cycle. It would also be a real
 * boundary violation rather than a stylistic one — `liveState.ts` reaches `canon/model.ts`, and
 * `ambientMotion.boundary.test.ts` forbids the ambient client's closure from reaching `convex/canon/`
 * even in TYPE position. Writing the back-edge broke that pin immediately, which is what it is for.
 */
export type LiveLocation = {
  locationId: string; name: string; description: string; locationType: string; active: boolean;
};

/** The minimum an event must expose to be folded. Structural, so both `AcceptedEvent` and
 * `AcceptedEventLike` satisfy it without either module depending on the other. */
export type LiveFoldEvent = {
  readonly sequenceNumber: number;
  readonly stateChanges: readonly { readonly type: string }[];
};

export type LiveFoldState = {
  /** Every location an event has described, last description wins. Never seeded. */
  readonly locations: ReadonlyMap<string, LiveLocation>;
  /** Where each character last moved to. */
  readonly positionByCharacter: ReadonlyMap<string, string>;
  /** Explicit `character_life_changed` verdicts only; absent means "not stated", not "dead". */
  readonly aliveByCharacter: ReadonlyMap<string, boolean>;
  /** Characters an event has ever placed or given a life verdict to. */
  readonly knownCharacters: ReadonlySet<string>;
  /** Characters the map must not draw (FR-Q002): dead, or `active` set false. */
  readonly excludedCharacterIds: ReadonlySet<string>;
  /** The highest sequence number folded in, or -1 for the empty state. */
  readonly lastSequenceNumber: number;
};

export function emptyLiveFold(): LiveFoldState {
  return {
    locations: new Map(),
    positionByCharacter: new Map(),
    aliveByCharacter: new Map(),
    knownCharacters: new Set(),
    excludedCharacterIds: new Set(),
    lastSequenceNumber: -1,
  };
}

/** A non-empty string, or `null`. Every id below goes through this, so a malformed change
 * cannot enter the state under an empty or non-string key. */
function idOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Fold `events` onto `prior`. Pure, and order-independent of the caller: events are sorted by
 * sequence number here rather than trusted to arrive that way, because last-write-wins is only
 * well defined against a known order and both former call sites sorted first.
 *
 * Applying a prefix and then a suffix must equal applying the whole — the property that lets a
 * stored checkpoint stand in for the events it covers. Pinned in `liveFold.test.ts`.
 */
export function foldLiveEvents(
  prior: LiveFoldState,
  events: readonly LiveFoldEvent[],
): LiveFoldState {
  const locations = new Map(prior.locations);
  const positionByCharacter = new Map(prior.positionByCharacter);
  const aliveByCharacter = new Map(prior.aliveByCharacter);
  const knownCharacters = new Set(prior.knownCharacters);
  const excludedCharacterIds = new Set(prior.excludedCharacterIds);
  let lastSequenceNumber = prior.lastSequenceNumber;

  const ordered = [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  for (const event of ordered) {
    lastSequenceNumber = Math.max(lastSequenceNumber, event.sequenceNumber);
    for (const change of event.stateChanges) {
      const record = change as {
        type: string; characterId?: unknown; toLocationId?: unknown; alive?: unknown;
        field?: unknown; toValue?: unknown; locationId?: unknown;
        name?: unknown; description?: unknown; locationType?: unknown; active?: unknown;
      };

      if (record.type === 'location_state_changed') {
        const locationId = idOf(record.locationId);
        if (locationId !== null) {
          locations.set(locationId, {
            locationId,
            name: record.name as string,
            description: record.description as string,
            locationType: record.locationType as string,
            active: record.active as boolean,
          });
        }
        continue;
      }

      const characterId = idOf(record.characterId);
      if (characterId === null) continue;

      if (record.type === 'character_location_changed') {
        knownCharacters.add(characterId);
        positionByCharacter.set(characterId, record.toLocationId as string);
      } else if (record.type === 'character_life_changed') {
        knownCharacters.add(characterId);
        aliveByCharacter.set(characterId, record.alive as boolean);
        // Deliberately stricter than the line above: the exclusion set drives what a viewer
        // SEES, so an unparseable `alive` leaves the previous verdict standing rather than
        // hiding a character on the strength of a malformed change. Preserved verbatim from
        // `excludedCharacterIds`, which is the behaviour currently in production.
        if (typeof record.alive === 'boolean') {
          if (record.alive) excludedCharacterIds.delete(characterId);
          else excludedCharacterIds.add(characterId);
        }
      } else if (record.type === 'character_state_changed' && record.field === 'active') {
        // Note: NOT added to `knownCharacters`. An `active` flag alone never introduced a
        // character to the Live projection and must not start doing so here.
        if (record.toValue === true) excludedCharacterIds.delete(characterId);
        else if (record.toValue === false) excludedCharacterIds.add(characterId);
      }
    }
  }

  return {
    locations, positionByCharacter, aliveByCharacter,
    knownCharacters, excludedCharacterIds, lastSequenceNumber,
  };
}
