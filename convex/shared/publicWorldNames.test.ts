/**
 * A zh-Hant viewer reads 霧林鎮; everything internal still says mistwood / Mistwood (ART-190).
 *
 * The policy has two halves and a test that only checked the first would be worse than none: it is
 * just as wrong to rename the world in Canon, in `worldId`, or in the seed as it is to show
 * 「Mistwood」 to a viewer. So the second describe block asserts what must NOT have changed, by
 * reading canon and the seed directly.
 *
 * The third block is a source scan. The defect this task fixes was two names for one town three
 * lines apart — the home page's `h1` rendered the seed's 「Mistwood」 while the heading beneath it
 * was a hardcoded 「現在的霧林鎮」 — so the guarantee worth pinning is not 「the name resolves」 but
 * 「there is exactly one place the name comes from」.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { MISTWOOD_PUBLIC_WORLD_ID, mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import { listPublicWorlds, resolvePublicWorld } from '../canon/publicWorldRegistry';
import { buildWorldProjection } from '../publicRead/worldCharacterProjection';
import {
  LOCALIZED_PUBLIC_WORLD_IDS,
  PUBLIC_WORLD_PLACEHOLDER_NAME,
  worldDisplayName,
} from './publicWorldNames';

const MISTWOOD_DISPLAY_NAME = '霧林鎮';

describe('the public display name', () => {
  it('is keyed by the canon world id, not by a string that merely looks like it', () => {
    /**
     * `shared` may depend on nothing, so the registry's key is a hand-copy of
     * `MISTWOOD_PUBLIC_WORLD_ID`. This is what makes the copy safe — the same check
     * `publicLabels.test.ts` makes for the time-slot vocabulary.
     */
    expect(LOCALIZED_PUBLIC_WORLD_IDS).toEqual([MISTWOOD_PUBLIC_WORLD_ID]);
  });

  it('resolves Mistwood to 霧林鎮', () => {
    expect(worldDisplayName(MISTWOOD_PUBLIC_WORLD_ID)).toBe(MISTWOOD_DISPLAY_NAME);
  });

  it('wins over the canonical name, which is the entire policy', () => {
    expect(worldDisplayName(MISTWOOD_PUBLIC_WORLD_ID, 'Mistwood')).toBe(MISTWOOD_DISPLAY_NAME);
  });

  it('keeps an unregistered world’s canonical name rather than renaming it', () => {
    expect(worldDisplayName('other-world', 'Northreach')).toBe('Northreach');
  });

  it('returns null — not a placeholder — when nothing names the world', () => {
    // The caller decides, because only the caller knows whether it is still waiting for a read.
    expect(worldDisplayName('other-world')).toBeNull();
    expect(worldDisplayName(null)).toBeNull();
    expect(worldDisplayName('other-world', '   ')).toBeNull();
  });
});

describe('the published world projection carries the public name', () => {
  const publish = (worldId: string, canonicalName: string) =>
    buildWorldProjection({ worldId, source: { name: canonicalName }, publicFacts: [] });

  it('publishes 霧林鎮 for the world the seed calls Mistwood', () => {
    expect(publish(MISTWOOD_PUBLIC_WORLD_ID, 'Mistwood').name).toBe(MISTWOOD_DISPLAY_NAME);
  });

  it('does not touch worldId, which is the internal identity', () => {
    // The half that must NOT change. Renaming this would be a migration, not a display change.
    expect(publish(MISTWOOD_PUBLIC_WORLD_ID, 'Mistwood').worldId).toBe('mistwood');
  });

  it('leaves another world’s name alone', () => {
    expect(publish('other-world', 'Northreach').name).toBe('Northreach');
  });
});

describe('internal identity is unchanged', () => {
  it('keeps the canon world id as mistwood', () => {
    expect(MISTWOOD_PUBLIC_WORLD_ID).toBe('mistwood');
  });

  it('keeps the seed’s canonical world name as Mistwood', () => {
    // Canon is not migrated and the seed is not translated. If this ever fails, someone has done
    // the thing ART-190 explicitly excluded.
    expect(mistwoodWorldConfiguration.world.name).toBe('Mistwood');
    expect(mistwoodWorldConfiguration.world.id).toBe('mistwood');
  });

  it('keeps the internal world registry canonical', () => {
    /**
     * `publicWorldRegistry` is internal routing data with no viewer-facing consumer. Per the
     * policy, internal surfaces keep the canonical name — so this asserts it STAYS 「Mistwood」
     * rather than being helpfully localized, which would put the translation in two places.
     */
    expect(listPublicWorlds()).toEqual([
      { worldId: 'mistwood', slug: 'mistwood', name: 'Mistwood' },
    ]);
    expect(resolvePublicWorld('mistwood')?.name).toBe('Mistwood');
  });

  it('leaves the seed’s authored location and organization names alone', () => {
    // Out of scope by decision: these are world CONTENT, not the world's name. Asserted so a
    // future "consistency" pass does not quietly translate them under this task's banner.
    const names = mistwoodWorldConfiguration.locations.map((location) => location.name);
    expect(names).toContain('Mistwood Station');
    expect(mistwoodWorldConfiguration.organizations.map((org) => org.name))
      .toContain('Mistwood Council');
  });
});

describe('there is exactly one place the display name comes from', () => {
  /**
   * Source scan, because the defect was a SECOND source: a hardcoded 「現在的霧林鎮」 three lines
   * below an `h1` rendering 「Mistwood」. A unit test on the resolver cannot see that.
   *
   * Comments are stripped first, so a docblock quoting the old copy — several of them do — is not
   * mistaken for a live string.
   */
  const sourceFiles = (): string[] =>
    execFileSync('git', ['ls-files', 'src', 'convex'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter((file) => /\.(ts|tsx)$/u.test(file) && !/\.test\./u.test(file));

  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

  it('finds source files to scan, so this block cannot pass by scanning nothing', () => {
    expect(sourceFiles().length).toBeGreaterThan(100);
  });

  it('writes 霧林鎮 in the boundary module and nowhere else', () => {
    const offenders = sourceFiles().filter((file) => {
      if (file === 'convex/shared/publicWorldNames.ts') return false;
      // The E2E fixture stands in for published payloads — it is test scaffolding that never
      // reaches production, and the policy exempts test evidence explicitly.
      if (file.startsWith('src/e2e/')) return false;
      return withoutComments(readFileSync(file, 'utf8')).includes(MISTWOOD_DISPLAY_NAME);
    });
    expect(offenders).toEqual([]);
  });

  it('renders the canonical name on no public surface', () => {
    /**
     * Scoped to the public client and the read models. `convex/canon` keeps the canonical name by
     * design, `convex/visual` names the map in an internal error, and the seed's location and
     * organization names are authored content this task does not touch.
     */
    const publicRoots = ['src/components/public/', 'src/components/live/', 'src/components/recap/'];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!publicRoots.some((root) => file.startsWith(root))) continue;
      const body = withoutComments(readFileSync(file, 'utf8'));
      for (const literal of body.match(/["'`][^"'`\n]*\bMistwood\b[^"'`\n]*["'`]/gu) ?? []) {
        offenders.push(`${file}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the placeholder', () => {
  it('is shared rather than copied per page', () => {
    // The home page kept a private `PLACEHOLDER_WORLD_NAME` before this task.
    expect(PUBLIC_WORLD_PLACEHOLDER_NAME).toBe('這個世界');
  });
});
