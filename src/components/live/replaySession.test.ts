/**
 * "Has this replay already auto-played?" (FR-O013 / ART-121 AC#5).
 *
 * See `replaySession.ts`'s own header for why `sessionStorage` and why fail-closed. This suite
 * proves both properties directly against an injected `StorageLike`, so it needs no browser.
 */

import { hasAutoPlayed, markAutoPlayed, replaySessionStorage, type StorageLike } from './replaySession';

function memoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('AC#5 — a replay auto-plays at most once per viewing session', () => {
  test('false before marking, true after', () => {
    const storage = memoryStorage();
    expect(hasAutoPlayed('replay:mistwood:12', storage)).toBe(false);
    markAutoPlayed('replay:mistwood:12', storage);
    expect(hasAutoPlayed('replay:mistwood:12', storage)).toBe(true);
  });

  test('a different replayId is unaffected by another one having played', () => {
    const storage = memoryStorage();
    markAutoPlayed('replay:mistwood:12', storage);
    expect(hasAutoPlayed('replay:mistwood:13', storage)).toBe(false);
  });

  test('a newly completed slot (a new replayId) legitimately auto-plays again', () => {
    const storage = memoryStorage();
    markAutoPlayed('replay:mistwood:12', storage);
    expect(hasAutoPlayed('replay:mistwood:13', storage)).toBe(false);
    markAutoPlayed('replay:mistwood:13', storage);
    expect(hasAutoPlayed('replay:mistwood:12', storage)).toBe(true);
    expect(hasAutoPlayed('replay:mistwood:13', storage)).toBe(true);
  });

  test('marking is idempotent', () => {
    const storage = memoryStorage();
    markAutoPlayed('replay:mistwood:12', storage);
    markAutoPlayed('replay:mistwood:12', storage);
    expect(hasAutoPlayed('replay:mistwood:12', storage)).toBe(true);
  });

  test('an absent storage is treated as already played (fail closed)', () => {
    expect(hasAutoPlayed('replay:mistwood:12', null)).toBe(true);
    // markAutoPlayed on a null storage must not throw.
    expect(() => markAutoPlayed('replay:mistwood:12', null)).not.toThrow();
  });

  test('a storage that throws on read or write is treated as already played (fail closed)', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(hasAutoPlayed('replay:mistwood:12', throwing)).toBe(true);
    expect(() => markAutoPlayed('replay:mistwood:12', throwing)).not.toThrow();
  });

  test('a storage that reads fine but refuses every write is treated as already played', () => {
    const readOnly: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('refused');
      },
    };
    // hasAutoPlayed probes writability via the shared probe key, so it must not answer `false`
    // for a storage that cannot actually record the mark it is about to promise it will keep.
    expect(hasAutoPlayed('replay:mistwood:12', readOnly)).toBe(true);
  });

  test('an empty replayId is treated as already played', () => {
    expect(hasAutoPlayed('', memoryStorage())).toBe(true);
  });
});

describe('replaySessionStorage', () => {
  const globalWithStorage = globalThis as { sessionStorage?: unknown };

  afterEach(() => {
    Reflect.deleteProperty(globalWithStorage, 'sessionStorage');
  });

  test('returns null where the global does not exist', () => {
    Reflect.deleteProperty(globalWithStorage, 'sessionStorage');
    expect(replaySessionStorage()).toBeNull();
  });

  test('returns null rather than throwing when access itself throws', () => {
    Object.defineProperty(globalWithStorage, 'sessionStorage', {
      configurable: true,
      get(): never {
        throw new Error('blocked by browser policy');
      },
    });
    expect(replaySessionStorage()).toBeNull();
  });

  test('returns the storage when it exists', () => {
    const storage = memoryStorage();
    globalWithStorage.sessionStorage = storage;
    expect(replaySessionStorage()).toBe(storage);
  });
});
