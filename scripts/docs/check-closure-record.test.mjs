/**
 * The closure-record check must FAIL on the drift it exists to catch (ART-138).
 *
 * Each case writes a minimal record to a temp file and breaks exactly one thing, so a passing case
 * is evidence that the corresponding real failure would be caught — not evidence that the fixture
 * happened to be well formed. The last cases guard the checker itself: one that found no rows, or
 * that checked no test names, would report success on a document it never really read, which is how
 * this class of check usually fails.
 *
 * The claim the whole gate rests on is the third one: a record that names a test must name a test
 * that exists. When it was first run against the real document it found nine citations that did
 * not resolve — an abbreviated quote, three files named without their directory, and a CI job name
 * mistaken for a test. Every one of those would have been an unfalsifiable line in a release gate.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  isTestNameClaim,
  runCheck,
  searchableTestName,
  tableRows,
  verdictOf,
  RECORD_PATH,
} from './check-closure-record.mjs';

const SEP4 = '| --- | --- | --- | --- |';

/**
 * A record with `criteria` §22 rows and 13 ART-138 rows, all PASS unless overridden.
 *
 * `evidence` is applied to the FIRST §22 row only, so a citation case breaks one row and leaves the
 * rest well formed — otherwise a failure could not be attributed.
 */
function record({
  criteria = 31,
  criteriaSummary = { PASS: 31, FAIL: 0, EXTERNAL_BLOCKED: 0 },
  ownSummary = { PASS: 13, FAIL: 0, EXTERNAL_BLOCKED: 0 },
  firstVerdict = 'PASS',
  evidence = null,
} = {}) {
  // Enough real citations that the "a record this thin is not evidence" floor is cleared, so a
  // fixture failing for THAT reason cannot be confused with the case under test.
  const realCitation = '`scripts/docs/check-closure-record.mjs` — `Every cited test name is really in the file cited beside it`';
  const rows = Array.from({ length: criteria }, (_, index) => {
    const verdict = index === 0 ? firstVerdict : 'PASS';
    const cell = index === 0 && evidence !== null ? evidence : realCitation;
    return `| ${index + 1} | criterion ${index + 1} | ${verdict} | ${cell} |`;
  }).join('\n');
  const ownRows = Array.from({ length: 13 }, (_, index) =>
    `| ${index + 1} | ac ${index + 1} | PASS | ${realCitation} |`).join('\n');
  const summary = (counts) => ['| Verdict | Count |', '| --- | ---: |',
    ...Object.entries(counts).map(([verdict, count]) => `| ${verdict} | ${count} |`)].join('\n');

  return `# fixture

## 2. Summary

**PRD 2.0 §22 — the thirty-one MVP criteria**

${summary(criteriaSummary)}

**ART-138's own thirteen acceptance criteria (FR-Q008)**

${summary(ownSummary)}

## 3. The thirty-one criteria

| # | Criterion | Verdict | Evidence |
${SEP4}
${rows}

## 3b. ART-138's own acceptance criteria (FR-Q008)

| AC | Criterion | Verdict | Evidence |
${SEP4}
${ownRows}

## 4. After
`;
}

function checkOf(options) {
  const dir = mkdtempSync(join(tmpdir(), 'closure-record-'));
  const path = join(dir, 'record.md');
  writeFileSync(path, record(options));
  return runCheck(path);
}

test('a record whose summary matches its rows passes', () => {
  const { errors } = checkOf();
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('a summary that disagrees with the rows fails, naming both numbers', () => {
  const { errors } = checkOf({ firstVerdict: 'FAIL' });
  assert.ok(errors.some((error) => /§22 summary says 31 PASS, the rows carry 30/.test(error)), errors.join('\n'));
  assert.ok(errors.some((error) => /§22 summary says 0 FAIL, the rows carry 1/.test(error)), errors.join('\n'));
});

test('a verdict outside the closed vocabulary fails rather than landing in a bucket', () => {
  const { errors } = checkOf({ firstVerdict: 'probably fine' });
  assert.ok(errors.some((error) => /"probably fine" is not one of/.test(error)), errors.join('\n'));
});

test('a missing criterion fails: §22 has thirty-one, not thirty', () => {
  const { errors } = checkOf({ criteria: 30, criteriaSummary: { PASS: 30, FAIL: 0, EXTERNAL_BLOCKED: 0 } });
  assert.ok(errors.some((error) => /thirty-one criteria; the record's table carries 30/.test(error)), errors.join('\n'));
});

test('a cited file that does not exist fails, naming it', () => {
  const { errors } = checkOf({ evidence: '`convex/publicRead/thisWasDeleted.test.ts` — `a test that used to be here somewhere`' });
  assert.ok(errors.some((error) => /cites "convex\/publicRead\/thisWasDeleted.test.ts", which does not exist/.test(error)),
    errors.join('\n'));
});

test('a cited TEST NAME that is not in the cited file fails — the rule the gate exists for', () => {
  const { errors } = checkOf({
    evidence: '`scripts/docs/check-closure-record.mjs` — `a test name nobody ever wrote down here`',
  });
  assert.ok(errors.some((error) => /quotes "a test name nobody ever wrote down here", which appears in none of/.test(error)),
    errors.join('\n'));
});

test('a test name quoted with no file beside it fails', () => {
  const { errors } = checkOf({ evidence: '`this claim cites nothing at all whatever`' });
  assert.ok(errors.some((error) => /but cites no file it could be in/.test(error)), errors.join('\n'));
});

test('a record that cites no test at all fails instead of passing vacuously', () => {
  // The way this check would usually break: every rule above is satisfied by a document that makes
  // no citations, because there is nothing to resolve.
  const { errors } = checkOf({ evidence: 'no citation here' });
  const dir = mkdtempSync(join(tmpdir(), 'closure-record-thin-'));
  const path = join(dir, 'record.md');
  writeFileSync(path, record({ evidence: 'none' }).replace(
    /`scripts\/docs\/check-closure-record\.mjs` — `Every cited test name is really in the file cited beside it`/g, 'nothing'));
  const thin = runCheck(path);
  assert.ok(thin.errors.some((error) => /is not evidence/.test(error)), thin.errors.join('\n'));
  // ...and the single-row variant is NOT what triggers it, so the floor is about the record's whole
  // body rather than about any one row.
  assert.ok(!errors.some((error) => /is not evidence/.test(error)), errors.join('\n'));
});

test('a missing record fails rather than reporting a clean pass', () => {
  const { errors } = runCheck(join(mkdtempSync(join(tmpdir(), 'closure-record-gone-')), 'absent.md'));
  assert.ok(errors.some((error) => /closure record not found/.test(error)), errors.join('\n'));
});

// --- the classifier's own rules -------------------------------------------

test('a command, an identifier and an abbreviated quote are not test-name claims', () => {
  assert.equal(isTestNameClaim('npm run check:asset-licenses'), false);
  assert.equal(isTestNameClaim('VIEWER_SERVABLE_PUBLICATION_STATUSES'), false);
  assert.equal(isTestNameClaim('AC#6 …its summary is on screen'), false);
  assert.equal(isTestNameClaim('parse → normalize → validate → commit'), false);
  assert.equal(isTestNameClaim('short one'), false);
  // ...and a real title is.
  assert.equal(isTestNameClaim('publishes animationState "walking" before arrival'), true);
});

test('a describe() wrapper is stripped, so the record may quote a title either way', () => {
  assert.equal(
    searchableTestName("describe('AC#5 — public viewing adds no LLM trace')"),
    'AC#5 — public viewing adds no LLM trace',
  );
  assert.equal(searchableTestName('a bare title stays as it is'), 'a bare title stays as it is');
});

test('a verdict is read from its own cell, so prose cannot supply one', () => {
  assert.equal(verdictOf('**PASS**'), 'PASS');
  assert.equal(verdictOf('EXTERNAL_BLOCKED'), 'EXTERNAL_BLOCKED');
  assert.equal(verdictOf('PASS, mostly'), null);
});

test('the header row and the separator are not counted as data', () => {
  const rows = tableRows(`## 3. The thirty-one criteria\n\n| # | a | b | c |\n${SEP4}\n| 1 | x | PASS | y |\n`,
    '## 3. The thirty-one criteria');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], '1');
});

// --- the real document -----------------------------------------------------

test('the closure record in the repository agrees with itself and with the tree', () => {
  const { errors, counts } = runCheck(RECORD_PATH);
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(counts.citedTestNames >= 20,
    `expected the real record to cite real tests, found ${counts.citedTestNames}`);
});
