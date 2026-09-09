/**
 * Keep the PRD 1.0 closure matrix's totals equal to the rows they summarise (ART-152).
 *
 * ## Why a build step rather than care
 *
 * `docs/prd-1.0-closure-matrix.md` exists to be the objective evidence that PRD 1.0 is closed —
 * PRD 2.0 §26 and ART-138 both forbid claiming completion without it. A closure matrix whose own
 * arithmetic is wrong cannot serve that purpose, and it had been wrong for a while: `P0 delivered`
 * read 98 against 108 rows and `Deferred P1/P2` read 20 against 3.
 *
 * The drift had a cause worth recording, because it will recur without this check. The summary
 * table had no bucket for a P1/P2 clause that was DELIVERED. So every time a clause moved out of
 * `Deferred` — which happened fifteen times, one task at a time, each faithfully logged in the
 * document's own post-audit list — the deferred count went down and nothing went up. Nobody
 * mis-added anything; the table simply could not represent what was happening to it.
 *
 * ## What makes it checkable
 *
 * The `Classification` column is a CLOSED VOCABULARY: exactly one token per row, no prose, no
 * markdown emphasis, no parentheticals. That is the load-bearing constraint. Before ART-152 the
 * column held 29 distinct free-text strings ("**Delivered**", "P0 delivered (7/30); 90-day P1
 * deferred", "Fully delivered (history compression closed by ART-27)"), and no counting rule can
 * survive that. The nuance was not deleted — it moved to `Objective verification`, where the rest
 * of the nuance already lived.
 *
 * An unrecognised classification is an ERROR rather than an "other" bucket. A bucket for the
 * unrecognised would let the next nuanced cell drift out of the totals silently, which is the exact
 * failure this check exists to stop.
 *
 * ## What is counted, and what deliberately is not
 *
 * A clause row belongs to a table with the five-column clause header. The §22/§23 table has a
 * four-column header and records process decisions ("Decisions upheld"), not clauses, so it is not
 * counted — and because the header is matched exactly rather than by prefix, it cannot drift in.
 *
 * The three zero rows (`Unowned`, `P0 not Done`, and the non-goal count's meaning) are checked as
 * literals against the prose sections that carry their evidence, not derived from row absence:
 * "no row says there is a gap" is not evidence that there is no gap.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MATRIX_PATH = join(ROOT, 'docs/prd-1.0-closure-matrix.md');

/** The five-column header that marks a table of PRD clauses. Matched exactly. */
export const CLAUSE_HEADER =
  '| Clause ID | Summary | Classification | Owning task (status) | Objective verification |';
/** The three-column header of the §6 non-goal closure audit. */
export const NON_GOAL_HEADER = '| §6 non-goal | Status | Basis |';
/** The summary table this check exists to hold to the rows. */
export const SUMMARY_HEADER = '| Classification | Count | Launch-blocking? |';

/**
 * Every classification a clause row may carry.
 *
 * Adding one means adding its summary row too — `checkSummaryTotals` fails on a bucket with no
 * stated total, so the vocabulary and the summary cannot come apart.
 */
export const CLASSIFICATIONS = [
  'P0 delivered',
  'P1 delivered',
  'P2 delivered',
  'P1 deferred',
  'P2 deferred',
  'Not launch-gated',
];

/** Rows of the summary table that are asserted by a prose section rather than counted from rows. */
export const ASSERTED_SUMMARY_ROWS = [
  { label: 'Non-goal', expected: (counts) => counts.nonGoals },
  { label: 'Unowned in-scope clause (gap)', expected: () => 0 },
  { label: 'P0 clause whose task is not yet Done', expected: () => 0 },
];

const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line);

/** Split a markdown table row into trimmed cells, honouring `\|` escapes inside a cell. */
export function tableCells(line) {
  const cells = [];
  let current = '';
  for (let index = 1; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && line[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (character === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  return cells;
}

/** Every table header this document is parsed for. A table ends where the next one begins. */
const ALL_HEADERS = [CLAUSE_HEADER, NON_GOAL_HEADER, SUMMARY_HEADER];

/**
 * Every row of every table whose header line equals `header`, as cell arrays.
 *
 * A table ends at the first line that is not a table row, OR at the header of another table it
 * knows about. The second rule matters because a table row is still a table row without a blank
 * line before it: without it, one missing blank line would fold the non-goal table into the clause
 * table and report every non-goal as a malformed clause.
 */
export function rowsUnderHeader(markdown, header) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith('|') || ALL_HEADERS.includes(trimmed)) {
      inTable = false;
      continue;
    }
    if (isSeparator(line)) continue;
    rows.push(tableCells(line));
  }
  return rows;
}

export function countClassifications(markdown) {
  const rows = rowsUnderHeader(markdown, CLAUSE_HEADER);
  const counts = Object.fromEntries(CLASSIFICATIONS.map((name) => [name, 0]));
  const errors = [];
  for (const cells of rows) {
    if (cells.length !== 5) {
      errors.push(`clause row "${cells[0] ?? '(empty)'}" has ${cells.length} cells, expected 5`);
      continue;
    }
    const classification = cells[2];
    if (!Object.prototype.hasOwnProperty.call(counts, classification)) {
      errors.push(
        `clause "${cells[0]}" carries classification "${classification}", which is not in the closed `
        + `vocabulary (${CLASSIFICATIONS.join(', ')}). Put the nuance in the verification column.`,
      );
      continue;
    }
    counts[classification] += 1;
  }
  return { counts, rowCount: rows.length, errors };
}

export function countNonGoals(markdown) {
  const rows = rowsUnderHeader(markdown, NON_GOAL_HEADER);
  const errors = [];
  for (const cells of rows) {
    if (cells[1] !== 'Absent') {
      errors.push(
        `§6 non-goal "${cells[0]}" is recorded as "${cells[1]}" rather than "Absent" — a non-goal `
        + 'that is present is a scope breach, not a counting error',
      );
    }
  }
  return { nonGoals: rows.length, errors };
}

/**
 * Read the stated totals.
 *
 * A summary row is identified by the classification token appearing in backticks, or — for the
 * asserted rows — by its bold label, so the surrounding explanatory prose in the cell is free to
 * change without breaking the check.
 */
export function statedTotals(markdown) {
  const rows = rowsUnderHeader(markdown, SUMMARY_HEADER);
  const stated = new Map();
  const errors = [];
  for (const cells of rows) {
    if (cells.length < 2) continue;
    const label = cells[0];
    const value = Number.parseInt(cells[1].replace(/\*/g, '').trim(), 10);
    if (Number.isNaN(value)) continue;
    const token = CLASSIFICATIONS.find((name) => label.includes(`\`${name}\``));
    if (token) {
      stated.set(token, value);
      continue;
    }
    if (label.includes('Total clause rows')) stated.set('__total__', value);
    const asserted = ASSERTED_SUMMARY_ROWS.find((row) => label.includes(row.label));
    if (asserted) stated.set(asserted.label, value);
  }
  return { stated, errors };
}

export function runCheck(markdownOrPath = MATRIX_PATH) {
  const markdown = markdownOrPath.includes('\n')
    ? markdownOrPath
    : readFileSync(markdownOrPath, 'utf8');

  const { counts, rowCount, errors: rowErrors } = countClassifications(markdown);
  const { nonGoals, errors: nonGoalErrors } = countNonGoals(markdown);
  const { stated, errors: statedErrors } = statedTotals(markdown);
  const errors = [...rowErrors, ...nonGoalErrors, ...statedErrors];

  if (rowCount === 0) {
    errors.push(
      `no clause rows found — the header "${CLAUSE_HEADER}" matched nothing, so every total below `
      + 'would be vacuously satisfied',
    );
  }

  for (const name of CLASSIFICATIONS) {
    if (!stated.has(name)) {
      errors.push(`the closure summary states no total for \`${name}\``);
      continue;
    }
    if (stated.get(name) !== counts[name]) {
      errors.push(
        `closure summary says ${stated.get(name)} \`${name}\` clause(s), but ${counts[name]} row(s) `
        + 'carry that classification',
      );
    }
  }

  const summed = CLASSIFICATIONS.reduce((total, name) => total + counts[name], 0);
  if (!stated.has('__total__')) {
    errors.push('the closure summary states no "Total clause rows"');
  } else if (stated.get('__total__') !== rowCount) {
    errors.push(`closure summary says ${stated.get('__total__')} total clause rows, but ${rowCount} were found`);
  }
  if (summed !== rowCount) {
    errors.push(`classification counts sum to ${summed}, but ${rowCount} clause rows were found`);
  }

  for (const row of ASSERTED_SUMMARY_ROWS) {
    const expected = row.expected({ nonGoals });
    if (!stated.has(row.label)) {
      errors.push(`the closure summary states no total for "${row.label}"`);
      continue;
    }
    if (stated.get(row.label) !== expected) {
      errors.push(`closure summary says ${stated.get(row.label)} for "${row.label}", but ${expected} was found`);
    }
  }

  return { errors, counts, rowCount, nonGoals };
}

function main() {
  const { errors, counts, rowCount, nonGoals } = runCheck();
  if (errors.length > 0) {
    console.error('PRD 1.0 closure matrix check failed:\n');
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\n${errors.length} problem(s) found in docs/prd-1.0-closure-matrix.md.`);
    process.exit(1);
  }
  const breakdown = CLASSIFICATIONS.map((name) => `${counts[name]} ${name}`).join(', ');
  console.log(
    `PRD 1.0 closure matrix check passed: ${rowCount} clause row(s) (${breakdown}) `
    + `and ${nonGoals} verified-absent non-goal(s) agree with the closure summary.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
