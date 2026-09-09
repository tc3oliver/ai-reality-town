/**
 * Hold `docs/prd-2.0-closure-record.md` to the repository it describes (ART-138).
 *
 * ## What this exists to stop
 *
 * A release gate is a document that says "criterion 16 is proved by this named test". The failure
 * mode is not that someone writes a false claim on purpose — it is that a test gets renamed, a file
 * gets moved, and the record goes on citing an assertion nobody runs. That is the same class of rot
 * `check-closure-matrix.mjs` (ART-152) was written for, and it has already happened once here: the
 * PRD 2.0 requirement matrix spent a month naming ART-99 and ART-141 as open release blockers after
 * both were fixed.
 *
 * So three things are checked, and each one can fail on its own:
 *
 * 1. **The summary agrees with the rows.** The counts in §2 are re-derived from the §3 and §3b
 *    tables. A row reclassified without updating the count fails here.
 * 2. **Every cited file exists.** Any backticked token that looks like a repository path must
 *    resolve.
 * 3. **Every cited test name is really in the file cited beside it.** This is the one that matters.
 *    A long backticked phrase in an Evidence cell has to appear VERBATIM in one of that row's cited
 *    files, so renaming a test breaks the gate rather than silently orphaning the claim.
 *
 * ## What it deliberately does NOT check
 *
 * That the cited test PASSES, or that it proves what the row says it proves. `npm run check` runs
 * the suite; a human reads the argument. A gate that tried to judge relevance would be a gate
 * nobody could keep green, and pretending otherwise would make it the thing being trusted instead
 * of the tests.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RECORD_PATH = join(ROOT, 'docs/prd-2.0-closure-record.md');

/** The closed verdict vocabulary. Exactly one per row, no prose. */
export const VERDICTS = ['PASS', 'FAIL', 'EXTERNAL_BLOCKED'];

/** Extensions that make a backticked token a repository path rather than a symbol. */
const PATH_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.json', '.md'];

/** Shortest backticked phrase treated as a test name. Below this it is a symbol, not a title. */
export const MIN_TEST_NAME_LENGTH = 24;

/**
 * Whether a backticked token is a claim about a test that must be findable.
 *
 * The rules are narrow on purpose. A gate that treated every backtick as a test name would force
 * the record to stop naming commands, identifiers and CI jobs — which are the things that make it
 * readable. What it must not be able to do is name a TEST that does not exist, and a test title in
 * this repository always contains a space and lowercase prose.
 */
export function isTestNameClaim(token) {
  if (token.length < MIN_TEST_NAME_LENGTH) return false;
  if (!token.includes(' ')) return false;              // an identifier, not a title
  if (!/[a-z]/.test(token)) return false;              // a constant or a heading
  if (/^(npm|npx|node|git|gh) /.test(token)) return false; // a command
  if (token.includes('→')) return false;               // prose describing a chain
  if (token.includes('…')) return false;               // an abbreviated quote is not a citation
  return true;
}

/**
 * The searchable form of a quoted test title.
 *
 * A record naturally writes `describe('…')` while the source writes `describe('…', () => {`, so the
 * wrapper is stripped and the inner string is what gets looked for. Stripping is safer than
 * matching the wrapper: it means the record can quote a title with or without its wrapper and the
 * gate behaves the same.
 */
export function searchableTestName(token) {
  const wrapped = /^(?:describe|it|test)\(\s*['"](.+)['"]\s*\)$/s.exec(token);
  return wrapped ? wrapped[1] : token;
}

/** Every `| … |` row of the first markdown table under `heading`. */
export function tableRows(source, heading) {
  const start = source.indexOf(heading);
  if (start === -1) throw new Error(`section not found: ${heading}`);
  const rest = source.slice(start + heading.length);
  const end = rest.search(/\n## /);
  const block = end === -1 ? rest : rest.slice(0, end);
  return block
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((cell) => cell.trim()))
    // Drop the header row and any summary row: a data row's first cell is a number.
    .filter((cells) => /^\d+$/.test(cells[0]));
}

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const isPath = (token) => token.includes('/')
  && PATH_EXTENSIONS.some((extension) => token.endsWith(extension))
  && !token.includes(' ');

/**
 * The verdict a row states, or `null`.
 *
 * Read out of the verdict CELL rather than by searching the whole row, so the word "PASS" inside a
 * sentence of evidence cannot be mistaken for a verdict — which is how a closed vocabulary stops
 * being closed.
 */
export function verdictOf(cell) {
  const cleaned = cell.replace(/\*|~/g, '').trim();
  return VERDICTS.includes(cleaned) ? cleaned : null;
}

export function runCheck(recordPath = RECORD_PATH) {
  const errors = [];
  if (!existsSync(recordPath)) return { errors: [`closure record not found at ${recordPath}`], counts: {} };
  const source = readFileSync(recordPath, 'utf8');

  const criteria = tableRows(source, '## 3. The thirty-one criteria');
  const ownAcs = tableRows(source, "## 3b. ART-138's own acceptance criteria (FR-Q008)");

  if (criteria.length !== 31) {
    errors.push(`§22 has thirty-one criteria; the record's table carries ${criteria.length} row(s)`);
  }
  if (ownAcs.length !== 13) {
    errors.push(`ART-138 has thirteen acceptance criteria; the record's table carries ${ownAcs.length} row(s)`);
  }

  const tally = (rows, label) => {
    const counts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0]));
    for (const cells of rows) {
      const verdict = verdictOf(cells[2]);
      if (verdict === null) {
        errors.push(`${label} row ${cells[0]}: "${cells[2]}" is not one of ${VERDICTS.join(' / ')}`);
        continue;
      }
      counts[verdict] += 1;
    }
    return counts;
  };
  const criteriaCounts = tally(criteria, '§22');
  const ownCounts = tally(ownAcs, 'ART-138 AC');

  // The summary must be re-derivable from the rows it summarises (the ART-152 rule).
  const summaryNumbers = (heading) => {
    const start = source.indexOf(heading);
    if (start === -1) return null;
    const block = source.slice(start, start + 600);
    return Object.fromEntries(VERDICTS.map((verdict) => {
      const match = new RegExp(`\\|\\s*${verdict}\\s*\\|\\s*(\\d+)\\s*\\|`).exec(block);
      return [verdict, match ? Number(match[1]) : null];
    }));
  };
  const declaredCriteria = summaryNumbers('**PRD 2.0 §22 — the thirty-one MVP criteria**');
  const declaredOwn = summaryNumbers("**ART-138's own thirteen acceptance criteria (FR-Q008)**");
  for (const [label, declared, actual] of [
    ['§22', declaredCriteria, criteriaCounts],
    ['ART-138 AC', declaredOwn, ownCounts],
  ]) {
    if (declared === null) {
      errors.push(`${label}: the summary table is missing`);
      continue;
    }
    for (const verdict of VERDICTS) {
      if (declared[verdict] !== actual[verdict]) {
        errors.push(
          `${label} summary says ${declared[verdict]} ${verdict}, the rows carry ${actual[verdict]}`);
      }
    }
  }

  // Every cited path resolves, and every cited test name is really in one of that row's files.
  let citedTestNames = 0;
  for (const cells of [...criteria, ...ownAcs]) {
    const evidence = cells[3] ?? '';
    const tokens = backticked(evidence);
    const paths = tokens.filter(isPath);
    for (const path of paths) {
      if (!existsSync(join(ROOT, path))) {
        errors.push(`row ${cells[0]} cites "${path}", which does not exist`);
      }
    }
    const sources = paths
      .filter((path) => existsSync(join(ROOT, path)))
      .map((path) => readFileSync(join(ROOT, path), 'utf8'));
    for (const token of tokens) {
      if (isPath(token) || !isTestNameClaim(token)) continue;
      // A quoted phrase this long beside a file citation is a test title. It has to be findable.
      if (sources.length === 0) {
        errors.push(`row ${cells[0]} quotes "${token}" but cites no file it could be in`);
        continue;
      }
      citedTestNames += 1;
      const needle = searchableTestName(token);
      if (!sources.some((text) => text.includes(needle))) {
        errors.push(`row ${cells[0]} quotes "${token}", which appears in none of: ${paths.join(', ')}`);
      }
    }
  }

  // A record that cited no test at all would satisfy every rule above vacuously.
  if (citedTestNames < 20) {
    errors.push(`only ${citedTestNames} test name(s) were checked — a record this thin is not evidence`);
  }

  return {
    errors,
    counts: { criteria: criteriaCounts, ownAcs: ownCounts, citedTestNames },
  };
}

function main() {
  const { errors, counts } = runCheck();
  if (errors.length > 0) {
    console.error('PRD 2.0 closure record check failed:\n');
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\n${errors.length} problem(s).`);
    process.exit(1);
  }
  const { criteria, ownAcs, citedTestNames } = counts;
  console.log(
    `PRD 2.0 closure record check passed: §22 ${criteria.PASS} PASS / ${criteria.FAIL} FAIL / `
    + `${criteria.EXTERNAL_BLOCKED} EXTERNAL_BLOCKED, ART-138 ${ownAcs.PASS} PASS / ${ownAcs.FAIL} FAIL / `
    + `${ownAcs.EXTERNAL_BLOCKED} EXTERNAL_BLOCKED, ${citedTestNames} cited test name(s) all found.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
