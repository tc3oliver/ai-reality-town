/**
 * A character summary never reaches a public reader (FR-B003 / ART-11).
 *
 * The task's Security Impact clause is a negative, and a behavioural test cannot settle a
 * negative — it can only show that the calls it happened to make did not leak. So this is
 * settled structurally, the way `dynamicViewControls.boundary.test.ts` and
 * `visualReplay.boundary.test.ts` settle theirs: the shipped files are read, and every route
 * the leak would have to travel is looked for by name.
 *
 * The stake is specific. A flag says that `lin`'s trust in `wu` inverted from +50 to -50 —
 * the same private causal detail that keeps `relationshipHistory` and `getRelationshipProjection`
 * internal. `publicRead` is *allowed* to depend on `canon` by `module-boundaries.json`, so the
 * architecture checker cannot catch this one; nothing but this file stands between a summary and
 * a public projection.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry) ? [relative] : [];
  });
}

/** Every surface a viewer can reach: the public read models, the viewer API, and the client. */
const PUBLIC_SURFACES = [
  ...sourceFiles('convex/publicRead'),
  ...sourceFiles('convex/viewer'),
  ...sourceFiles('src'),
];

/** Names that only exist because of this feature; any one of them appearing is the leak. */
const PERSONA_SYMBOLS = [
  'personaDeviation',
  'CharacterSummary',
  'buildCharacterSummaries',
  'getCharacterSummaries',
  'PersonaDeviationFlag',
  'lastTurningPointEventId',
];

describe('the summary stays internal', () => {
  it('is not referenced by any public read model, viewer function, or client file', () => {
    // Asserted over the file list rather than one grep so that a NEW public file is covered the
    // day it is added, without anyone remembering to extend this test.
    const offenders = PUBLIC_SURFACES.flatMap((file) => {
      const source = read(file);
      return PERSONA_SYMBOLS.filter((symbol) => source.includes(symbol)).map((symbol) => `${file}: ${symbol}`);
    });
    expect(offenders).toEqual([]);
  });

  it('is exposed only through an internal query', () => {
    const queries = read('convex/canon/queries.ts');
    expect(queries).toContain('export const getCharacterSummaries = internalQuery({');
    // `query` would make it client-reachable with no authorization anywhere in this module.
    expect(queries).not.toMatch(/^import \{[^}]*\bquery\b/m);
    expect(queries).not.toContain('= query(');
  });
});

describe('the detector cannot become a generator', () => {
  // Comments stripped: this file argues at length about the fields it must not read, and a
  // substring check over the prose would fail on the explanation of why the code is right.
  const source = read('convex/canon/personaDeviation.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('imports no Convex runtime, so a public read can never make it call one', () => {
    // Public reads must not trigger LLM generation (CLAUDE.md §6). A module that cannot reach
    // Convex cannot reach an action, and a module that cannot reach an action cannot reach a
    // provider — which is a stronger guarantee than remembering not to.
    for (const forbidden of ['convex/values', '_generated', 'internalAction', 'ctx.runAction']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('has no clock and no randomness, so two rebuilds of one history agree', () => {
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('process.env');
  });

  it('reads no free text off the proposal', () => {
    // The central decision of this module: a verdict derived from strings the proposer wrote is a
    // verdict the proposer controls. `publicSummary`, `reason`, `content` and `interpretation` are
    // the four provider-authored fields a persona check would be tempted by.
    for (const field of ['publicSummary', '.reason', 'change.content', 'interpretation']) {
      expect(source).not.toContain(field);
    }
  });
});
