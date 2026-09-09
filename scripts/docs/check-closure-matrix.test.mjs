/**
 * The closure-matrix check must FAIL on the drift it exists to catch (ART-152 AC#2).
 *
 * Each case builds a minimal matrix in memory and breaks exactly one thing, so a passing case here
 * is evidence that the corresponding real failure would be caught rather than evidence that the
 * fixture happened to be well-formed. The last two cases guard the check itself: a checker that
 * silently finds zero rows would report success on a document it never read, which is the way this
 * class of check usually fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CLASSIFICATIONS,
  CLAUSE_HEADER,
  MATRIX_PATH,
  NON_GOAL_HEADER,
  SUMMARY_HEADER,
  countClassifications,
  runCheck,
  tableCells,
} from './check-closure-matrix.mjs';

const SEPARATOR_5 = '|---|---|---|---|---|';

/** A matrix with `p0` P0 rows and `p1` P1 rows, whose summary states `stated` for each. */
function matrix({ p0 = 2, p1 = 1, stated = {}, nonGoals = 1, nonGoalStatus = 'Absent', extraRows = '' } = {}) {
  const totals = {
    'P0 delivered': p0, 'P1 delivered': p1, 'P2 delivered': 0,
    'P1 deferred': 0, 'P2 deferred': 0, 'Not launch-gated': 0,
    ...stated,
  };
  const clauseRows = [
    ...Array.from({ length: p0 }, (_, i) => `| FR-A00${i} | a | P0 delivered | ART-1 (Done) | test |`),
    ...Array.from({ length: p1 }, (_, i) => `| FR-B00${i} | b | P1 delivered | ART-2 (Done) | test |`),
  ].join('\n');
  const summaryRows = CLASSIFICATIONS
    .map((name) => `| \`${name}\` — prose | ${totals[name]} | — |`)
    .join('\n');
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return [
    SUMMARY_HEADER, '|---|---:|---|', summaryRows,
    `| **Total clause rows** | **${total}** | |`,
    `| **Non-goal** (verified absent) | ${nonGoals} | — |`,
    '| **Unowned in-scope clause (gap)** | **0** | — |',
    '| **P0 clause whose task is not yet Done** | **0** | — |',
    '',
    CLAUSE_HEADER, SEPARATOR_5, clauseRows,
    ...(extraRows === '' ? [] : [extraRows]),
    '',
    NON_GOAL_HEADER, '|---|---|---|',
    ...Array.from({ length: nonGoals }, (_, i) => `| non-goal ${i} | ${nonGoalStatus} | basis |`),
    '',
  ].join('\n');
}

test('a matrix whose totals match its rows passes', () => {
  assert.deepEqual(runCheck(matrix()).errors, []);
});

test('a total that overstates its rows fails, naming both numbers', () => {
  const { errors } = runCheck(matrix({ p0: 2, stated: { 'P0 delivered': 98 } }));
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors[0], /says 98 `P0 delivered` clause\(s\), but 2 row\(s\)/);
});

test('a total that understates its rows fails', () => {
  const { errors } = runCheck(matrix({ p1: 3, stated: { 'P1 delivered': 1 } }));
  assert.ok(errors.some((error) => /says 1 `P1 delivered` clause\(s\), but 3 row\(s\)/.test(error)));
});

test('a classification outside the vocabulary fails rather than landing in an "other" bucket', () => {
  const extraRows = '| FR-C001 | c | **Delivered** (with nuance) | ART-3 (Done) | test |';
  const { errors } = runCheck(matrix({ extraRows }));
  assert.ok(errors.some((error) => /FR-C001.*not in the closed vocabulary/s.test(error)),
    errors.join('\n'));
});

test('a summary missing a bucket entirely fails, so the vocabulary cannot outgrow the table', () => {
  const withoutP2 = matrix().split('\n')
    .filter((line) => !line.startsWith('| `P2 delivered`'))
    .join('\n');
  const { errors } = runCheck(withoutP2);
  assert.ok(errors.some((error) => /states no total for `P2 delivered`/.test(error)));
});

test('a stated grand total that disagrees with the rows fails', () => {
  const wrongTotal = matrix().replace('| **Total clause rows** | **3** | |', '| **Total clause rows** | **9** | |');
  const { errors } = runCheck(wrongTotal);
  assert.ok(errors.some((error) => /says 9 total clause rows, but 3 were found/.test(error)));
});

test('a non-goal recorded as present fails — that is a scope breach, not arithmetic', () => {
  const { errors } = runCheck(matrix({ nonGoalStatus: 'Present' }));
  assert.ok(errors.some((error) => /recorded as "Present".*scope breach/s.test(error)));
});

test('a non-goal count that disagrees with the non-goal table fails', () => {
  const drifted = matrix({ nonGoals: 2 }).replace('| **Non-goal** (verified absent) | 2 | — |', '| **Non-goal** (verified absent) | 17 | — |');
  const { errors } = runCheck(drifted);
  assert.ok(errors.some((error) => /says 17 for "Non-goal", but 2 was found/.test(error)));
});

test('a document with no clause table fails instead of passing vacuously', () => {
  const { errors } = runCheck('# nothing here\n');
  assert.ok(errors.some((error) => /no clause rows found/.test(error)));
});

test('the four-column process table is not counted as clause rows', () => {
  const withProcessTable = `${matrix()}\n\n| Clause ID | Summary | Classification | Verification |\n|---|---|---|---|\n| §22 (1–15) | decisions | Decisions upheld | audit |\n`;
  const { errors, rowCount } = runCheck(withProcessTable);
  assert.equal(rowCount, 3);
  assert.deepEqual(errors, []);
});

test('an escaped pipe inside a cell does not split it', () => {
  assert.deepEqual(
    tableCells('| a | blocked \\| manual | c |'),
    ['a', 'blocked | manual', 'c'],
  );
});

test('the real matrix in the repository agrees with its own summary', () => {
  const { errors, rowCount } = runCheck();
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(rowCount > 100, `expected the real matrix to hold its clause rows, found ${rowCount}`);
});

test('every clause row in the real matrix carries a vocabulary classification', () => {
  const { errors, rowCount } = countClassifications(readFileSync(MATRIX_PATH, 'utf8'));
  assert.deepEqual(errors, []);
  // Guards the guard: a header that stopped matching would report zero rows and zero errors.
  assert.ok(rowCount > 100, `expected the real matrix to hold its clause rows, found ${rowCount}`);
});
