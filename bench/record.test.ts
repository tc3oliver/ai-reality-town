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
  /** Absent in a record written before ART-138 added the renderer gate. */
  rendererClass?: 'hardware' | 'software' | 'unidentified';
  verdicts: Array<{ criterion: string; profileId: string; mode: string; pass: boolean }>;
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

  it('reports the mid-tier mobile frame rate, whatever it is, rather than omitting it', () => {
    /**
     * The other claim this file is cited for.
     *
     * This assertion used to require the mobile rows to FAIL — `mobileFps.some((v) => !v.pass)` —
     * which was true of every run the harness could produce at the time and wrong as a rule. It
     * encoded「the mid-tier mobile frame rate is a failure」as a property of the RECORD, so a run
     * that finally passed the criterion would have failed this test. ART-138 found that the reason
     * those runs failed was a harness defect, not a device limit; a rule that forbids the fix from
     * ever showing up is not a gate, it is a lock.
     *
     * What ART-138 §6.1 actually forbids is SUBSTITUTION: reporting the desktop, degraded or
     * snapshot figure under the mobile criterion's name, or dropping the row so its absence reads
     * as「not a problem」. That is what is asserted now — the rows are present, and they are
     * `stream` and `delayed`, the two modes the criterion names.
     */
    const mobileFps = record.verdicts.filter((v) => v.criterion === 'AC#4' && v.profileId === 'mid-tier-mobile');
    expect(mobileFps.length).toBeGreaterThan(0);
    for (const verdict of mobileFps) {
      expect(markdown).toContain(`| AC#4 | mid-tier-mobile | ${verdict.mode} |`);
    }
    expect(mobileFps.map((verdict) => verdict.mode)).toEqual(expect.arrayContaining(['stream', 'delayed']));
  });

  it('never presents a software-rasterised run as evidence about a device', () => {
    /**
     * ART-138 AC#11. The harness refuses to measure at all unless the renderer is hardware, so the
     * only way a software run reaches this record is the documented `BENCH_SOFTWARE_GL=1` path —
     * and a reader who picks the file up months later must not have to recognise
     * `ANGLE (Google, … SwiftShader Device …)` to know the frame rates in it are about a rasteriser
     * rather than about a phone. For two releases that is exactly what was required of them.
     */
    if (record.rendererClass === undefined) return; // a record written before the field existed
    expect(markdown).toContain(`- Renderer class: **${record.rendererClass}**`);
    if (record.rendererClass !== 'hardware') {
      expect(markdown).toContain('**This run did not use a hardware GPU**');
      expect(markdown).toContain('not** usable as evidence for NFR2-002 AC#4');
    }
  });
});
