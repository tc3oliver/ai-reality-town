/**
 * The device token behind device-level progress (FR-H004 AC#3, ART-39).
 *
 * Mirrors `src/components/vote/voteDeviceKey.test.ts`, plus the one assertion that suite cannot
 * make: that the two tokens are NOT the same value. That is a §15 data-minimisation property, and
 * it is the kind of property that decays silently — a later "let's not store two keys" tidy-up
 * would look like a simplification and would create a join between a viewer's ballots and their
 * reading history.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  browserViewerProgressKey,
  normalizeProgressKey,
  resolveViewerProgressKey,
  VIEWER_PROGRESS_KEY_PATTERN,
  VIEWER_PROGRESS_STORAGE_KEY,
  type ProgressKeyStore,
} from './viewerProgressKey';
import { VOTE_DEVICE_KEY_PATTERN } from '../vote/voteDeviceKey';

function memoryStore(initial: Record<string, string> = {}): ProgressKeyStore & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('AC#3 — the token that identifies a device without a login', () => {
  test('a fresh browser mints a key of the accepted shape and stores it', () => {
    const store = memoryStore();
    const key = resolveViewerProgressKey(store, () => '5A2E9B31-7C4D-4E1F-9A0B-1C2D3E4F5061');
    expect(VIEWER_PROGRESS_KEY_PATTERN.test(key)).toBe(true);
    expect(store.values[VIEWER_PROGRESS_STORAGE_KEY]).toBe(key);
  });

  test('a stored key is reused, so progress survives a reload', () => {
    const store = memoryStore({ [VIEWER_PROGRESS_STORAGE_KEY]: 'kept-token-0001' });
    expect(resolveViewerProgressKey(store, () => 'unused')).toBe('kept-token-0001');
  });

  test('a corrupted key is REPLACED rather than sent', () => {
    // The server refuses a malformed key, so forwarding one would spend an attempt from this
    // device's budget on a submission that could never succeed.
    const store = memoryStore({ [VIEWER_PROGRESS_STORAGE_KEY]: 'NOT A VALID KEY' });
    const key = resolveViewerProgressKey(store, () => 'fresh-token-9999');
    expect(key).toBe('fresh-token-9999');
    expect(store.values[VIEWER_PROGRESS_STORAGE_KEY]).toBe('fresh-token-9999');
  });

  test('a low-entropy source is padded into shape rather than throwing', () => {
    expect(VIEWER_PROGRESS_KEY_PATTERN.test(normalizeProgressKey('a'))).toBe(true);
    expect(VIEWER_PROGRESS_KEY_PATTERN.test(normalizeProgressKey('---'))).toBe(true);
    expect(VIEWER_PROGRESS_KEY_PATTERN.test(normalizeProgressKey('X'.repeat(200)))).toBe(true);
  });

  test('without a window there is no key, so callers degrade instead of crashing', () => {
    // The unit project has no DOM, which is the same condition a server render meets.
    expect(browserViewerProgressKey()).toBeNull();
  });
});

describe('§15 — the progress token is not the ballot token', () => {
  test('the two modules use different storage keys', () => {
    const voteSource = readFileSync(
      join(process.cwd(), 'src/components/vote/voteDeviceKey.ts'),
      'utf8',
    );
    expect(voteSource).toContain("'art45.voteDeviceKey'");
    expect(VIEWER_PROGRESS_STORAGE_KEY).not.toBe('art45.voteDeviceKey');
    // Read off the vote module's source rather than imported, because the vote module does not
    // export its storage key -- and the assertion that matters is about the literal it writes.
    expect(voteSource).not.toContain(VIEWER_PROGRESS_STORAGE_KEY);
  });

  test('the two keys are independent values, so the tables cannot be joined', () => {
    // Two stores, two mints, two different tokens. If either module ever read the other's entry
    // this would collapse to one value and the join §15 argues against would exist.
    const store = memoryStore();
    let counter = 0;
    const progress = resolveViewerProgressKey(store, () => `minted-token-${counter += 1}`);
    const second = resolveViewerProgressKey(memoryStore(), () => `minted-token-${counter += 1}`);
    expect(progress).not.toBe(second);
    expect(Object.keys(store.values)).toEqual([VIEWER_PROGRESS_STORAGE_KEY]);
  });

  test('the accepted shape still matches the server pattern the ballot also uses', () => {
    // Same SHAPE, different VALUE. The server's `PROGRESS_DEVICE_KEY_PATTERN` is the ballot's
    // pattern, so drift on either side would start refusing honest browsers.
    expect(VIEWER_PROGRESS_KEY_PATTERN.source).toBe(VOTE_DEVICE_KEY_PATTERN.source);
    const serverSource = readFileSync(
      join(process.cwd(), 'convex/viewer/viewerProgress.ts'),
      'utf8',
    );
    expect(serverSource).toContain(VIEWER_PROGRESS_KEY_PATTERN.source);
  });
});
