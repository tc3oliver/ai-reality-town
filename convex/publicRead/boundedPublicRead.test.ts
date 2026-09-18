/**
 * A public read must not cost more because the world is older (ART-210).
 *
 * ## What happened
 *
 * `drainLivePostCommit` at its DEFAULT batch of three events exceeded Convex's 16 MB
 * per-transaction read limit on the acceptance deployment:
 *
 *     Uncaught Error: Too many bytes read in a single function execution (limit: 16777216 bytes)
 *
 * `drainAllLivePostCommit` — the cron — uses the same default, so the post-commit pipeline would
 * have failed on every tick the moment the world was promoted to `public`, and nothing would have
 * advanced.
 *
 * Measured against the deployment rather than guessed: mistwood's whole `publishedReadModels` table
 * was 3.19 MB across 415 rows, and its entire distinct data — every table the drain touches — was
 * about 3.5 MB. Thirteen megabytes of reads against three and a half megabytes of data means the
 * SAME rows, read again and again.
 *
 * `serveReadModel` was the repetition. It called `loadTargetVersions`, a `.collect()` of every
 * version a target had ever published, and then used exactly two of them: the current one and the
 * last-known-good one. `timeline:mistwood` alone was 1.48 MB across 82 versions, and it gains one
 * on every accepted event. Every internal caller paid it per event — `publishedEventSummaries`,
 * the display-name resolver once per character, the runtime snapshot reader — and so did every
 * public page view.
 *
 * ## What this file asserts, and why it counts rather than reads
 *
 * The fix is only worth anything if it holds. Asserting that the implementation calls a particular
 * method is a test of today's source; asserting how many ROWS the store was asked to hand over is a
 * test of the property. The store here counts what it served, so a reintroduced whole-history read
 * fails these cases whatever it is named.
 *
 * The decisive case is not "few rows" — it is that a target with three versions and a target with
 * three hundred cost the SAME.
 */

import {
  ReadModelError, SERVABLE_STATUS, serveReadModel,
  type PublicReadReadStore, type ReadModelKind, type ReadModelStatus, type StoredReadModel,
} from './readModel';

const WORLD = 'mistwood';
const KIND: ReadModelKind = 'timeline';
const REF = 'timeline:mistwood';

const version = (input: {
  version: number;
  status?: ReadModelStatus;
  isCurrent?: boolean;
  isLastKnownGood?: boolean;
}): StoredReadModel => ({
  id: `row-${input.version}`,
  schemaVersion: 1,
  worldId: WORLD,
  modelKind: KIND,
  modelRef: REF,
  version: input.version,
  payload: { entries: [`entry-${input.version}`] },
  status: input.status ?? SERVABLE_STATUS,
  sourceEventIds: [`mistwood#event#${input.version}`],
  isCurrent: input.isCurrent ?? false,
  isLastKnownGood: input.isLastKnownGood ?? false,
  contentHash: `hash-${input.version}`,
  createdAt: input.version,
  publishedAt: input.status === undefined || input.status === SERVABLE_STATUS ? input.version : null,
});

/**
 * A store that remembers how much it was asked for.
 *
 * It holds the target's whole history, exactly as the database does, so the bound being asserted is
 * a property of the CALLER rather than of a fixture that was too small to expose the problem.
 */
class CountingStore implements PublicReadReadStore {
  rowsServed = 0;
  calls: string[] = [];

  constructor(private readonly history: readonly StoredReadModel[]) {}

  private target(worldId: string, modelKind: ReadModelKind, modelRef: string): StoredReadModel[] {
    return this.history.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef);
  }

  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    this.calls.push('findCurrent');
    const row = this.target(worldId, modelKind, modelRef).find((candidate) => candidate.isCurrent) ?? null;
    if (row) this.rowsServed += 1;
    return Promise.resolve(row);
  }

  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    this.calls.push('loadLastKnownGood');
    const rows = this.target(worldId, modelKind, modelRef).filter((candidate) => candidate.isLastKnownGood);
    this.rowsServed += rows.length;
    return Promise.resolve(rows);
  }
}

/** `count` published versions, the newest current, the one before it retained as the fallback. */
const history = (count: number): StoredReadModel[] => Array.from({ length: count }, (_, index) => version({
  version: index + 1,
  isCurrent: index === count - 1,
  isLastKnownGood: index === count - 2,
}));

// =============================================================================
// The bound
// =============================================================================

describe('a served read costs the same however long the world has been running', () => {
  it('reads the same number of rows for three versions and for three hundred', async () => {
    /**
     * THE assertion. Every other case in this file is satisfiable by a read that is merely small;
     * only this one fails for a read that is proportional to history, which is what actually
     * exhausted the transaction budget.
     */
    const shortLived = new CountingStore(history(3));
    const longLived = new CountingStore(history(300));

    await serveReadModel(shortLived, WORLD, KIND, REF);
    await serveReadModel(longLived, WORLD, KIND, REF);

    expect(longLived.rowsServed).toBe(shortLived.rowsServed);
    // And small in absolute terms: the current row plus the single retained fallback.
    expect(longLived.rowsServed).toBe(2);
  });

  it('serves the newest version, not merely a cheap one', async () => {
    // A read that got the bound right by returning the wrong row would pass the count above.
    const store = new CountingStore(history(300));
    const served = await serveReadModel(store, WORLD, KIND, REF);
    expect(served?.version).toBe(300);
    expect(served?.servedFrom).toBe('current');
  });

  it('never asks for a target’s whole version history', async () => {
    // The named absence, so the reason survives a refactor that keeps the counts passing by
    // accident. `loadTargetVersions` is gone from the port; nothing may reintroduce it here.
    const store = new CountingStore(history(300));
    await serveReadModel(store, WORLD, KIND, REF);
    expect([...new Set(store.calls)].sort()).toEqual(['findCurrent', 'loadLastKnownGood']);
  });
});

// =============================================================================
// The selection rule is unchanged
// =============================================================================

describe('what is served is exactly what the whole-history rule served', () => {
  it('falls back to the last known good when the current version is withheld', async () => {
    const store = new CountingStore([
      version({ version: 1 }),
      version({ version: 2, isLastKnownGood: true }),
      version({ version: 3, status: 'withheld', isCurrent: true }),
    ]);
    const served = await serveReadModel(store, WORLD, KIND, REF);
    expect(served?.version).toBe(2);
    expect(served?.servedFrom).toBe('last_known_good');
  });

  it('prefers the current version over the fallback, whichever order they arrive in', async () => {
    /**
     * Written after an injection that did NOT bite. This case used to claim the current row had to
     * be concatenated first, because `selectServedVersion` is a `find` — and reversing the order in
     * `serveReadModel` changed nothing, because the rule makes two passes keyed on the FLAGS rather
     * than one pass over positions.
     *
     * So the property is stronger than the old claim and is asserted as such: the two bounded reads
     * may be combined in any order and a healthy world still serves its current version. A future
     * store that returned the fallback first cannot make this stale.
     */
    const current = version({ version: 3, isCurrent: true });
    const fallback = version({ version: 2, isLastKnownGood: true });
    for (const rows of [[current, fallback], [fallback, current]]) {
      expect((await serveReadModel(new CountingStore(rows), WORLD, KIND, REF))?.version).toBe(3);
    }
  });

  it('refuses a fallback that is flagged retained while not servable', async () => {
    // The guard the selection rule already carried: a read that trusted the flag another function
    // maintains would put withheld content back on the public surface.
    const store = new CountingStore([
      version({ version: 2, status: 'withheld', isLastKnownGood: true }),
      version({ version: 3, status: 'failed', isCurrent: true }),
    ]);
    expect(await serveReadModel(store, WORLD, KIND, REF)).toBeNull();
  });

  it('returns null when the target has never published anything', async () => {
    expect(await serveReadModel(new CountingStore([]), WORLD, KIND, REF)).toBeNull();
  });

  it('still validates the target before reading anything', async () => {
    const store = new CountingStore(history(3));
    await expect(serveReadModel(store, '   ', KIND, REF)).rejects.toThrow(ReadModelError);
    expect(store.rowsServed).toBe(0);
  });
});
