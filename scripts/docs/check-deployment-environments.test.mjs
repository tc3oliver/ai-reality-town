/**
 * The deployment-vocabulary gate actually bites.
 *
 * Every case below is a thing that really happened or is one edit away from happening. The gate
 * exists because an authorization checkpoint was run against Public Acceptance and reported as a
 * production result — so a gate that passed on the document that caused that would be worse than
 * none.
 *
 * `problemsIn` and `referenceProblems` are pure over a string, which is what lets these drive the
 * RULES directly instead of writing fixture files and hoping the walk finds them.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ACCEPTANCE_DEPLOYMENT,
  PRODUCTION_DEPLOYMENT,
  check,
  problemsIn,
  referenceProblems,
} from './check-deployment-environments.mjs';

test('the repository passes its own gate', () => {
  assert.deepEqual(check(), []);
});

test('a deployment named without a role is a problem', () => {
  const problems = problemsIn('d.md', `A reading was taken from \`${ACCEPTANCE_DEPLOYMENT}\`.`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /without saying it is the acceptance\/staging environment/);
});

test('naming it WITH its role is fine', () => {
  assert.deepEqual(
    problemsIn('d.md', `Taken from \`${ACCEPTANCE_DEPLOYMENT}\`, the acceptance environment.`),
    [],
  );
});

test('calling acceptance "production" is a problem', () => {
  // The exact mislabel that started this.
  const problems = problemsIn('d.md', `The production deployment \`${ACCEPTANCE_DEPLOYMENT}\` serves mistwood.`);
  assert.ok(problems.some((p) => /calls colorless-deer-917 production/.test(p)));
});

test('a line that CONTRASTS the two is not a problem', () => {
  /**
   * The exemption, and the reason it exists: without it the rule fires on every sentence that
   * explains the distinction, which is most of the reference document — a gate that punishes the
   * documentation it is trying to produce.
   */
  assert.deepEqual(
    problemsIn('d.md', `\`${ACCEPTANCE_DEPLOYMENT}\` is the acceptance environment, not the production deployment.`),
    [],
  );
});

test('calling production "staging" is a problem', () => {
  const problems = problemsIn('d.md', `The staging deployment \`${PRODUCTION_DEPLOYMENT}\`.`);
  assert.ok(problems.some((p) => /calls glorious-grasshopper-417 acceptance/.test(p)));
});

test('`npx convex deploy` shown with no mention of production is a problem', () => {
  const problems = problemsIn('d.md', ['# Runbook', '', '```bash', 'npx convex deploy', '```'].join('\n'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /without saying it targets production/);
});

test('`npx convex deploy` shown WITH the warning is fine', () => {
  const text = ['This targets real production.', '', '```bash', 'npx convex deploy', '```'].join('\n');
  assert.deepEqual(problemsIn('d.md', text), []);
});

test('the warning must be NEARBY, not merely somewhere in the file', () => {
  /**
   * A file may discuss production in an unrelated section. "The word appears somewhere" would
   * pass on exactly the runbook that needs the warning beside the command, so the window is
   * bounded — and this proves the bound is real rather than nominal.
   */
  const far = ['This document is about production.', ...Array(40).fill(''), 'npx convex deploy'].join('\n');
  const problems = problemsIn('d.md', far);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /without saying it targets production/);
});

test('the reference document must map both deployments and all three commands', () => {
  const problems = referenceProblems('# Environments\n\nNothing useful here.\n');
  const missing = problems.join(' | ');
  for (const needle of [ACCEPTANCE_DEPLOYMENT, PRODUCTION_DEPLOYMENT, 'npx convex run', 'npx convex dev --once', 'npx convex deploy']) {
    assert.ok(missing.includes(needle), `expected the reference check to demand ${needle}`);
  }
});

test('a complete reference document satisfies the reference check', () => {
  const text = [
    `\`${ACCEPTANCE_DEPLOYMENT}\` is acceptance/staging.`,
    `\`${PRODUCTION_DEPLOYMENT}\` is real production.`,
    '`npx convex run` targets the dev slot.',
    '`npx convex dev --once` updates acceptance.',
    '`npx convex deploy` targets production.',
  ].join('\n');
  assert.deepEqual(referenceProblems(text), []);
});
