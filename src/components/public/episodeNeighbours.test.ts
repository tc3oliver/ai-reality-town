/**
 * 下一集 is offered only when there IS one (ART-189).
 *
 * `EpisodeDetail.tsx` computed both neighbours as `worldDay ± 1` and disabled only the previous
 * one, and only against `1`. On the newest Episode the next button was enabled, read
 * 「下一集(第 5 日)」, and landed on 「找不到此故事(可能尚未發布)。」 — a control that asserted
 * something about the world which its own destination immediately contradicted.
 *
 * The hole case below is the one arithmetic cannot get right at either end, and it is not
 * hypothetical: a day the safety gate withheld, or one the editorial pipeline has not reached, is
 * a published run with a gap in it.
 */

import { episodeNeighbours } from './episodeNeighbours';

/** Days 1, 2 and 5 published — 3 and 4 are holes. */
const PUBLISHED = [
  { worldDay: 1, episodeNumber: 1 },
  { worldDay: 2, episodeNumber: 2 },
  { worldDay: 5, episodeNumber: 3 },
];

describe('the end of the published run', () => {
  it('offers no next Episode on the newest one', () => {
    // The defect verbatim. Before this, day 5 offered 「下一集(第 6 日)」.
    expect(episodeNeighbours(5, PUBLISHED).next).toBeNull();
  });

  it('offers no previous Episode on the earliest one', () => {
    expect(episodeNeighbours(1, PUBLISHED).previous).toBeNull();
  });

  it('still offers the other direction at each end', () => {
    expect(episodeNeighbours(5, PUBLISHED).previous).toEqual({ worldDay: 2, episodeNumber: 2 });
    expect(episodeNeighbours(1, PUBLISHED).next).toEqual({ worldDay: 2, episodeNumber: 2 });
  });
});

describe('a gap in the middle of the run', () => {
  it('steps OVER an unpublished day rather than into it', () => {
    /**
     * From day 2, arithmetic offers day 3 — which is not published, so the button 404s in the
     * middle of the run rather than at its end. The nearest published day is the answer.
     */
    expect(episodeNeighbours(2, PUBLISHED).next).toEqual({ worldDay: 5, episodeNumber: 3 });
  });

  it('works from inside the gap, for a day reached by a hand-typed URL', () => {
    const { previous, next } = episodeNeighbours(3, PUBLISHED);
    expect(previous).toEqual({ worldDay: 2, episodeNumber: 2 });
    expect(next).toEqual({ worldDay: 5, episodeNumber: 3 });
  });

  it('is a function of the DAY, so the current Episode need not be in the list', () => {
    expect(episodeNeighbours(4, PUBLISHED).previous?.worldDay).toBe(2);
  });
});

describe('the numbers the controls print', () => {
  it('carries both the episode number and the world day', () => {
    /**
     * Both controls said 集 and then named a 日, while the header one line above says
     * 「第 N 集 · 世界日 M」 correctly. ART-184 established that conflating the two is what made
     * the home page's recommendation link surprising; this is the same conflation two lines from
     * where it was already fixed.
     */
    expect(episodeNeighbours(5, PUBLISHED).previous)
      .toEqual({ worldDay: 2, episodeNumber: 2 });
  });

  it('does not assume the episode number tracks the world day', () => {
    // Day 5 is episode 3, because two days published nothing. A control that derived one from the
    // other would be wrong by exactly the size of the gap.
    expect(episodeNeighbours(2, PUBLISHED).next?.episodeNumber).toBe(3);
  });
});

describe('before the index has been read', () => {
  it('offers neither control rather than guessing', () => {
    /**
     * The conservative direction. A control briefly absent while a read settles is a smaller
     * error than one offered and then 404ing, which is the defect this exists for.
     */
    expect(episodeNeighbours(3, undefined)).toEqual({ previous: null, next: null });
    expect(episodeNeighbours(3, null)).toEqual({ previous: null, next: null });
    expect(episodeNeighbours(3, [])).toEqual({ previous: null, next: null });
  });

  it('ignores an entry whose world day is not a usable number', () => {
    // A published payload is unvalidated JSON on the client.
    const ragged = [...PUBLISHED, { worldDay: Number.NaN, episodeNumber: 9 }];
    expect(episodeNeighbours(3, ragged).next).toEqual({ worldDay: 5, episodeNumber: 3 });
  });
});
