/**
 * The effective safety label (FR-P004 / ART-132): what the pure resolver decides, and what the
 * database join in front of it reads.
 *
 * The claim this file exists to prove is the one the design turns on: an override is an
 * ADDITION to the record, never an edit of it. Every case below re-reads the classification
 * fixture afterwards and asserts it is byte-identical, because a design where an operator
 * flipped the stored label would silently destroy the classifier's verdict — and the
 * `SAFETY_CLASSIFICATION_CONFLICT` invariant that depends on it — while still passing every
 * test that only looked at the effective answer.
 */

import { resolveEffectiveSafetyLabel, type PostGenerationClassification } from './postGeneration';
import { readEffectiveSafetyLabels, readWithheldSceneLabels } from './effectiveSafetyLabels';

const WORLD_ID = 'mistwood';
const SCENE_ID = 'mistwood:1:morning:grouping:scene:1';
const CLASSIFICATION_ID = `${SCENE_ID}:simulation:safety`;

function classification(over: Partial<PostGenerationClassification> = {}): PostGenerationClassification {
  return {
    policyVersion: 1,
    classificationId: CLASSIFICATION_ID,
    worldId: WORLD_ID,
    sourceId: SCENE_ID,
    kind: 'scene',
    label: 'allow',
    reasonCodes: [],
    warningCodes: [],
    classifiedTextHash: 'fnv1a32:deadbeef',
    ...over,
  };
}

describe('resolveEffectiveSafetyLabel — latest override wins, silence keeps the verdict', () => {
  it('returns the classifier’s own label when nothing has been overridden', () => {
    expect(resolveEffectiveSafetyLabel(classification({ label: 'withhold' }), [])).toBe('withhold');
    expect(resolveEffectiveSafetyLabel(classification({ label: 'allow_with_warning' }), [])).toBe('allow_with_warning');
  });

  it('lets the newest override supersede both older overrides and the original label', () => {
    const overrides = [
      { label: 'allow' as const, createdAt: 300 },
      { label: 'withhold' as const, createdAt: 900 },
      { label: 'allow_with_warning' as const, createdAt: 100 },
    ];
    // Order of arrival must not matter: the ledger is append-only and a reader that took the
    // last row, or the first, would sometimes publish a label an operator had already revised.
    expect(resolveEffectiveSafetyLabel(classification({ label: 'allow' }), overrides)).toBe('withhold');
    expect(resolveEffectiveSafetyLabel(classification({ label: 'allow' }), [...overrides].reverse())).toBe('withhold');
  });

  it('lets an override release content the classifier withheld', () => {
    expect(resolveEffectiveSafetyLabel(
      classification({ label: 'withhold' }),
      [{ label: 'allow', createdAt: 10 }],
    )).toBe('allow');
  });

  it('never mutates the classification it is handed', () => {
    const original = classification({ label: 'withhold' });
    const before = JSON.stringify(original);
    resolveEffectiveSafetyLabel(original, [{ label: 'allow', createdAt: 1 }]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('resolves a createdAt tie to the LAST row supplied, which is ledger order', () => {
    // Two overrides can share a millisecond. The row appended second is the later decision, and
    // it is also the row `by_world_source_and_created` returns last — so this fold and a
    // `.order('desc').take(1)` read agree. The tie case is asserted here because it is the one
    // place those two strategies could silently diverge.
    expect(resolveEffectiveSafetyLabel(classification({ label: 'allow' }), [
      { label: 'allow', createdAt: 500 },
      { label: 'withhold', createdAt: 500 },
    ])).toBe('withhold');
    expect(resolveEffectiveSafetyLabel(classification({ label: 'allow' }), [
      { label: 'withhold', createdAt: 500 },
      { label: 'allow', createdAt: 500 },
    ])).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// The database join. Two tables, both read by index, neither ever written here.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * The slice of Convex these functions use, including index ORDER.
 *
 * `safetyStatusOverrides` is indexed `['worldId', 'sourceId', 'createdAt']`, so rows come back
 * ascending by `createdAt` and `.order('desc')` reverses them — modelled here rather than
 * ignored, because "the newest override wins" is now a `take(1)` off that ordering and a fake
 * that returned insertion order would make the test pass for the wrong reason.
 */
function memoryDb(tables: Record<string, Row[]>) {
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
          };
          build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count: number) => Promise.resolve(rows.slice(0, count)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(ascending);
        },
      };
    },
  };
  return db as unknown as Parameters<typeof readEffectiveSafetyLabels>[0];
}

function classificationRow(over: Partial<PostGenerationClassification> & { createdAt?: number } = {}): Row {
  return { ...classification(over), createdAt: over.createdAt ?? 1_000 };
}

function overrideRow(over: { label: string; createdAt: number; actor?: string; sourceId?: string }): Row {
  return {
    worldId: WORLD_ID,
    // Keyed on the SCENE, not the classification run — an operator's decision is about content
    // and must survive a re-classification of that content under a new run id.
    sourceId: over.sourceId ?? SCENE_ID,
    classificationId: CLASSIFICATION_ID,
    label: over.label,
    reason: 'reviewed after a viewer report',
    actor: over.actor ?? 'op-real',
    createdAt: over.createdAt,
  };
}

describe('readEffectiveSafetyLabels — joining the classification to its override ledger', () => {
  it('resolves a Scene with no classification row at all to allow', async () => {
    // Canon carries seed, system and remediation events no post-generation classifier ever
    // examined. Reading their silence as a refusal would blank the map for content that was
    // never in question, which is a bigger failure than the one this gate prevents.
    const labels = await readEffectiveSafetyLabels(memoryDb({}), WORLD_ID, ['scene-never-classified']);
    expect(labels).toEqual({ 'scene-never-classified': 'allow' });
  });

  it('resolves to the classifier’s verdict when the ledger is empty', async () => {
    const tables = { postGenerationSafetyClassifications: [classificationRow({ label: 'withhold' })], safetyStatusOverrides: [] };
    expect(await readEffectiveSafetyLabels(memoryDb(tables), WORLD_ID, [SCENE_ID])).toEqual({ [SCENE_ID]: 'withhold' });
  });

  it('applies the newest override and leaves the classification row untouched', async () => {
    const rows = [classificationRow({ label: 'allow' })];
    const before = JSON.stringify(rows);
    const tables = {
      postGenerationSafetyClassifications: rows,
      safetyStatusOverrides: [
        overrideRow({ label: 'withhold', createdAt: 2_000 }),
        overrideRow({ label: 'allow', createdAt: 1_500 }),
      ],
    };
    expect(await readEffectiveSafetyLabels(memoryDb(tables), WORLD_ID, [SCENE_ID])).toEqual({ [SCENE_ID]: 'withhold' });
    // AC — nothing Canon-adjacent is corrupted: the classifier's row is exactly as it was.
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('scopes both reads to the world, so another world’s override cannot answer for this one', async () => {
    const tables = {
      postGenerationSafetyClassifications: [classificationRow({ label: 'allow' })],
      safetyStatusOverrides: [{ ...overrideRow({ label: 'withhold', createdAt: 9_000 }), worldId: 'other-world' }],
    };
    expect(await readEffectiveSafetyLabels(memoryDb(tables), WORLD_ID, [SCENE_ID])).toEqual({ [SCENE_ID]: 'allow' });
  });

  it('answers for several Scenes at once and ignores a blank id', async () => {
    const otherScene = 'mistwood:1:noon:grouping:scene:2';
    const tables = {
      postGenerationSafetyClassifications: [
        classificationRow({ label: 'allow' }),
        classificationRow({ label: 'human_review_required', sourceId: otherScene, classificationId: `${otherScene}:safety` }),
      ],
      safetyStatusOverrides: [],
    };
    expect(await readEffectiveSafetyLabels(memoryDb(tables), WORLD_ID, [SCENE_ID, otherScene, SCENE_ID, '']))
      .toEqual({ [SCENE_ID]: 'allow', [otherScene]: 'human_review_required' });
  });
});

describe('the override survives a re-classification of the same Scene', () => {
  it('keeps withholding after a fresh classification run under a new id', async () => {
    // A slot retry re-groups and re-classifies the same Scene, producing a SECOND
    // classification row with a new `classificationId` and — being fresh, unremarkable
    // content — an `allow` label. Keying the ledger on `classificationId` would have orphaned
    // the operator's decision here and quietly republished the content they withheld. Keying
    // it on `sourceId` (the Scene) is what makes the decision outlive the run that prompted it.
    const rerun = `${SCENE_ID}:simulation-retry:safety`;
    const tables = {
      postGenerationSafetyClassifications: [
        classificationRow({ label: 'allow', createdAt: 1_000 }),
        classificationRow({ label: 'allow', classificationId: rerun, createdAt: 5_000 }),
      ],
      safetyStatusOverrides: [overrideRow({ label: 'withhold', createdAt: 2_000 })],
    };
    expect(await readEffectiveSafetyLabels(memoryDb(tables), WORLD_ID, [SCENE_ID]))
      .toEqual({ [SCENE_ID]: 'withhold' });
    // Both entry points must reach the same verdict. They read different rows — one asks about
    // this Scene, the other sweeps the world's refusals — so a divergence would mean the
    // rebuild's gate and the override command's verification disagreed about the same content.
    expect(await readWithheldSceneLabels(memoryDb(tables), WORLD_ID))
      .toEqual({ [SCENE_ID]: 'withhold' });
  });
});

// ---------------------------------------------------------------------------
// The bounded sweep a rebuild uses
// ---------------------------------------------------------------------------

describe('readWithheldSceneLabels — the inverted, history-independent question', () => {
  const OTHER_SCENE = 'mistwood:1:noon:grouping:scene:2';

  it('returns nothing for a world where nothing was ever refused', async () => {
    expect(await readWithheldSceneLabels(memoryDb({}), WORLD_ID)).toEqual({});
  });

  it('returns the Scenes the classifier refused, and only those', async () => {
    const tables = {
      postGenerationSafetyClassifications: [
        classificationRow({ label: 'withhold' }),
        classificationRow({ label: 'human_review_required', sourceId: OTHER_SCENE, classificationId: `${OTHER_SCENE}:safety` }),
      ],
      safetyStatusOverrides: [],
    };
    expect(await readWithheldSceneLabels(memoryDb(tables), WORLD_ID))
      .toEqual({ [SCENE_ID]: 'withhold', [OTHER_SCENE]: 'human_review_required' });
  });

  it('drops a Scene an override has released', async () => {
    const tables = {
      postGenerationSafetyClassifications: [classificationRow({ label: 'withhold' })],
      safetyStatusOverrides: [overrideRow({ label: 'allow', createdAt: 3_000 })],
    };
    expect(await readWithheldSceneLabels(memoryDb(tables), WORLD_ID)).toEqual({});
  });

  it('adds a Scene an override has refused, even though its classification allowed it', async () => {
    // This is the case the `by_world_and_label` sweep cannot see on its own: the classification
    // is `allow`, so it is never read. The override table is what puts the Scene in scope.
    const tables = {
      postGenerationSafetyClassifications: [classificationRow({ label: 'allow' })],
      safetyStatusOverrides: [overrideRow({ label: 'withhold', createdAt: 3_000 })],
    };
    expect(await readWithheldSceneLabels(memoryDb(tables), WORLD_ID))
      .toEqual({ [SCENE_ID]: 'withhold' });
  });

  it('lets the newest override decide, whichever direction it points', async () => {
    const tables = {
      postGenerationSafetyClassifications: [classificationRow({ label: 'withhold' })],
      safetyStatusOverrides: [
        overrideRow({ label: 'allow', createdAt: 3_000 }),
        overrideRow({ label: 'withhold', createdAt: 9_000 }),
        overrideRow({ label: 'allow', createdAt: 1_000 }),
      ],
    };
    expect(await readWithheldSceneLabels(memoryDb(tables), WORLD_ID))
      .toEqual({ [SCENE_ID]: 'withhold' });
  });

  it('never reads a Scene that was neither refused nor overridden', async () => {
    // The point of the inversion: a world with a hundred thousand allowed Scenes costs the
    // same as a world with none, because allowed classifications are never fetched. Asserted
    // by counting the rows the fake was asked for.
    const asked: string[] = [];
    const tables = {
      postGenerationSafetyClassifications: Array.from({ length: 50 }, (_unused, index) =>
        classificationRow({ label: 'allow', sourceId: `scene-${index}`, classificationId: `scene-${index}:safety` })),
      safetyStatusOverrides: [],
    };
    tables.postGenerationSafetyClassifications.push(classificationRow({ label: 'withhold' }));
    const counting = {
      query(table: string) {
        asked.push(table);
        return memoryDb(tables).query(table as never) as never;
      },
    } as unknown as Parameters<typeof readWithheldSceneLabels>[0];

    expect(await readWithheldSceneLabels(counting, WORLD_ID)).toEqual({ [SCENE_ID]: 'withhold' });
    // Three reads total, regardless of how many Scenes the world contains: one per withholding
    // label, plus the override sweep. Never one per Scene.
    expect(asked).toHaveLength(3);
  });

  it('scopes every read to the world', async () => {
    const tables = {
      postGenerationSafetyClassifications: [{ ...classificationRow({ label: 'withhold' }), worldId: 'other-world' }],
      safetyStatusOverrides: [{ ...overrideRow({ label: 'withhold', createdAt: 3_000 }), worldId: 'other-world' }],
    };
    expect(await readWithheldSceneLabels(memoryDb(tables), WORLD_ID)).toEqual({});
  });
});
