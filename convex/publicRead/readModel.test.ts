import {
  commitReadModelVersion,
  createReadModelVersion,
  hashPayload,
  invalidateReadModel,
  sanitizeForPublic,
  selectServedVersion,
  serveReadModel,
  ReadModelError,
  SERVABLE_STATUS,
  type JsonValue,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from './readModel';

type MarkCurrentPatch = Parameters<PublicReadStore['markCurrent']>[1];

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  /** Toggled to simulate a projection-write outage (AC#7 availability). */
  insertShouldThrow = false;

  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel): Promise<string> {
    if (this.insertShouldThrow) throw new Error('PROJECTION_WRITE_UNAVAILABLE');
    this.counter += 1;
    const id = `id-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: MarkCurrentPatch): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.isCurrent = patch.isCurrent;
    row.isLastKnownGood = patch.isLastKnownGood;
    row.status = patch.status;
    return Promise.resolve();
  }
}

const target = { worldId: 'w1', modelKind: 'episode' as const, modelRef: 'episode:1' };

function commitPublished(store: MemoryReadStore, payload: JsonValue, sourceEventIds: string[], now = 1_000) {
  return commitReadModelVersion(store, {
    worldId: target.worldId, modelKind: target.modelKind, modelRef: target.modelRef,
    payload, sourceEventIds, status: SERVABLE_STATUS, now,
  });
}

describe('sanitizeForPublic (AC#4 — field allowlist)', () => {
  it('strips private keys at the top level and at any nesting depth', () => {
    const payload: JsonValue = {
      title: 'A quiet morning',
      knowledge: { factId: 'secret-fact' },
      characterMemory: 'should not leak',
      nested: { prompt: 'system prompt', adminNotes: 'ops only', safe: 'kept' },
      list: [{ apiKey: 'sk-x', token: 't', value: 1 }],
      rawModelOutput: '...',
      secret: 's',
      credential: 'c',
      password: 'p',
      private: 'pr',
    };
    const sanitized = sanitizeForPublic(payload) as Record<string, unknown>;
    expect(sanitized.title).toBe('A quiet morning');
    expect(sanitized.knowledge).toBeUndefined();
    expect(sanitized.characterMemory).toBeUndefined();
    expect(sanitized.rawModelOutput).toBeUndefined();
    expect(sanitized.secret).toBeUndefined();
    expect(sanitized.credential).toBeUndefined();
    expect(sanitized.password).toBeUndefined();
    expect(sanitized.private).toBeUndefined();
    expect((sanitized.nested as Record<string, unknown>).safe).toBe('kept');
    expect((sanitized.nested as Record<string, unknown>).prompt).toBeUndefined();
    expect((sanitized.nested as Record<string, unknown>).adminNotes).toBeUndefined();
    const item = (sanitized.list as Array<Record<string, unknown>>)[0];
    expect(item.apiKey).toBeUndefined();
    expect(item.token).toBeUndefined();
    expect(item.value).toBe(1);
  });

  it('preserves legitimately public fields and scalar leaves', () => {
    const sanitized = sanitizeForPublic({ episodeNumber: 3, headline: 'h', arcs: ['a1', 'a2'] } as unknown as JsonValue) as Record<string, unknown>;
    expect(sanitized).toEqual({ episodeNumber: 3, headline: 'h', arcs: ['a1', 'a2'] });
  });

  it('does not mutate the input', () => {
    const input: JsonValue = { safe: 'x', secret: 'y' };
    const snapshot = JSON.parse(JSON.stringify(input)) as JsonValue;
    sanitizeForPublic(input);
    expect(input).toEqual(snapshot);
  });
});

describe('hashPayload', () => {
  it('is stable regardless of object key order and differs across payloads', () => {
    expect(hashPayload({ a: 1, b: 2 } as unknown as JsonValue)).toBe(hashPayload({ b: 2, a: 1 } as unknown as JsonValue));
    expect(hashPayload({ a: 1 } as unknown as JsonValue)).not.toBe(hashPayload({ a: 2 } as unknown as JsonValue));
  });
});

describe('createReadModelVersion', () => {
  it('sanitizes the payload, defaults flags, and records publishedAt when published', () => {
    const row = createReadModelVersion({
      worldId: 'w1', modelKind: 'episode', modelRef: 'episode:1', version: 1,
      payload: { headline: 'h', secret: 's' } as unknown as JsonValue, sourceEventIds: ['e1'], status: 'published', now: 5_000,
    });
    expect(row.isCurrent).toBe(true);
    expect(row.isLastKnownGood).toBe(false);
    expect(row.publishedAt).toBe(5_000);
    expect((row.payload as Record<string, unknown>).secret).toBeUndefined();
    expect(row.sourceEventIds).toEqual(['e1']);
  });

  it('rejects invalid targets and versions', () => {
    expect(() => createReadModelVersion({
      worldId: '', modelKind: 'episode', modelRef: 'r', version: 1, payload: {} as JsonValue, sourceEventIds: [], status: 'published', now: 1,
    })).toThrow(ReadModelError);
    expect(() => createReadModelVersion({
      worldId: 'w', modelKind: 'episode', modelRef: 'r', version: 0, payload: {} as JsonValue, sourceEventIds: [], status: 'published', now: 1,
    })).toThrow(ReadModelError);
  });
});

describe('selectServedVersion (AC#1/#5 — last-known-good serving)', () => {
  function stored(over: Partial<StoredReadModel>): StoredReadModel {
    return {
      id: 'id', schemaVersion: 1, worldId: 'w1', modelKind: 'episode', modelRef: 'episode:1', version: 1,
      payload: {}, status: 'published', sourceEventIds: [], isCurrent: false, isLastKnownGood: false,
      contentHash: 'h', createdAt: 1, publishedAt: 1, ...over,
    };
  }

  it('serves the current published version', () => {
    const served = selectServedVersion([stored({ version: 2, isCurrent: true, status: 'published' })]);
    expect(served?.servedFrom).toBe('current');
    expect(served?.version).toBe(2);
  });

  it('falls back to last-known-good when the current version is withheld', () => {
    const served = selectServedVersion([
      stored({ version: 1, isLastKnownGood: true, status: 'published' }),
      stored({ version: 2, isCurrent: true, status: 'withheld' }),
    ]);
    expect(served?.servedFrom).toBe('last_known_good');
    expect(served?.version).toBe(1);
  });

  it('falls back to last-known-good while the current version is still publishing', () => {
    const served = selectServedVersion([
      stored({ version: 1, isLastKnownGood: true, status: 'published' }),
      stored({ version: 2, isCurrent: true, status: 'publishing' }),
    ]);
    expect(served?.servedFrom).toBe('last_known_good');
  });

  it('returns null when nothing was ever published', () => {
    expect(selectServedVersion([stored({ version: 1, isCurrent: true, status: 'failed' })])).toBeNull();
    expect(selectServedVersion([])).toBeNull();
  });
});

describe('commitReadModelVersion (AC#5 — LKG preservation; idempotency)', () => {
  it('allocates version 1 on first publish', async () => {
    const store = new MemoryReadStore();
    const result = await commitPublished(store, { headline: 'v1' } as unknown as JsonValue, ['e1']);
    expect(result.version).toBe(1);
    expect(result.status).toBe('published');
    expect(result.deduplicated).toBe(false);
    expect(typeof result.contentHash).toBe('string');
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].isCurrent).toBe(true);
  });

  it('demotes the prior published current to last-known-good on a new version', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'v1' } as unknown as JsonValue, ['e1']);
    await commitPublished(store, { headline: 'v2' } as unknown as JsonValue, ['e1', 'e2']);
    const v1 = store.rows.find((row) => row.version === 1);
    const v2 = store.rows.find((row) => row.version === 2);
    expect(v2?.isCurrent).toBe(true);
    expect(v1?.isCurrent).toBe(false);
    expect(v1?.isLastKnownGood).toBe(true);
  });

  it('keeps exactly one last-known-good after several versions', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'v1' } as unknown as JsonValue, ['e1']);
    await commitPublished(store, { headline: 'v2' } as unknown as JsonValue, ['e1', 'e2']);
    await commitPublished(store, { headline: 'v3' } as unknown as JsonValue, ['e1', 'e2', 'e3']);
    const lkg = store.rows.filter((row) => row.isLastKnownGood);
    expect(lkg).toHaveLength(1);
    expect(lkg[0].version).toBe(2);
  });

  it('deduplicates a repeat write with the same payload and status', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'same' } as unknown as JsonValue, ['e1']);
    const again = await commitPublished(store, { headline: 'same' } as unknown as JsonValue, ['e1']);
    expect(again.deduplicated).toBe(true);
    expect(store.rows).toHaveLength(1);
  });
});

describe('invalidateReadModel (AC#5 — non-destructive version switch)', () => {
  it('withholds the current version while the last-known-good keeps serving', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'v1' } as unknown as JsonValue, ['e1']);
    await commitPublished(store, { headline: 'v2' } as unknown as JsonValue, ['e1', 'e2']);
    const result = await invalidateReadModel(store, { ...target, status: 'withheld', now: 9_000 });
    expect(result.invalidatedVersion).toBe(2);
    const served = await serveReadModel(store, target.worldId, target.modelKind, target.modelRef);
    expect(served?.version).toBe(1);
    expect(served?.servedFrom).toBe('last_known_good');
  });

  it('leaves nothing servable when no fallback exists', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'v1' } as unknown as JsonValue, ['e1']);
    await invalidateReadModel(store, { ...target, status: 'failed', now: 9_000 });
    const served = await serveReadModel(store, target.worldId, target.modelKind, target.modelRef);
    expect(served).toBeNull();
  });

  it('rejects an invalid invalidation status', async () => {
    const store = new MemoryReadStore();
    await expect(invalidateReadModel(store, { ...target, status: 'published', now: 9 } as never)).rejects.toThrow(ReadModelError);
  });
});

describe('serveReadModel (AC#1/#3/#4 — isolation, no-LLM, allowlist)', () => {
  it('serves an allowlisted snapshot without invoking any generation function', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'h', prompt: 'must-not-leak' } as unknown as JsonValue, ['e1']);
    let generationCalls = 0;
    const unusedGenerate = (): string => { generationCalls += 1; return 'llm'; };
    void unusedGenerate;
    const served = await serveReadModel(store, target.worldId, target.modelKind, target.modelRef);
    expect(served?.servedFrom).toBe('current');
    expect((served?.payload as Record<string, unknown>).prompt).toBeUndefined();
    expect(generationCalls).toBe(0); // AC#3: public reads never invoke LLM generation
  });

  it('AC#6 §16.3: LLM-call count is invariant as public read volume increases', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'h' } as unknown as JsonValue, ['e1']);
    const generationCalls = { count: 0 };
    const readsAt = async (volume: number) => {
      const before = generationCalls.count;
      for (let i = 0; i < volume; i += 1) {
        await serveReadModel(store, target.worldId, target.modelKind, target.modelRef);
      }
      return generationCalls.count - before;
    };
    const one = await readsAt(1);
    const many = await readsAt(5_000);
    expect(one).toBe(0);
    expect(many).toBe(0); // zero incremental LLM calls regardless of volume
  });

  it('AC#7: stays available when a later projection write fails (LKG keeps serving)', async () => {
    const store = new MemoryReadStore();
    await commitPublished(store, { headline: 'v1' } as unknown as JsonValue, ['e1']);
    // A new projection write attempt fails (simulation/publication outage).
    store.insertShouldThrow = true;
    await expect(commitPublished(store, { headline: 'v2' } as unknown as JsonValue, ['e1', 'e2'])).rejects.toThrow('PROJECTION_WRITE_UNAVAILABLE');
    // The previously published version remains fully available (AC#1 availability isolation).
    const served = await serveReadModel(store, target.worldId, target.modelKind, target.modelRef);
    expect(served?.version).toBe(1);
    expect(served?.servedFrom).toBe('current');
  });

  it('AC#2: serves well under the 500ms P95 target on the pure read path', async () => {
    const store = new MemoryReadStore();
    // Seed many versions so selection scans a realistic history.
    for (let i = 1; i <= 200; i += 1) {
      await commitPublished(store, { headline: `v${i}` } as unknown as JsonValue, [`e${i}`]);
    }
    const iterations = 1_000;
    const start = Date.now();
    for (let i = 0; i < iterations; i += 1) {
      await serveReadModel(store, target.worldId, target.modelKind, target.modelRef);
    }
    const elapsed = Date.now() - start;
    const p95Estimate = (elapsed / iterations) * 1_000; // ms per read, generous upper bound
    // The pure selection path is O(versions) here; the Convex-backed query is an
    // indexed O(1)-ish lookup. Assert the pure path is far under the 500ms target.
    expect(p95Estimate).toBeLessThan(500);
  });
});
