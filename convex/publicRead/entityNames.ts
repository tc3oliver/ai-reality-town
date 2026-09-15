/**
 * Substituting entity ids for display names in already-public text (ART-183).
 *
 * The live pages rendered `he-jun`, `zhao-ming` and `mistwood-mill` to readers, inside otherwise
 * finished prose: 「At mistwood-mill, he-jun and zhao-ming meet over: …」. Those ids are not a
 * formatting slip in one component — they are IN the published text, because every author writes
 * them there on purpose. `fakeSceneNarrator.ts` states the reason plainly: entity ids are the
 * scene's actual references, and substituting display names in the author would put a second
 * naming scheme in a layer no other layer shares.
 *
 * That reasoning is right, and it names the layer where substitution DOES belong: the last one
 * before a viewer. Doing it here rather than in each template also covers the text no template
 * controls — a model that writes an id into a sentence is caught by the same pass that catches a
 * hardcoded one.
 *
 * ## Why this is a plain replacement and not a parser
 *
 * Ids are kebab-case and globally unique within a world, so an occurrence is unambiguous. The two
 * ways a naive replacement goes wrong are both handled:
 *
 * - **Prefix collisions.** `mistwood-mill` and `mistwood-mill-annex` would let the shorter id eat
 *   the longer one's prefix. Ids are matched longest-first, in a single pass, so the longest
 *   candidate at a position wins.
 * - **Partial matches inside a longer token.** `he-jun` must not match inside `he-junior` or
 *   inside the id `mistwood-he-jun`. A match is required to be bounded by something that is not
 *   an id character on both sides.
 *
 * Pure: no clock, no randomness, no I/O.
 */

/** Characters that may appear in an entity id. A match bounded by one of these is not a match. */
const ID_CHARACTER = /[A-Za-z0-9_-]/;

function isBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  return !ID_CHARACTER.test(text[index]);
}

/**
 * Replace every whole-token occurrence of a known entity id with its display name.
 *
 * Returns `text` unchanged when there is nothing to do, which is the common case for CJK prose
 * that names nobody. An id with no name in the map is left alone rather than blanked: showing the
 * id is bad, and silently deleting the only reference to who a sentence is about is worse.
 */
export function renderEntityNames(text: string, names: ReadonlyMap<string, string>): string {
  if (text.length === 0 || names.size === 0) return text;
  // Longest first, so a prefix id cannot claim a position a longer id also matches.
  const ids = [...names.keys()].filter((id) => id.length > 0).sort((a, b) => b.length - a.length);
  let out = '';
  let index = 0;
  while (index < text.length) {
    const matched = ids.find((id) =>
      text.startsWith(id, index)
      && isBoundary(text, index - 1)
      && isBoundary(text, index + id.length));
    if (matched === undefined) {
      out += text[index];
      index += 1;
      continue;
    }
    out += names.get(matched) as string;
    index += matched.length;
  }
  return out;
}

/**
 * Build the substitution map, dropping entries that would make the text worse.
 *
 * An entry is kept only when the name is non-empty and DIFFERENT from the id. A record whose name
 * field was never filled in carries `name === id` — substituting it is a no-op that costs a scan,
 * and keeping it in the map hides, from any test that counts substitutions, that the record has no
 * real name at all.
 */
export function entityNameMap(
  entries: Iterable<{ id: string; name: string | null | undefined }>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const { id, name } of entries) {
    if (typeof name !== 'string') continue;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === id) continue;
    map.set(id, trimmed);
  }
  return map;
}
