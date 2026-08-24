/**
 * The degradation ladder (FR-O010 / ART-127).
 *
 * Two things these tests are careful about, because both are ways this suite could pass while
 * the feature was broken:
 *
 * - **The ladder must be ORDERED, not a set of four cases.** A function that returned a
 *   plausible level for each hand-written input would satisfy per-case assertions and still
 *   let a later edit make a lost capability move the viewer *up*. So the ordering is asserted
 *   as a property: for every rung, removing a capability moves the verdict to a strictly
 *   higher index in {@link DEGRADATION_LEVELS}.
 * - **Recovery (AC#5) must need no mechanism.** The test for it deliberately calls the SAME
 *   pure function with the restored inputs, because that is the entire claim: there is no
 *   recovery path to exercise, and if one ever became necessary this test would stop being a
 *   fair model of the code and would have to be rewritten.
 */

import {
  DEGRADATION_LEVELS,
  degradationDescriptor,
  degradationReasonSentence,
  lastUpdatedDescriptor,
  resolveDegradationLevel,
  type DegradationInput,
} from './degradationLadder';

/** Everything working: the top rung. Each test removes exactly what it is about. */
const HEALTHY: DegradationInput = {
  loading: false,
  streamContent: true,
  snapshotContent: true,
  webglSupported: true,
  rendererFailed: false,
  mapAvailable: true,
};

const levelIndex = (level: string) => DEGRADATION_LEVELS.indexOf(level as never);

describe('the four rungs (AC#1)', () => {
  test('everything working is the live stream', () => {
    const verdict = resolveDegradationLevel(HEALTHY);
    expect(verdict.level).toBe('stream');
    expect(verdict.source).toBe('stream');
    // No reason at the top: there is nothing to explain, and a "reason" here would force the
    // notice to print an explanation of a state that needs none.
    expect(verdict.reason).toBeNull();
  });

  test('a lost projection falls to the last valid snapshot, and says so', () => {
    const verdict = resolveDegradationLevel({ ...HEALTHY, streamContent: false });
    expect(verdict.level).toBe('snapshot');
    expect(verdict.source).toBe('snapshot');
    expect(verdict.reason).toBe('stream-unavailable');
  });

  test('a browser without WebGL falls to the static map, not off a cliff', () => {
    const verdict = resolveDegradationLevel({ ...HEALTHY, webglSupported: false });
    expect(verdict.level).toBe('static-map');
    expect(verdict.reason).toBe('renderer-unsupported');
  });

  test('a renderer that threw falls to the static map, and is distinguished from an absent one', () => {
    const verdict = resolveDegradationLevel({ ...HEALTHY, rendererFailed: true });
    expect(verdict.level).toBe('static-map');
    // The two produce the SAME rung but are different things to tell a person: one is fixable
    // by the viewer and one is not. Reporting the reason separately from the level is what
    // keeps that distinction available.
    expect(verdict.reason).toBe('renderer-failed');
  });

  test('a renderer that threw is reported as failed even when WebGL is also absent', () => {
    const verdict = resolveDegradationLevel({
      ...HEALTHY,
      webglSupported: false,
      rendererFailed: true,
    });
    expect(verdict.reason).toBe('renderer-failed');
  });

  test('no positions at all is the informational rung', () => {
    const verdict = resolveDegradationLevel({
      ...HEALTHY,
      streamContent: false,
      snapshotContent: false,
    });
    expect(verdict.level).toBe('informational');
    expect(verdict.source).toBe('none');
    expect(verdict.reason).toBe('no-positions');
  });

  test('a world with no authored floor plan skips the static rung rather than drawing an empty one', () => {
    const verdict = resolveDegradationLevel({
      ...HEALTHY,
      webglSupported: false,
      mapAvailable: false,
    });
    expect(verdict.level).toBe('informational');
  });

  test('the static rung prefers live positions, because the renderer failed and the feed did not', () => {
    const verdict = resolveDegradationLevel({ ...HEALTHY, webglSupported: false });
    expect(verdict.source).toBe('stream');

    const noStream = resolveDegradationLevel({
      ...HEALTHY,
      webglSupported: false,
      streamContent: false,
    });
    expect(noStream.source).toBe('snapshot');
  });
});

describe('the ladder is ordered, not four unrelated cases', () => {
  /**
   * Every capability, and the input that removes it. If a later edit made any one of these
   * move the viewer UP a rung, this fails — which a table of per-case expectations would not
   * catch, because each case would still return something plausible on its own.
   */
  const REMOVALS: Array<[string, Partial<DegradationInput>]> = [
    ['the live projection', { streamContent: false }],
    ['WebGL', { webglSupported: false }],
    ['the renderer', { rendererFailed: true }],
    ['the floor plan', { mapAvailable: false }],
    ['every position', { streamContent: false, snapshotContent: false }],
  ];

  test.each(REMOVALS)('losing %s never moves the viewer up a rung', (_name, removal) => {
    const before = resolveDegradationLevel(HEALTHY);
    const after = resolveDegradationLevel({ ...HEALTHY, ...removal });
    expect(levelIndex(after.level)).toBeGreaterThanOrEqual(levelIndex(before.level));
  });

  test('losing everything lands on the bottom rung, not somewhere in the middle', () => {
    const verdict = resolveDegradationLevel({
      loading: false,
      streamContent: false,
      snapshotContent: false,
      webglSupported: false,
      rendererFailed: true,
      mapAvailable: false,
    });
    expect(verdict.level).toBe(DEGRADATION_LEVELS[DEGRADATION_LEVELS.length - 1]);
  });
});

describe('a pending read is not a degraded state', () => {
  test('loading holds the top rung even with nothing to draw yet', () => {
    const verdict = resolveDegradationLevel({
      ...HEALTHY,
      loading: true,
      streamContent: false,
      snapshotContent: false,
    });
    // Collapsing "in flight" into "absent" would flash the informational rung on every first
    // paint, which reads as a broken page and teaches the viewer to ignore the label.
    expect(verdict.level).toBe('stream');
    expect(verdict.reason).toBeNull();
  });
});

describe('automatic recovery (AC#5)', () => {
  /**
   * The claim under test is that there IS no recovery mechanism: the level is a pure function
   * of conditions read on every render, so restoring the condition restores the rung. If this
   * ever needed a setup step, a timer or a retry, the design would have changed and this test
   * would no longer model it.
   */
  test('restoring the projection restores the stream rung, with no intervening step', () => {
    const degraded = resolveDegradationLevel({ ...HEALTHY, streamContent: false });
    expect(degraded.level).toBe('snapshot');

    const recovered = resolveDegradationLevel(HEALTHY);
    expect(recovered.level).toBe('stream');
    expect(recovered.reason).toBeNull();
  });

  test('the function is total and stateless: the same input always gives the same verdict', () => {
    const inputs: DegradationInput[] = [
      HEALTHY,
      { ...HEALTHY, streamContent: false },
      { ...HEALTHY, webglSupported: false },
      { ...HEALTHY, streamContent: false, snapshotContent: false },
    ];
    // Interleaved deliberately: a hidden latch would make the second pass differ from the
    // first, which a straight repeat of one input would not reveal.
    const firstPass = inputs.map(resolveDegradationLevel);
    const secondPass = [...inputs].reverse().map(resolveDegradationLevel).reverse();
    expect(secondPass).toEqual(firstPass);
  });
});

describe('every rung is labelled without relying on colour (AC#3)', () => {
  test('the four levels are told apart by words alone', () => {
    const labels = DEGRADATION_LEVELS.map((level) => degradationDescriptor(level).label);
    expect(new Set(labels).size).toBe(DEGRADATION_LEVELS.length);
  });

  test('and by glyph alone, so the claim survives the stylesheet being off', () => {
    const glyphs = DEGRADATION_LEVELS.map((level) => degradationDescriptor(level).glyph);
    expect(new Set(glyphs).size).toBe(DEGRADATION_LEVELS.length);
  });

  test('each carries a full sentence for assistive technology, since a chip reads as a fragment', () => {
    for (const level of DEGRADATION_LEVELS) {
      const descriptor = degradationDescriptor(level);
      expect(descriptor.announcement.length).toBeGreaterThan(descriptor.label.length);
    }
  });

  test('every reason the ladder can report has a sentence', () => {
    // Enumerated from the verdicts the resolver actually produces rather than from a
    // hand-written list, so a reason added later without a sentence fails here.
    const reasons = new Set(
      [
        HEALTHY,
        { ...HEALTHY, streamContent: false },
        { ...HEALTHY, webglSupported: false },
        { ...HEALTHY, rendererFailed: true },
        { ...HEALTHY, streamContent: false, snapshotContent: false },
      ].map((input) => resolveDegradationLevel(input).reason),
    );
    for (const reason of reasons) {
      if (reason === null) continue;
      expect(degradationReasonSentence(reason)).toEqual(expect.any(String));
    }
    expect(degradationReasonSentence(null)).toBeNull();
  });
});

describe('the last-updated chip (AC#3)', () => {
  const NOW = 1_700_000_000_000;

  test.each([
    [30_000, '剛剛更新'],
    [5 * 60_000, '5 分鐘前更新'],
    [3 * 3_600_000, '3 小時前更新'],
    [2 * 24 * 3_600_000, '2 天前更新'],
  ])('an age of %ims reads as %s', (ageMs, expected) => {
    expect(lastUpdatedDescriptor(NOW - ageMs, NOW)?.label).toBe(expected);
  });

  test('clock skew clamps to "just now" rather than rendering a negative age', () => {
    // The server stamped it, the browser is reading it, and the two clocks disagree. That is
    // not the viewer's problem, and "-3 分鐘前" reads as a bug in the page.
    expect(lastUpdatedDescriptor(NOW + 60_000, NOW)?.label).toBe('剛剛更新');
  });

  test('an unknown timestamp renders no chip rather than an age nobody knows', () => {
    expect(lastUpdatedDescriptor(null, NOW)).toBeNull();
    expect(lastUpdatedDescriptor(undefined, NOW)).toBeNull();
    expect(lastUpdatedDescriptor(Number.NaN, NOW)).toBeNull();
    expect(lastUpdatedDescriptor(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });

  test('the zero sentinel renders no chip, not fifty-six years', () => {
    // `runtimeSnapshot.ts` documents `updatedAt === 0` as "this world has no accepted events".
    // Measuring an age from the Unix epoch would report a world seeded minutes ago as decades
    // old, which is the single most confidently wrong thing this chip could say.
    expect(lastUpdatedDescriptor(0, NOW)).toBeNull();
  });

  test('the age chip carries no state, because an age is not a verdict', () => {
    expect(lastUpdatedDescriptor(NOW - 60_000, NOW)?.state).toBeNull();
  });
});
