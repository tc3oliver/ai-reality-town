import type { JestConfigWithTsJest } from 'ts-jest';

/**
 * Three Jest projects.
 *
 * - `unit` keeps the project-wide default: pure logic only, **no DOM
 *   environment**. Every existing `*.test.ts` runs here exactly as before.
 * - `a11y` (ART-93 / NFR-009) is the accessibility exception. Accessibility
 *   cannot be asserted without real rendered markup, so `*.a11y.test.tsx`
 *   files — and only those — get `jsdom` plus `jest-axe`. See
 *   `docs/accessibility.md`.
 * - `dom` (ART-113 / FR-N002) is the second narrow exception, for `*.dom.test.tsx`.
 *   The PixiJS world shell cannot even be *imported* without a DOM global
 *   (`pixi-viewport` touches `window` at module load), and what its components
 *   return has to be checked by calling them. These specs overwhelmingly mount
 *   nothing: they call a component as a function and inspect the element tree.
 *
 *   ART-124 added the ONE exception, `characterCardFocus.dom.test.tsx`, which
 *   mounts through `react-dom/client` and dispatches a real click. It exists
 *   because focus management is the one claim neither other harness can reach:
 *   `a11y` renders through `renderToStaticMarkup`, which runs no effect and
 *   delivers no event, so it can prove the card is *focusable* but never that
 *   focus *moves*. Mount only when the assertion is genuinely about what the
 *   browser does after an interaction — everything else stays a pure call.
 *
 * The `unit` project ignores both `.a11y.test.tsx` and `.dom.test.tsx`.
 */
/**
 * Paths no project may collect tests from.
 *
 * `.claude/worktrees/` holds linked git worktrees — full checkouts of OTHER branches, each with
 * its own copy of every spec. Jest walks `rootDir` on disk and cannot tell a worktree from a
 * source directory, so without this a run in the main checkout collects every branch's suites
 * too. That is not merely slow (a five-worktree tree took over fifteen minutes against forty-one
 * seconds clean): it makes the gate report on code that is not in the working tree, so an
 * unrelated branch mid-refactor can turn `npm run check` red — or a stale copy can stay green —
 * for reasons the developer running it cannot see.
 *
 * CI never hit this because `.claude/worktrees/` is gitignored and no worktree exists there, so
 * the defect was local-only and silent, which is exactly why it survived.
 *
 * Every project must repeat these: Jest's `testPathIgnorePatterns` DEFAULT is
 * `['/node_modules/']`, and setting the option replaces the default rather than extending it —
 * so `node_modules` is listed here rather than assumed.
 */
const IGNORED_PATHS = ['/node_modules/', '<rootDir>/\\.claude/worktrees/'];

const jestConfig: JestConfigWithTsJest = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest/presets/default-esm',
      // `<rootDir>/e2e/` is the Playwright suite (ART-137), which needs a browser and its own
      // runner. Anchored at the root on purpose: `src/e2e/` holds ORDINARY unit tests — the
      // ones that validate the fixture against the production assertions — and those must
      // keep running here, which a bare '/e2e/' pattern would have silently stopped.
      testPathIgnorePatterns: [
        ...IGNORED_PATHS,
        '<rootDir>/e2e/',
        '\\.a11y\\.test\\.tsx$',
        '\\.dom\\.test\\.tsx$',
      ],
    },
    {
      displayName: 'a11y',
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'jest-environment-jsdom',
      testMatch: ['**/*.a11y.test.tsx'],
      testPathIgnorePatterns: IGNORED_PATHS,
      setupFilesAfterEnv: ['<rootDir>/jest.a11y.setup.ts'],
      // The repo tsconfig uses `jsx: preserve` (Vite compiles JSX at build
      // time). ts-jest must emit real JS, so JSX is compiled here only.
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { jsx: 'react-jsx' } }],
      },
    },
    {
      displayName: 'dom',
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'jest-environment-jsdom',
      testMatch: ['**/*.dom.test.tsx'],
      testPathIgnorePatterns: IGNORED_PATHS,
      // `pixi-viewport`'s `main` is a UMD bundle whose named exports Node's ESM
      // loader cannot see. Vite resolves the package's `module` field; point
      // Jest at the same file so both load one build of the viewport.
      moduleNameMapper: {
        '^pixi-viewport$': 'pixi-viewport/dist/pixi_viewport.js',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { jsx: 'react-jsx' } }],
      },
    },
  ],
};
export default jestConfig;
