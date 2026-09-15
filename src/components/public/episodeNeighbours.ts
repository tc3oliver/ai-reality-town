/**
 * Which Episode comes before and after this one (ART-189).
 *
 * `EpisodeDetail.tsx` computed both by arithmetic — `worldDay - 1` and `worldDay + 1` — and
 * disabled only the first, and only against `1`. On the newest Episode the 下一集 button was
 * therefore enabled, read 「下一集(第 5 日)」, and landed on
 * 「找不到此故事(可能尚未發布)。」 A viewer at the end of the published run was told there was
 * more and then told it did not exist.
 *
 * The asymmetry was not a decision anyone stated. It is what you get from bounding one end of a
 * range and forgetting the other, and arithmetic cannot bound either end correctly anyway: a world
 * day with no published Episode — a day the safety gate withheld, or one the editorial pipeline has
 * not reached — is a hole in the middle of the run, and `worldDay + 1` walks straight into it.
 *
 * ## Neighbours by publication, not by counting
 *
 * The published index `episodes:<worldId>` lists every Episode that EXISTS, so the neighbour is the
 * nearest published day in each direction rather than the adjacent integer. That answers the hole
 * case for free: from day 3, with day 4 unpublished and day 5 published, 下一集 goes to day 5.
 *
 * ## Naming both numbers
 *
 * Both controls said 集 and then named a 日, while the header one line above says
 * 「第 N 集 · 世界日 M」 correctly. ART-184 established that conflating the two is what made the
 * home page's recommendation link surprising; this is the same conflation two lines from where it
 * was already fixed. A neighbour therefore carries BOTH numbers and the component prints both.
 *
 * Pure: no React, no Convex, no DOM, no clock.
 */

/** One published Episode, as far as choosing a neighbour needs it. */
export type EpisodeNeighbourSource = { worldDay: number; episodeNumber: number };

export type EpisodeNeighbour = { worldDay: number; episodeNumber: number };

export type EpisodeNeighbours = {
  /** The nearest published Episode before this day, or `null` when this is the first. */
  previous: EpisodeNeighbour | null;
  /** The nearest published Episode after this day, or `null` when this is the newest. */
  next: EpisodeNeighbour | null;
};

/**
 * The neighbours of `worldDay` among `episodes`.
 *
 * Both are `null` when the index has not been read yet, which the caller renders as "not offered"
 * rather than as "does not exist". That is the conservative direction: a control that is briefly
 * absent while a read settles is a smaller error than one that is offered and then 404s, which is
 * the defect this module exists for.
 *
 * The current day need not itself be published. An Episode reached by a hand-typed URL still gets
 * correct neighbours, which is what makes this a function of the day rather than of a list index.
 */
export function episodeNeighbours(
  worldDay: number,
  episodes: readonly EpisodeNeighbourSource[] | null | undefined,
): EpisodeNeighbours {
  const published = (episodes ?? []).filter((episode) => Number.isSafeInteger(episode.worldDay));
  let previous: EpisodeNeighbour | null = null;
  let next: EpisodeNeighbour | null = null;
  for (const episode of published) {
    if (episode.worldDay < worldDay && (previous === null || episode.worldDay > previous.worldDay)) {
      previous = { worldDay: episode.worldDay, episodeNumber: episode.episodeNumber };
    }
    if (episode.worldDay > worldDay && (next === null || episode.worldDay < next.worldDay)) {
      next = { worldDay: episode.worldDay, episodeNumber: episode.episodeNumber };
    }
  }
  return { previous, next };
}
