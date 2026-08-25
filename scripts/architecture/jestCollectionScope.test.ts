/**
 * The test runner's own collection scope.
 *
 * This exists because the defect it pins was invisible in exactly the way that matters: it never
 * failed CI, and locally it made `npm run check` *slower and wrong* rather than red.
 *
 * `.claude/worktrees/` holds linked git worktrees — complete checkouts of other branches, each
 * carrying its own copy of every spec in the repo. Jest walks `rootDir` on disk and has no way to
 * tell a worktree from a source directory, so a run in the main checkout collected 958 test files
 * instead of 164 — 794 of them belonging to branches that were not checked out.
 *
 * Two consequences, and the second is why this is a correctness test rather than a performance
 * one:
 *
 *   1. The run took over fifteen minutes instead of forty-one seconds.
 *   2. The gate reported on code that is not in the working tree. An unrelated branch mid-refactor
 *      turns `npm run check` red for reasons the developer running it cannot see, and a stale copy
 *      of a spec can report green for a file that no longer exists.
 *
 * CI never caught it because `.claude/worktrees/` is gitignored, so no worktree exists there and
 * the collection scope is accidentally correct on a clean clone. The defect appeared only for
 * whoever was using worktrees — which, in an agent-driven workflow, is everyone.
 *
 * ## Why this reads the source text rather than importing the config
 *
 * `jest.config.ts` is the file that configures the transform, so it is not itself transformed the
 * way a source module is: importing it from a spec under the `default-esm` preset fails with
 * `ReferenceError: exports is not defined`. Reading the source is also the pin this repo already
 * uses where one module must not drift from another (`homeRoute.test.ts` reads
 * `storyOverlayModel.ts` the same way), and it asserts the thing that actually has to be true —
 * what the config *says* — rather than what one particular loader made of it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `process.cwd()` rather than `__dirname`: these specs run as real ESM under
// `--experimental-vm-modules`, where `__dirname` does not exist. `readOnlyWorldSurface.test.ts`
// resolves repo-root paths the same way, and Jest runs from `rootDir`.
const SOURCE = readFileSync(join(process.cwd(), 'jest.config.ts'), 'utf8');

/** The three projects the config declares. A fourth must fail this file rather than slip past. */
const PROJECTS = ['unit', 'a11y', 'dom'];

/** The pattern that must reach every project, spelled exactly as `jest.config.ts` spells it. */
const WORKTREE_PATTERN = "'<rootDir>/\\\\.claude/worktrees/'";

/** The body of one project block, from its `displayName` to the start of the next project. */
function projectBlock(name: string): string {
  const start = SOURCE.indexOf(`displayName: '${name}'`);
  expect(start).toBeGreaterThan(-1);
  const next = SOURCE.indexOf('displayName:', start + 1);
  return SOURCE.slice(start, next === -1 ? SOURCE.length : next);
}

describe('the test runner collects from this checkout only', () => {
  test('the shared exclusion list names both the worktree directory and node_modules', () => {
    // `node_modules` is listed rather than assumed: Jest's DEFAULT `testPathIgnorePatterns` is
    // `['/node_modules/']`, and setting the option REPLACES that default instead of extending it.
    // The `a11y` and `dom` projects had no `testPathIgnorePatterns` at all before this fix, so
    // adding a worktree pattern naively would have silently dropped the node_modules exclusion
    // they were relying on by default — a second, quieter version of the same bug.
    const declaration = SOURCE.match(/const IGNORED_PATHS = \[(.*?)\];/s);
    expect(declaration).not.toBeNull();
    expect(declaration?.[1]).toContain("'/node_modules/'");
    expect(declaration?.[1]).toContain(WORKTREE_PATTERN);
  });

  test('the config declares exactly the three known projects', () => {
    // The guarantee below is "EVERY project". Without this, a fourth project added later would
    // simply not be looked at, and the suite would keep passing while guaranteeing less.
    const declared = [...SOURCE.matchAll(/displayName: '([^']+)'/g)].map((match) => match[1]);
    expect(declared).toEqual(PROJECTS);
  });

  test.each(PROJECTS)('the %s project applies the shared exclusion list', (name) => {
    expect(projectBlock(name)).toContain('IGNORED_PATHS');
  });

  test('the pattern is anchored at the root rather than matched anywhere in a path', () => {
    // A bare `.claude/worktrees/` would also exclude a legitimate source path that happened to
    // contain those segments. `<rootDir>/` anchors it to this repository's own worktree directory.
    expect(WORKTREE_PATTERN.startsWith("'<rootDir>/")).toBe(true);
    expect(SOURCE).toContain(WORKTREE_PATTERN);
  });

  test('the dot in `.claude` is escaped, so the pattern cannot also match `xclaude`', () => {
    // These strings are regular expressions, not globs. An unescaped `.` matches any character,
    // making the exclusion broader than it reads — the kind of pattern that passes every test
    // anyone thinks to write and is still wrong.
    expect(SOURCE).toContain('\\\\.claude/worktrees/');
    expect(SOURCE).not.toMatch(/'<rootDir>\/\.claude\/worktrees\/'/);
  });
});
