/**
 * The committed benchmark record says what the run it came from actually measured (ART-178).
 *
 * `docs/benchmarks/dynamic-view-latest.md` is the artifact every release-gate conversation cites,
 * and it is the one performance evidence in this repository that no test read. It opens with
 * **"Do not edit by hand — regenerate it"**, which is a convention, not a gate: nothing noticed
 * when it disagreed with `dynamic-view-latest.json` beside it, and nothing noticed when a verdict
 * in it claimed more than the run behind it.
 *
 * It did claim more. `AC#7 — an eight hour run shows no sustained memory growth` was recorded as
 * `✅` from a **two-minute** soak — `npm run bench`'s default — because the renderer printed a
 * pass mark for any verdict whose slope was under threshold, with no view of how long the run
 * lasted. The number was right and the criterion it was filed under was not.
 *
 * These assertions are deliberately about the RECORD rather than about `soakVerdict`, which
 * `measure.test.ts` covers directly. A correct verdict function rendered wrongly is still a false
 * claim in the file a human reads.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BENCH_THRESHOLDS } from './profile';

const ROOT = process.cwd();
const read = (name: string): string =>
  readFileSync(join(ROOT, 'docs/benchmarks', name), 'utf8');

type SoakRecord = {
  durationMs: number;
  verdict: { criterion: string; value: number; threshold: number; pass: boolean; settlesCriterion?: boolean };
};

const record = JSON.parse(read('dynamic-view-latest.json')) as {
  soakMinutes: number;
  soak: SoakRecord | null;
  verdicts: Array<{ criterion: string; profileId: string; pass: boolean }>;
};
const markdown = read('dynamic-view-latest.md');

/** The one table row for AC#7, whichever mark it carries. */
const soakRow = (): string => {
  const row = markdown.split('\n').find((line) => line.startsWith('| AC#7 |'));
  expect(row).toBeDefined();
  return row as string;
};

describe('the recorded benchmark does not claim a criterion the run could not settle', () => {
  it('has a soak to reason about at all, so the rest is not vacuous', () => {
    expect(record.soak).not.toBeNull();
    expect(soakRow()).toContain('heapGrowthBytesPerMinute');
  });

  it('marks AC#7 settled only when the soak ran the full length the criterion names', () => {
    const soak = record.soak as SoakRecord;
    // `=== true`, not `!== false`: this file predates the field, and an unknown run length must
    // not read as a settled criterion.
    const settles = soak.verdict.settlesCriterion === true;
    expect(settles).toBe(soak.durationMs >= BENCH_THRESHOLDS.soakDurationMs);
    // The rendered mark follows the same fact, which is the half that was wrong.
    expect(soakRow().trim().endsWith(settles ? '| ✅ |' : '| ⚠️ |')).toBe(true);
  });

  it('states an unsettled soak in the gaps table instead of dropping it', () => {
    if (record.soak?.verdict.settlesCriterion === true) return;
    // A criterion that is neither passed nor failed must still be visible. The whole point of
    // that table, as its own preamble says, is that a gate which silently drops what it could not
    // measure reports green for a system nobody measured.
    expect(markdown).toContain('| AC#7 | `soakDurationMs` | `run_too_short` |');
    const required = Math.round(BENCH_THRESHOLDS.soakDurationMs / 60_000);
    expect(markdown).toContain(`BENCH_SOAK_MINUTES=${required} npm run bench`);
  });

  it('reports the mid-tier mobile frame rate as a failure, not as an omission', () => {
    // The other claim this file is cited for. It is a FAIL and must stay one: ART-138 §6.1
    // forbids substituting the desktop, degraded or snapshot figure for it, and an absent row
    // would read as "not a problem" rather than "not settled".
    const mobileFps = record.verdicts.filter((v) => v.criterion === 'AC#4' && v.profileId === 'mid-tier-mobile');
    expect(mobileFps.length).toBeGreaterThan(0);
    expect(mobileFps.some((verdict) => !verdict.pass)).toBe(true);
  });
});
