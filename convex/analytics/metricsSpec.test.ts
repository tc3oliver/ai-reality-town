/**
 * The published metric definitions are held to the code that computes them (ART-178).
 *
 * `metrics.test.ts` builds every threshold fixture out of the constants it imports from the module
 * under test — `session('a', { durationMs: THREE_MINUTES_MS + 1 })`. That is the right shape for
 * asserting arithmetic, and it is why the suite cannot notice a definition changing: set
 * `THREE_MINUTES_MS` to thirty minutes and every one of those tests stays green while
 * `docs/product-analytics.md` goes on publishing `durationMs > 180000` to whoever reads a report.
 *
 * CLAUDE.md §9 states the rule this file exists to satisfy: a validator must not be handed its own
 * input. So the numbers below are typed out as the literals the document publishes, and the
 * document's own §16.1 table is parsed and compared row by row — an independent derivation, from
 * the artifact a human actually reads.
 *
 * This is not documentation hygiene. `meetsTarget` is what a launch is judged by, and a target
 * that drifts from its published value reports success against a bar nobody agreed to.
 *
 * What is and is not new here, stated plainly: the eight TARGETS were already pinned, as
 * transcribed literals, by `the report carries exactly the eight the PRD tables, with their
 * targets`. Changing 0.15 to 0.25 was already red. What nothing caught was the numerator RULES —
 * the duration threshold, the two day offsets, and the one inverted direction — and the fact that
 * the document and the code could disagree in either direction without either side noticing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NEXT_DAY_OFFSET,
  SEVEN_DAY_OFFSET,
  THREE_MINUTES_MS,
  computeAnalyticsMetrics,
  type MetricObservation,
  type MetricsWindow,
} from './metrics';

const DOC_PATH = 'docs/product-analytics.md';

const WINDOW: MetricsWindow = {
  worldId: 'mistwood', fromDayIndex: 0, toDayIndex: 29, todayIndex: 29,
};

/** An empty world still produces the full metric table — only its rates are `null`. */
const report = computeAnalyticsMetrics(WINDOW, [], [], []);

const byKey = (rows: readonly MetricObservation[]): Map<string, MetricObservation> =>
  new Map(rows.map((row) => [row.key, row]));

/**
 * The §16.1 table as the document publishes it: key, PRD name, target percentage.
 *
 * Parsed rather than transcribed, so editing the document without editing the code is what turns
 * this red — the direction the drift actually runs.
 */
function publishedProductRows(): { key: string; label: string; targetPercent: number }[] {
  const doc = readFileSync(join(process.cwd(), DOC_PATH), 'utf8');
  const start = doc.indexOf('### §16.1');
  expect(start).toBeGreaterThan(-1);
  const section = doc.slice(start, doc.indexOf('\n### ', start + 1));
  const rows: { key: string; label: string; targetPercent: number }[] = [];
  for (const line of section.split('\n')) {
    const match = /^\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|[^|]*\|[^|]*\|\s*≥\s*(\d+)%\s*\|/u.exec(line);
    if (match) rows.push({ key: match[1], label: match[2], targetPercent: Number(match[3]) });
  }
  return rows;
}

describe('the §16.1 table in docs/product-analytics.md is the spec the code implements', () => {
  const published = publishedProductRows();

  it('parses all eight rows, so a broken parse cannot pass vacuously', () => {
    // The way a document-parsing check usually fails: the table gets reformatted, the regex stops
    // matching, and every per-row assertion below is satisfied by having no rows to check.
    expect(published).toHaveLength(8);
  });

  it('publishes exactly the metrics the report computes, in the same order', () => {
    // Exhaustive in both directions. A metric added to the code and not to the document is
    // unreadable in a report; one in the document and not the code is a promise nothing keeps.
    expect(published.map((row) => row.key)).toEqual(report.product.map((row) => row.key));
  });

  it.each(publishedProductRows())('$key matches its published name and target', (row) => {
    const observed = byKey(report.product).get(row.key);
    expect(observed).toBeDefined();
    expect(observed?.label).toBe(row.label);
    // The document writes percentages; the code holds fractions. Compared at the document's own
    // precision, because 0.15 and 15% are the same claim and only one of them is published.
    expect(Math.round((observed?.target ?? -1) * 100)).toBe(row.targetPercent);
    // Every §16.1 metric is a floor. `renderer_error_rate` is the one ceiling in the system and it
    // is not in this table; if a floor here ever became a ceiling, the target would read the same
    // and mean the opposite.
    expect(observed?.direction).toBe('atLeast');
  });
});

describe('the thresholds are the literals the document publishes, not whatever the module holds', () => {
  it('scopes 停留超過 3 分鐘 to the published 180000 ms', () => {
    expect(THREE_MINUTES_MS).toBe(180_000);
    expect(readFileSync(join(process.cwd(), DOC_PATH), 'utf8')).toContain('durationMs > 180000');
  });

  it('measures the two return windows at exactly D+1 and D+7', () => {
    expect(NEXT_DAY_OFFSET).toBe(1);
    expect(SEVEN_DAY_OFFSET).toBe(7);
    const doc = readFileSync(join(process.cwd(), DOC_PATH), 'utf8');
    expect(doc).toContain('a session on day D+1');
    expect(doc).toContain('a session on day D+7');
  });

  it('holds the renderer error rate at the published 2% ceiling, inverted', () => {
    const renderer = byKey(report.dynamic).get('renderer_error_rate');
    expect(renderer?.target).toBe(0.02);
    // The direction is the whole point of the row: at `atLeast`, a 40% renderer error rate would
    // be reported as comfortably exceeding its target.
    expect(renderer?.direction).toBe('atMost');
    expect(readFileSync(join(process.cwd(), DOC_PATH), 'utf8')).toContain('a **ceiling** (< 2%)');
  });
});
