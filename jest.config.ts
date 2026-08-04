import type { JestConfigWithTsJest } from 'ts-jest';

/**
 * Two Jest projects.
 *
 * - `unit` keeps the project-wide default: pure logic only, **no DOM
 *   environment**. Every existing `*.test.ts` runs here exactly as before.
 * - `a11y` (ART-93 / NFR-009) is the single, deliberately narrow exception.
 *   Accessibility cannot be asserted without real rendered markup, so
 *   `*.a11y.test.tsx` files — and only those — get `jsdom` plus `jest-axe`.
 *   The `unit` project ignores them, so the "we do not render components"
 *   convention still holds everywhere else. See `docs/accessibility.md`.
 */
const jestConfig: JestConfigWithTsJest = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest/presets/default-esm',
      testPathIgnorePatterns: ['/node_modules/', '\\.a11y\\.test\\.tsx$'],
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
  ],
};
export default jestConfig;
