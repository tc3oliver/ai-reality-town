/**
 * What to call a character, a location and an arc on a public surface (ART-186).
 *
 * ART-183 fixed the ids that were embedded IN published prose, at the public read boundary, and
 * `convex/publicRead/entityNames.ts` records why that is the right layer for text. This module is
 * about the other half: the places where a component holds an id ARRAY and prints it. No amount of
 * substitution inside a sentence reaches 「與 zhao-ming 交談中」, because that sentence is built in
 * the browser out of a field named `conversationPartnerIds`.
 *
 * ## One table, because the surfaces have to agree
 *
 * The live map's camera chrome, its static floor plan, its character card, its scene panel and the
 * text live view all name the same twelve residents. Before this module each resolved names its own
 * way or not at all, which is how `src/components/world/cameraModel.ts` came to label every focus
 * button `label: motion.characterId` while the card beside it showed a real name. A shared table
 * makes disagreement impossible rather than merely discouraged.
 *
 * It lives under `components/public/` because both `clientPublic` and `clientLive` need it and
 * `architecture/module-boundaries.json` lets `clientLive` depend on `clientPublic`, never the
 * reverse. `components/world/` may not reach it at all, which is why `focusTargetsFrom` takes the
 * character table as a PARAMETER instead of importing one.
 *
 * ## Why a location has two sources and the other two have one
 *
 * `convex/publicRead/liveFold.ts` folds locations from EMPTY over `location_state_changed` alone —
 * its own comment says "Never seeded" — so a Mistwood location that no event has ever described is
 * absent from the published payload. That is deliberate: ART-100 AC#3 requires the incremental fold
 * to stay byte-identical to a full replay, and CLAUDE.md §9 records that `convex/publicRead` replays
 * from empty to keep seed data out of public read models. Both still hold, and neither is changed
 * here.
 *
 * What that leaves is a text surface claiming not to know something the graphical surface is
 * drawing. The animated map places everyone against `mistwoodLocationFootprints`, which ships in the
 * client bundle and is already on screen; the text view rendered 「未知位置」 for the same character
 * at the same moment. The footprints are therefore the second source, and specifically the SECOND
 * one: a location an event has described has been re-described by Canon, and that description wins
 * over the authored default.
 *
 * ## The fallback is the id, and that is a decision
 *
 * An unresolvable id renders as itself. Blanking it would delete the only reference to who or where
 * a row is about, and inventing a placeholder would state something no source said. It is also the
 * behaviour every one of these surfaces had before this task, so a name that fails to resolve
 * degrades to the old output for one row rather than failing the page. {@link named} is the only
 * way to read a table, so that rule is written once.
 *
 * Pure: no React, no Convex, no DOM, no clock, no randomness.
 */

/** The published `liveState` fields this module reads, each optional because an old payload's is. */
export type WorldNameSources = {
  characters?: readonly { characterId: string; displayName?: string | null }[] | null;
  locations?: readonly { locationId: string; name?: string | null }[] | null;
  activeArcs?: readonly { arcId: string; title?: string | null }[] | null;
  /**
   * Authored map footprints, as `data/mistwood.ts` publishes them. Passed in rather than imported
   * so this module carries no world data and a test can name a place without loading the map.
   */
  footprints?: readonly { readonly id: string; readonly name: string }[] | null;
};

export type WorldNames = {
  readonly characters: ReadonlyMap<string, string>;
  readonly locations: ReadonlyMap<string, string>;
  readonly arcs: ReadonlyMap<string, string>;
};

/** Nothing resolvable. Every lookup falls through to the id, which is the pre-ART-186 behaviour. */
export const EMPTY_WORLD_NAMES: WorldNames = {
  characters: new Map(),
  locations: new Map(),
  arcs: new Map(),
};

/**
 * Add an entry unless it would be a no-op or a blank.
 *
 * A record whose name field was never filled in carries `name === id`. Keeping it would cost a
 * lookup to return the id anyway, and — the reason that matters — it would hide from any test that
 * counts resolved names that the record has no real name at all. The same rule as
 * `entityNameMap` in `convex/publicRead/entityNames.ts`, for the same reason.
 */
function put(into: Map<string, string>, id: string, name: string | null | undefined): void {
  if (id.length === 0 || typeof name !== 'string') return;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed === id) return;
  into.set(id, trimmed);
}

/** Build the three tables from whatever the caller has read. */
export function composeWorldNames(sources: WorldNameSources): WorldNames {
  const characters = new Map<string, string>();
  for (const character of sources.characters ?? []) {
    put(characters, character.characterId, character.displayName);
  }

  const locations = new Map<string, string>();
  // Authored first, published second, so a location Canon has re-described overwrites its default.
  for (const footprint of sources.footprints ?? []) put(locations, footprint.id, footprint.name);
  for (const location of sources.locations ?? []) put(locations, location.locationId, location.name);

  const arcs = new Map<string, string>();
  for (const arc of sources.activeArcs ?? []) put(arcs, arc.arcId, arc.title);

  return { characters, locations, arcs };
}

/** A table lookup, with the id as the documented fallback. The only way to read one. */
export function named(names: ReadonlyMap<string, string>, id: string): string {
  return names.get(id) ?? id;
}

/**
 * A list of ids as a Chinese-punctuated list of names.
 *
 * `、` rather than a comma-space, for the reason `formatNameList` in
 * `convex/shared/publicLabels.ts` gives: a comma-space list reads as English even when the names do
 * not. Empty ids are dropped; an unresolved one still appears, as itself.
 */
export function namedList(names: ReadonlyMap<string, string>, ids: readonly string[]): string {
  return ids.filter((id) => id.trim().length > 0).map((id) => named(names, id)).join('、');
}
