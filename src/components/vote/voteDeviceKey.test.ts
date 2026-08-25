/**
 * FR-J001 AC#2 — the browser half of the per-device limit (ART-45).
 *
 * The token this module produces is the value the server rate-limits on, so the two sides
 * agreeing on its shape is load-bearing: a browser that mints a key the server refuses would
 * spend its whole attempt budget on submissions that could never succeed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  normalizeDeviceKey,
  resolveVoteDeviceKey,
  VOTE_DEVICE_KEY_PATTERN,
  type KeyStore,
} from './voteDeviceKey';

function memoryStore(initial: Record<string, string> = {}): KeyStore & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
  };
}

const UUID = '9f3a1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b';

describe('the vote device token', () => {
  test('mints and stores a conforming key on first use', () => {
    const store = memoryStore();
    const key = resolveVoteDeviceKey(store, () => UUID);
    expect(key).toBe(UUID);
    expect(VOTE_DEVICE_KEY_PATTERN.test(key)).toBe(true);
    expect(Object.values(store.values)).toEqual([UUID]);
  });

  test('reuses the stored key, so a device stays one device across visits', () => {
    const store = memoryStore();
    const first = resolveVoteDeviceKey(store, () => UUID);
    const second = resolveVoteDeviceKey(store, () => 'a-different-uuid-entirely');
    expect(second).toBe(first);
  });

  test('a stored key that no longer conforms is replaced rather than sent', () => {
    // Sending it would spend one of this device's attempts on a submission the server refuses
    // outright, so a browser with a corrupted entry would lock itself out of voting.
    const store = memoryStore({ 'art45.voteDeviceKey': 'NOT VALID!!' });
    const key = resolveVoteDeviceKey(store, () => UUID);
    expect(key).toBe(UUID);
  });

  test('any random source is forced into the accepted shape', () => {
    for (const raw of ['', 'AB', '!!!', '---', 'Ω', 'A'.repeat(200), '  spaced  out  ']) {
      const normalized = normalizeDeviceKey(raw);
      expect(VOTE_DEVICE_KEY_PATTERN.test(normalized)).toBe(true);
    }
  });

  test('the client pattern is byte-identical to the server one', () => {
    // Restated in two modules because `clientViewerWrite` may reference the server module's
    // types but the regex itself is not exported from it. A drifting restatement would be
    // invisible until a browser started failing every vote, so the two are compared here.
    const server = readFileSync(join(process.cwd(), 'convex/viewer/environmentVote.ts'), 'utf8');
    const declared = server.match(/const DEVICE_KEY_PATTERN = (\/.+\/);/)?.[1];
    expect(declared).toBe(VOTE_DEVICE_KEY_PATTERN.toString());
  });

  test('the token carries nothing about the device', () => {
    // §15 data minimisation. It is a random string, not a fingerprint: two calls in the same
    // environment with different random sources must not converge.
    const a = resolveVoteDeviceKey(memoryStore(), () => UUID);
    const b = resolveVoteDeviceKey(memoryStore(), () => 'b1c2d3e4-0000-0000-0000-000000000000');
    expect(a).not.toBe(b);
  });
});
