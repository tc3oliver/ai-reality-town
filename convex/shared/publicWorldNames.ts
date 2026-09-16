/**
 * What a world is CALLED on a public surface (ART-190).
 *
 * The product decision, recorded here because this module is the only place it is applied:
 *
 * - `mistwood` stays the internal `worldId`. Routes, read-model refs, Canon and every stored
 *   identifier are untouched.
 * - `Mistwood` stays the canonical English world name in `convex/canon/mistwoodSeed.ts`. Canon is
 *   not migrated and the seed is not translated.
 * - `霧林鎮` is the public display name, and a zh-Hant viewer sees nothing else. The two must never
 *   appear on the same surface — which is what the codebase did: the home page's `h1` rendered the
 *   seed's 「Mistwood」 from the published world projection while the section heading directly
 *   beneath it was a hardcoded 「現在的霧林鎮」, and the watch guide opened 「Mistwood 是一個持續運作
 *   的 AI 世界」.
 *
 * There were in fact THREE names in the tree, which is the strongest argument for resolving this in
 * one place: `homeRoute.test.ts` called the town 「迷霧鎮」. That is why the registered name wins
 * over whatever a projection carries, rather than merely filling in when one is absent — a second
 * source that disagrees is the failure mode, not an absent one.
 *
 * ## One boundary, not a constant sprinkled through the pages
 *
 * Every public surface resolves the name through {@link worldDisplayName}, and nothing else in the
 * client or the read models writes 「霧林鎮」 at all. The two hardcoded occurrences are gone; a test
 * scans for their return.
 *
 * The same shape ART-191 used for a resident's name, and for the same reason: the projection is the
 * single public source of what something is called, so resolving it there means the home page, the
 * watch guide, the primer and every future surface agree without each having to remember.
 *
 * ## Why `shared`, and why the id is declared rather than imported
 *
 * Both sides of the wire need this — `publicRead` builds the projection, `clientPublic` renders a
 * page that reads no projection at all — and `shared` is the only module both may depend on.
 * `shared` may depend on nothing (`architecture/module-boundaries.json`), so the world id is a
 * hand-copy of `MISTWOOD_PUBLIC_WORLD_ID`, checked rather than trusted: `publicWorldNames.test.ts`
 * imports the canon constant and asserts the registry is keyed by it.
 *
 * Pure: no clock, no randomness, no I/O, and no imports.
 */

/**
 * Public display name by internal world id.
 *
 * A world absent from this table is NOT a bug — it falls through to its canonical name, which is
 * what an unregistered world should show. Adding a world here is how it gets a localized name.
 */
const PUBLIC_WORLD_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  mistwood: '霧林鎮',
};

/**
 * What to call a world with no name from any source.
 *
 * Exported so the home page and the watch guide share it rather than each keeping a copy — the
 * home page had a private `PLACEHOLDER_WORLD_NAME` before this task. It is reached only when a
 * world is unregistered AND its projection has not been read, or when no world is in scope at all
 * (`#help` with no world id).
 */
export const PUBLIC_WORLD_PLACEHOLDER_NAME = '這個世界';

/**
 * The name a viewer should read for `worldId`, or `null` when nothing names it.
 *
 * Three steps, in order:
 *
 * 1. The registered display name. This wins over the canonical name ON PURPOSE — that is the whole
 *    policy, and it is why the home page no longer needs the projection to have loaded before it
 *    can head itself correctly.
 * 2. The canonical name the caller passed, when it is a non-empty string. An unregistered world
 *    keeps whatever Canon calls it rather than being renamed to a placeholder.
 * 3. `null`. The caller decides, and {@link PUBLIC_WORLD_PLACEHOLDER_NAME} is what both public
 *    callers decide.
 *
 * `null` rather than a default is deliberate: a blank world name and 「這個世界」 are different
 * claims, and only the caller knows whether it is still waiting for a read.
 */
export function worldDisplayName(
  worldId: string | null | undefined,
  canonicalName?: string | null,
): string | null {
  if (typeof worldId === 'string') {
    const registered = PUBLIC_WORLD_DISPLAY_NAMES[worldId];
    if (registered !== undefined) return registered;
  }
  if (typeof canonicalName === 'string' && canonicalName.trim().length > 0) {
    return canonicalName.trim();
  }
  return null;
}

/** Every world id this module localizes. Exported for the canon cross-check test. */
export const LOCALIZED_PUBLIC_WORLD_IDS: readonly string[] = Object.keys(PUBLIC_WORLD_DISPLAY_NAMES);
