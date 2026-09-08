/**
 * The one metric primitive every measured rate in this repository is built from.
 *
 * Lifted out of `convex/analytics/metrics.ts` by ART-58, because the world-quality evaluators
 * (FR-M002: ART-58 continuity, ART-88 narrative, ART-89 arc/recap, ART-90 rejection/withhold)
 * need the same rule §16.1's product metrics needed, and a second copy of it would be a second
 * place for the rule to be wrong. `shared` depends on nothing, so every module can reach it.
 *
 * ## The rule: zero is not the same as nothing
 *
 * A rate whose denominator is zero has no value. Reporting it as `0%` is not a rounding choice,
 * it is a false statement — and for §16.2's targets it is the dangerous one, because four of them
 * are exactly `0` or exactly `100%`. An empty world that reported 「嚴重 Canon 衝突 0」 and
 * 「Replay 一致率 100%」 would pass every gate while having measured nothing. So
 * {@link MetricObservation.rate} is `number | null`, `status` says which, and `meetsTarget` is
 * `null` rather than `true` or `false` when there is nothing to compare.
 *
 * `excluded` / `excludedReason` are the second half of the same rule: an observation that CANNOT
 * answer the question (an unmatured retention cohort, a day with no snapshot to replay against)
 * is left out of the denominator and counted, rather than counted as a failure or a success.
 */

/** Whether a target is a floor (most of §16.1 / §16.2) or a ceiling (conflict counts, error rates). */
export type TargetDirection = 'atLeast' | 'atMost';

export type MetricStatus = 'measured' | 'no_observations';

export type MetricObservation = {
  key: string;
  /** The PRD's own name for the metric, so a report is readable beside the table it comes from. */
  label: string;
  numerator: number;
  denominator: number;
  /** `null` exactly when `denominator === 0`. Never `0` in that case. */
  rate: number | null;
  status: MetricStatus;
  target: number | null;
  direction: TargetDirection;
  /** `null` when the metric was not measured. A missing measurement is not a missed target. */
  meetsTarget: boolean | null;
  /**
   * Observations deliberately left out of the denominator, and why.
   *
   * Published rather than absorbed: a rate computed over a third of the population is a different
   * number from one computed over all of it, and there is no way to see that from the rate alone.
   */
  excluded: number;
  excludedReason: string | null;
};

/** A count rather than a rate — 「有多少人在看」 has no denominator. */
export type MetricCount = {
  key: string;
  label: string;
  value: number;
  status: MetricStatus;
};

/** Rates are published to four decimals; a rate is a report, not an intermediate. */
export const roundRate = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Build one observation. The branch on `denominator > 0` is the whole point of the module.
 */
export function observeRate(
  key: string,
  label: string,
  numerator: number,
  denominator: number,
  target: number | null,
  direction: TargetDirection = 'atLeast',
  excluded = 0,
  excludedReason: string | null = null,
): MetricObservation {
  const measured = denominator > 0;
  const rate = measured ? roundRate(numerator / denominator) : null;
  return {
    key, label, numerator, denominator, rate,
    status: measured ? 'measured' : 'no_observations',
    target, direction,
    meetsTarget: rate === null || target === null
      ? null
      : (direction === 'atLeast' ? rate >= target : rate <= target),
    excluded, excludedReason,
  };
}

/**
 * A count whose `status` says whether anything was there to count.
 *
 * `observed` is the size of the population the count was taken over, NOT the count itself: a
 * world with 200 accepted events and zero conflicts is a MEASURED zero, and a world with no events
 * is not.
 */
export function observeCount(key: string, label: string, value: number, observed: number): MetricCount {
  return { key, label, value, status: observed > 0 ? 'measured' : 'no_observations' };
}
