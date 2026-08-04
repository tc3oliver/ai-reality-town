/**
 * Setup for the `a11y` Jest project only (ART-93 / NFR-009).
 *
 * jsdom does not expose `TextEncoder`/`TextDecoder`, which `react-dom/server`
 * requires, so they are bridged in from Node. Also registers the `jest-axe`
 * matcher so specs can assert `toHaveNoViolations()`.
 */
import { TextDecoder, TextEncoder } from 'node:util';
// `jest-axe` ships CommonJS only, so it is loaded through the default interop.
import jestAxe from 'jest-axe';

const globals = globalThis as unknown as Record<string, unknown>;
if (globals.TextEncoder === undefined) globals.TextEncoder = TextEncoder;
if (globals.TextDecoder === undefined) globals.TextDecoder = TextDecoder;

expect.extend(jestAxe.toHaveNoViolations);
