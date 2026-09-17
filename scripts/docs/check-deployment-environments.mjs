#!/usr/bin/env node
/**
 * Hold the documentation to one vocabulary for the two Convex deployments.
 *
 * `colorless-deer-917` is Public Acceptance / Staging and `glorious-grasshopper-417` is Real
 * Production — but the Convex CLI calls the first `dev` and the second `prod`, so a doc that
 * repeats the CLI's words teaches the reader the opposite of the truth. That is not hypothetical:
 * an authorization checkpoint was run against acceptance and reported as a production result,
 * because the deployment doing the answering was never named.
 *
 * Four rules, each one a thing that actually went wrong or could:
 *
 * 1. `docs/deployment-environments.md` exists and maps both deployments to their roles.
 * 2. A document that names a deployment classifies it — acceptance, or production.
 * 3. No document calls `colorless-deer-917` production, or `glorious-grasshopper-417` acceptance.
 * 4. `npx convex deploy` is never shown without saying, nearby, that it targets production.
 *
 * Rule 4 is bounded to a window rather than the whole file on purpose: a file may legitimately
 * discuss production elsewhere, and "the word appears somewhere in this document" would pass on
 * exactly the runbook that needs the warning next to the command.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const REFERENCE = 'docs/deployment-environments.md';

export const ACCEPTANCE_DEPLOYMENT = 'colorless-deer-917';
export const PRODUCTION_DEPLOYMENT = 'glorious-grasshopper-417';

/** How many lines either side of a `npx convex deploy` count as "nearby" for rule 4. */
export const DEPLOY_WARNING_WINDOW = 12;

const ACCEPTANCE_WORDS = /acceptance|staging/i;
const PRODUCTION_WORDS = /production/i;

/** Every tracked markdown file under the roots documentation actually lives in. */
export function listDocs(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) out.push(relative(root, full));
    }
  };
  for (const dir of ['docs', 'backlog']) {
    const full = join(root, dir);
    try { if (statSync(full).isDirectory()) walk(full); } catch { /* absent is fine */ }
  }
  out.push('CLAUDE.md');
  return out.filter((file) => { try { statSync(join(root, file)); return true; } catch { return false; } });
}

/**
 * The problems in one document's text.
 *
 * Pure and exported so the test can drive it with strings instead of fixture files, which is what
 * lets the fault injections below be about the RULES rather than about the filesystem.
 */
export function problemsIn(file, text) {
  const problems = [];
  const lines = text.split('\n');

  const namesAcceptance = text.includes(ACCEPTANCE_DEPLOYMENT);
  const namesProduction = text.includes(PRODUCTION_DEPLOYMENT);

  // Rule 2 — a named deployment is a classified deployment.
  if (namesAcceptance && !ACCEPTANCE_WORDS.test(text)) {
    problems.push(`${file}: names ${ACCEPTANCE_DEPLOYMENT} without saying it is the acceptance/staging environment`);
  }
  if (namesProduction && !PRODUCTION_WORDS.test(text)) {
    problems.push(`${file}: names ${PRODUCTION_DEPLOYMENT} without saying it is real production`);
  }

  /**
   * Rule 3 — never the wrong classification on the same line.
   *
   * A line that mentions BOTH vocabularies is contrasting them, which is the correct thing to do
   * and is most of what the reference document says; only a line carrying one deployment and the
   * OTHER role alone is a mislabel. Without that exemption the rule flags every sentence that
   * explains the distinction, which is the opposite of what it is for.
   */
  lines.forEach((line, index) => {
    const saysAcceptance = ACCEPTANCE_WORDS.test(line);
    const saysProduction = /real production|production deployment|production environment/i.test(line);
    if (line.includes(ACCEPTANCE_DEPLOYMENT) && saysProduction && !saysAcceptance) {
      problems.push(`${file}:${index + 1}: calls ${ACCEPTANCE_DEPLOYMENT} production`);
    }
    if (line.includes(PRODUCTION_DEPLOYMENT) && saysAcceptance && !PRODUCTION_WORDS.test(line)) {
      problems.push(`${file}:${index + 1}: calls ${PRODUCTION_DEPLOYMENT} acceptance`);
    }
  });

  // Rule 4 — `npx convex deploy` always shown with what it targets.
  lines.forEach((line, index) => {
    if (!/npx convex deploy/.test(line)) return;
    const from = Math.max(0, index - DEPLOY_WARNING_WINDOW);
    const to = Math.min(lines.length, index + DEPLOY_WARNING_WINDOW + 1);
    const window = lines.slice(from, to).join('\n');
    if (!PRODUCTION_WORDS.test(window)) {
      problems.push(`${file}:${index + 1}: shows \`npx convex deploy\` without saying it targets production`);
    }
  });

  return problems;
}

/** Rule 1, checked against the reference document's own text. */
export function referenceProblems(text) {
  const problems = [];
  const required = [
    [ACCEPTANCE_DEPLOYMENT, 'the acceptance deployment name'],
    [PRODUCTION_DEPLOYMENT, 'the production deployment name'],
    ['npx convex run', 'what `npx convex run` targets'],
    ['npx convex dev --once', 'how acceptance is updated'],
    ['npx convex deploy', 'what deploys production'],
  ];
  for (const [needle, what] of required) {
    if (!text.includes(needle)) problems.push(`${REFERENCE}: missing ${what} (${needle})`);
  }
  if (!ACCEPTANCE_WORDS.test(text)) problems.push(`${REFERENCE}: never says "acceptance"`);
  if (!PRODUCTION_WORDS.test(text)) problems.push(`${REFERENCE}: never says "production"`);
  return problems;
}

export function check(root = ROOT) {
  let reference;
  try {
    reference = readFileSync(join(root, REFERENCE), 'utf8');
  } catch {
    return [`${REFERENCE} is missing — it is the one place the two deployments are classified`];
  }
  const problems = referenceProblems(reference);
  for (const file of listDocs(root)) {
    problems.push(...problemsIn(file, readFileSync(join(root, file), 'utf8')));
  }
  return problems;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-deployment-environments.mjs');
if (invokedDirectly) {
  const problems = check();
  if (problems.length > 0) {
    console.error(`check-deployment-environments: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-deployment-environments: ok');
}
