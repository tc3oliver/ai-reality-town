/**
 * The operator control model (FR-Q002 / ART-134).
 *
 * The ledger is append-only and the effective state is REPLAYED from it, so the tests that
 * matter are the ones about replay: that a release is a row rather than a deletion, that the
 * newest row wins per control, and that the account survives either way. A mutable
 * `hidden: boolean` would pass a "is it hidden" test and destroy everything else.
 */

import {
  DYNAMIC_CONTROL_KINDS,
  DynamicViewControlError,
  NO_DYNAMIC_VIEW_CONTROLS,
  applyDynamicViewControls,
  assertDynamicViewControlEntry,
  resolveDynamicViewControlRows,
  resolveDynamicViewControls,
  type DynamicViewControlEntry,
} from './dynamicViewControls';

const WORLD = 'mistwood';

function entry(overrides: Partial<DynamicViewControlEntry> = {}): DynamicViewControlEntry {
  return {
    worldId: WORLD,
    kind: 'pause_updates',
    target: null,
    engaged: true,
    reason: 'incident 42',
    actor: 'ops-1',
    createdAt: 1_000,
    ...overrides,
  };
}

describe('replaying the ledger', () => {
  test('an empty ledger engages nothing', () => {
    expect(resolveDynamicViewControls([])).toEqual(NO_DYNAMIC_VIEW_CONTROLS);
  });

  test('each control kind engages its own field', () => {
    const resolved = resolveDynamicViewControls([
      entry({ kind: 'pause_updates' }),
      entry({ kind: 'pin_snapshot' }),
      entry({ kind: 'hide_character', target: 'he-jun' }),
      entry({ kind: 'hide_scene', target: '7:evening:mistwood-mill' }),
    ]);
    expect(resolved.updatesPaused).toBe(true);
    expect(resolved.snapshotPinned).toBe(true);
    expect([...resolved.hiddenCharacterIds]).toEqual(['he-jun']);
    expect([...resolved.hiddenSceneIds]).toEqual(['7:evening:mistwood-mill']);
  });

  test('a release is a ROW, and the newest row wins', () => {
    const resolved = resolveDynamicViewControls([
      entry({ kind: 'hide_character', target: 'he-jun', engaged: true, createdAt: 1_000 }),
      entry({ kind: 'hide_character', target: 'he-jun', engaged: false, createdAt: 2_000 }),
    ]);
    expect(resolved.hiddenCharacterIds.size).toBe(0);
  });

  test('and re-engaging after a release works, because nothing was deleted', () => {
    const resolved = resolveDynamicViewControls([
      entry({ kind: 'hide_character', target: 'he-jun', engaged: true, createdAt: 1_000 }),
      entry({ kind: 'hide_character', target: 'he-jun', engaged: false, createdAt: 2_000 }),
      entry({ kind: 'hide_character', target: 'he-jun', engaged: true, createdAt: 3_000 }),
    ]);
    expect([...resolved.hiddenCharacterIds]).toEqual(['he-jun']);
  });

  test('rows out of order resolve by createdAt, not by array position', () => {
    // The store returns index order, which for an append-only table is insertion order — but a
    // resolver that depended on that would break the first time anything collected differently.
    const resolved = resolveDynamicViewControls([
      entry({ kind: 'pause_updates', engaged: false, createdAt: 5_000 }),
      entry({ kind: 'pause_updates', engaged: true, createdAt: 1_000 }),
    ]);
    expect(resolved.updatesPaused).toBe(false);
  });

  test('two targets of the same kind are independent', () => {
    const resolved = resolveDynamicViewControls([
      entry({ kind: 'hide_character', target: 'he-jun', engaged: true, createdAt: 1_000 }),
      entry({ kind: 'hide_character', target: 'pei-lan', engaged: true, createdAt: 2_000 }),
      entry({ kind: 'hide_character', target: 'he-jun', engaged: false, createdAt: 3_000 }),
    ]);
    // Releasing one must not release the other, which keying only on `kind` would do.
    expect([...resolved.hiddenCharacterIds]).toEqual(['pei-lan']);
  });

  test('a character and a scene sharing an id string do not collide', () => {
    const resolved = resolveDynamicViewControls([
      entry({ kind: 'hide_character', target: 'ambiguous', engaged: true, createdAt: 1_000 }),
      entry({ kind: 'hide_scene', target: 'ambiguous', engaged: false, createdAt: 2_000 }),
    ]);
    expect(resolved.hiddenCharacterIds.has('ambiguous')).toBe(true);
    expect(resolved.hiddenSceneIds.has('ambiguous')).toBe(false);
  });

  test('a stored row with an unrecognised kind is ignored, not crashed on', () => {
    // A row written by a future version. Dropping it keeps the current build serving; throwing
    // would take the whole projection rebuild down for a control it does not understand.
    const resolved = resolveDynamicViewControlRows([
      { worldId: WORLD, kind: 'invented_later', engaged: true, reason: 'r', actor: 'a', createdAt: 1 },
      { worldId: WORLD, kind: 'pause_updates', engaged: true, reason: 'r', actor: 'a', createdAt: 2 },
    ]);
    expect(resolved.updatesPaused).toBe(true);
  });
});

describe('validation refuses rows that would misdescribe what was asked for', () => {
  test('a targeted control needs a target', () => {
    expect(() => assertDynamicViewControlEntry(entry({ kind: 'hide_character', target: null })))
      .toThrow(DynamicViewControlError);
  });

  test('a world-wide control takes none', () => {
    // Normalising instead would put a row in the audit trail that does not describe what anyone
    // asked for, which is the one thing an audit trail must not do.
    expect(() => assertDynamicViewControlEntry(entry({ kind: 'pause_updates', target: 'he-jun' })))
      .toThrow(DynamicViewControlError);
  });

  test('every privileged row states why (NFR-005)', () => {
    expect(() => assertDynamicViewControlEntry(entry({ reason: '   ' }))).toThrow(DynamicViewControlError);
  });

  test('an actor is required, so no row is anonymous', () => {
    expect(() => assertDynamicViewControlEntry(entry({ actor: '' }))).toThrow(DynamicViewControlError);
  });

  test('a non-finite clock is refused before it can be written', () => {
    expect(() => assertDynamicViewControlEntry(entry({ createdAt: Number.NaN })))
      .toThrow(DynamicViewControlError);
  });

  test('every declared kind validates, so the list and the validator cannot drift', () => {
    for (const kind of DYNAMIC_CONTROL_KINDS) {
      const target = kind.startsWith('hide_') ? 'target-id' : null;
      expect(() => assertDynamicViewControlEntry(entry({ kind, target }))).not.toThrow();
    }
  });
});

describe('applying the controls to a projection (AC#3)', () => {
  const projection = {
    characters: [{ characterId: 'he-jun' }, { characterId: 'pei-lan' }],
    activeScenes: [
      { sceneId: 's1', participantCharacterIds: ['he-jun', 'pei-lan'] },
      { sceneId: 's2', participantCharacterIds: ['pei-lan'] },
    ],
  };

  test('nothing hidden returns the SAME object, so the content hash is unchanged', () => {
    // The overwhelmingly common path. A fresh object every rebuild would defeat the read-model
    // store's dedup and append a version per rebuild for a world where nothing changed.
    expect(applyDynamicViewControls(projection, NO_DYNAMIC_VIEW_CONTROLS)).toBe(projection);
  });

  test('a hidden character is removed, not blanked', () => {
    const applied = applyDynamicViewControls(projection, {
      ...NO_DYNAMIC_VIEW_CONTROLS,
      hiddenCharacterIds: new Set(['he-jun']),
    });
    expect(applied.characters.map((c) => c.characterId)).toEqual(['pei-lan']);
  });

  test('and is removed from every participant list too', () => {
    // Otherwise the id is still on screen in the scene panel — the thing being hidden IS the
    // id, so leaving it there publishes "this person is in that scene" for someone the operator
    // just took off the map.
    const applied = applyDynamicViewControls(projection, {
      ...NO_DYNAMIC_VIEW_CONTROLS,
      hiddenCharacterIds: new Set(['he-jun']),
    });
    expect(applied.activeScenes[0].participantCharacterIds).toEqual(['pei-lan']);
  });

  test('a hidden scene is dropped entirely', () => {
    const applied = applyDynamicViewControls(projection, {
      ...NO_DYNAMIC_VIEW_CONTROLS,
      hiddenSceneIds: new Set(['s1']),
    });
    expect(applied.activeScenes.map((s) => s.sceneId)).toEqual(['s2']);
  });

  test('the input is not mutated', () => {
    applyDynamicViewControls(projection, {
      ...NO_DYNAMIC_VIEW_CONTROLS,
      hiddenCharacterIds: new Set(['he-jun']),
      hiddenSceneIds: new Set(['s1']),
    });
    expect(projection.characters).toHaveLength(2);
    expect(projection.activeScenes[0].participantCharacterIds).toEqual(['he-jun', 'pei-lan']);
  });

  test('a scene with no id survives a scene hide rather than being dropped by accident', () => {
    // A payload persisted before ART-122 carries no `sceneId`. Treating "no id" as "matches"
    // would blank the map for every world whose last rebuild predates that task.
    const legacy = { characters: [], activeScenes: [{ title: 'old' } as { sceneId?: string }] };
    const applied = applyDynamicViewControls(legacy, {
      ...NO_DYNAMIC_VIEW_CONTROLS,
      hiddenSceneIds: new Set(['s1']),
    });
    expect(applied.activeScenes).toHaveLength(1);
  });
});
