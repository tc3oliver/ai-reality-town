/**
 * A retired read-model kind (ART-182).
 *
 * `relationship` — one published model per character PAIR — was committed on every relationship
 * change and read by nothing. Retiring it is not a deletion: the kind has to leave the LIVE
 * vocabulary and stay in the STORED one, and the two halves fail in opposite directions.
 *
 * - Leave it live and the anonymous `getPublishedReadModel` keeps accepting it, so the surface is
 *   still there for anyone who can guess a `pairKey` — unscoped, unbounded, and with none of the
 *   limits FR-I007 puts on the graph that serves the same data.
 * - Take it out of the stored union and the next deploy FAILS, because Convex validates existing
 *   documents and rows written before this task carry `modelKind: 'relationship'`.
 *
 * So the tests below are two-sided on purpose, and each side has a failure this suite is the only
 * place that would catch.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { POST_COMMIT_STAGES } from '../operations/postCommitOrchestration';
import {
  READ_MODEL_KINDS,
  RETIRED_READ_MODEL_KINDS,
  ReadModelError,
  isReadModelKind,
  serveReadModel,
  type PublicReadReadStore,
  type StoredReadModel,
} from './readModel';

const HERE = join(process.cwd(), 'convex/publicRead');
const RETIRED: readonly string[] = RETIRED_READ_MODEL_KINDS;

describe('the retired kind has left the live vocabulary', () => {
  it('is retired, and is not live', () => {
    expect(RETIRED_READ_MODEL_KINDS).toEqual(['relationship']);
    expect(READ_MODEL_KINDS as readonly string[]).not.toContain('relationship');
    expect(isReadModelKind('relationship')).toBe(false);
  });

  it('refuses to serve a legacy row, rather than serving it to an anonymous caller', async () => {
    /**
     * The row is real in shape: this is what the store still holds for a pair that moved before
     * the retirement. `assertTarget` is what stops it, so a caller that reaches past the arg
     * validator — an internal caller, a future migration, a hand-built ref — is refused too.
     */
    const legacy: StoredReadModel = {
      id: 'row-1',
      schemaVersion: 1,
      createdAt: 1,
      worldId: 'mistwood',
      modelKind: 'relationship' as never,
      modelRef: 'relationship:he-jun:zhao-ming',
      version: 3,
      payload: { trust: 40, affection: 25 },
      status: 'published',
      sourceEventIds: ['e1'],
      contentHash: 'hash',
      publishedAt: 1,
      isCurrent: true,
      isLastKnownGood: false,
    };
    const store: PublicReadReadStore = {
      loadTargetVersions: () => Promise.resolve([legacy]),
    };
    await expect(serveReadModel(store, 'mistwood', 'relationship' as never, legacy.modelRef))
      .rejects.toThrow(ReadModelError);
  });

  it('is not nameable by the anonymous query, because its validator is the live list', () => {
    // `getPublishedReadModel` is gated `anonymous` in `architecture/module-boundaries.json` and
    // takes `(worldId, modelKind, modelRef)` — the arg validator is the outermost door, and the
    // equality that keeps it the live list is pinned in `viewerKnowledgeProjection.test.ts`.
    const source = readFileSync(join(HERE, 'readModelFunctions.ts'), 'utf8');
    const block = /const modelKindValidator = v\.union\(([\s\S]*?)\n\);/.exec(source);
    if (block === null) throw new Error('the modelKindValidator union was not found — has it moved?');
    const named = [...block[1].matchAll(/v\.literal\('([^']+)'\)/g)].map((match) => match[1]);
    for (const kind of RETIRED) expect(named).not.toContain(kind);
  });
});

describe('the retired kind has NOT left the store', () => {
  it('is still a literal in the stored union, so existing rows deploy', () => {
    /**
     * The failure this prevents is not a test failure, and that is why it is asserted from the
     * source rather than inferred: a deploy that refuses every existing `relationship` row would
     * surface as an owner-facing deployment error long after this change merged, and the obvious
     * "cleanup" — deleting the literal along with the publisher — is exactly what causes it.
     */
    const source = readFileSync(join(HERE, 'schema.ts'), 'utf8');
    const block = /modelKind: v\.union\(([\s\S]*?)\n {4}\),/.exec(source);
    if (block === null) throw new Error('the stored modelKind union was not found — has it moved?');
    const stored = [...block[1].matchAll(/v\.literal\('([^']+)'\)/g)].map((match) => match[1]);
    for (const kind of RETIRED) expect(stored).toContain(kind);
  });
});

describe('nothing publishes the retired kind', () => {
  it('names it in no publication call anywhere under convex/', () => {
    /**
     * A source scan rather than a type-level guarantee, because the type would not catch the way
     * this actually comes back: `writePublishedReadModel` takes `modelKind` as a validated
     * argument, so a caller can name a string the compiler never sees as a literal.
     */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '_generated') walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
        const source = readFileSync(path, 'utf8');
        for (const kind of RETIRED) {
          if (source.includes(`modelKind: '${kind}'`)) offenders.push(`${path}: modelKind: '${kind}'`);
          if (new RegExp(`modelKind:\\s*${kind.toUpperCase()}_MODEL_KIND`, 'u').test(source)) {
            offenders.push(`${path}: ${kind.toUpperCase()}_MODEL_KIND`);
          }
        }
      }
    };
    walk(join(process.cwd(), 'convex'));
    expect(offenders).toEqual([]);
  });

  it('no longer declares a model kind for it in the projection module', () => {
    const source = readFileSync(join(HERE, 'relationshipArcProjection.ts'), 'utf8');
    expect(source).not.toMatch(/export const RELATIONSHIP_MODEL_KIND/u);
    // The arc half of the same file is untouched and still publishes.
    expect(source).toMatch(/export const ARC_MODEL_KIND = 'arc' as const;/u);
  });
});

describe('retiring the publication did not delete a PRD §12 stage', () => {
  it('keeps stage 14 「Update Relationships」 in the post-commit pipeline', () => {
    /**
     * The distinction ART-182 rests on. PRD §12 lists twenty-one stages and the fourteenth is
     * 「Update Relationships」; what this task removed was a PUBLICATION the stage also did. The
     * update itself was never here — `convex/canon/reducer.ts` folds every `relationship_changed`
     * into world state deterministically, and stage 11 replays it — so the stage keeps its name,
     * its checkpoint literal and its place in the order.
     */
    /**
     * Widened to `string[]` deliberately. `PostCommitStage` is a union derived from this array, so
     * naming a deleted stage at its own type makes the SUITE fail to compile — which reports
     * `Tests: 0 total`, indistinguishable from a clean pass in a filtered summary (CLAUDE.md §9).
     * A stage that quietly left the pipeline should fail this test by name.
     */
    const stages: readonly string[] = POST_COMMIT_STAGES;
    expect(stages).toContain('relationship');
    expect(stages.indexOf('relationship')).toBe(stages.indexOf('memory') + 1);
    expect(stages.indexOf('arc')).toBe(stages.indexOf('relationship') + 1);
  });
});
