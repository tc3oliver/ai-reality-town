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
        '/node_modules/',
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
