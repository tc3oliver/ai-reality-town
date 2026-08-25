/**
 * Every public query the client actually calls has a fixture (FR-Q006 / ART-137).
 *
 * ## The failure this exists to prevent, which already happened once
 *
 * `fixtureConvexClient.ts` THROWS on a query it has no handler for. That is a deliberate and
 * good choice — a silently-undefined query renders as an ordinary loading state and the spec
 * waits for data that is never coming — but it has a sharp edge: the throw happens during
 * render, so one unregistered query takes down the WHOLE page, not just the component that
 * asked for it.
 *
 * ART-45 mounted `EnvironmentVotePanel` on the homepage without registering
 * `getEnvironmentVoteBallot` in the fixture. The result was not "the vote section is missing".
 * It was an empty `<body>`, and the three specs that turned red belonged to **ART-129** — a task
 * that had nothing to do with voting and whose code was untouched. CI went red on `main` with a
 * failure that pointed at the wrong feature.
 *
 * `npm run check` could not catch it either, because the defect only exists in a browser: the
 * unit suites never mount the app through the fixture transport. So it took a full E2E run to
 * surface, and the diagnosis started at the wrong end of the codebase.
 *
 * This test moves that failure forward to `npm run check`, and makes it name the right file.
 *
 * ## How the two sides are derived
 *
 * Both from declared truth rather than from a hand-kept list:
 *
 *   - **What the client calls** — every `publicFunctionRef('path:name')` literal under `src/`.
 *     That call is the only way a client module names a public function, so scanning for it
 *     cannot miss one that is actually reachable.
 *   - **Which of those are queries** — `publicFunctionSurface.allowed` in
 *     `architecture/module-boundaries.json`, which already records the `kind` of every public
 *     function and is already enforced by `npm run check:architecture`. Mutations are excluded
 *     because the fixture is *supposed* to refuse them; that refusal is what ART-137's
 *     zero-write assertions rest on.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * Every production `.ts`/`.tsx` file under `src/`, which is where client code names public
 * functions.
 *
 * Specs are excluded because they are not in the client bundle — and because including them made
 * this suite fail on its own doc comment, which quotes `publicFunctionRef('path:name')` to
 * explain the pattern being scanned for. A test that reads source text has to exclude itself
 * from its own corpus, or prose about the rule becomes an instance of it.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** `path:name` for every public function the client bundle references. */
const referenced = new Set<string>();
for (const file of sourceFiles(join(ROOT, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/publicFunctionRef<[^>]*>\(\s*'([^']+)'/g)) {
    referenced.add(match[1]);
  }
  for (const match of source.matchAll(/publicFunctionRef\(\s*'([^']+)'/g)) {
    referenced.add(match[1]);
  }
}

const policy = JSON.parse(
  readFileSync(join(ROOT, 'architecture', 'module-boundaries.json'), 'utf8'),
) as { publicFunctionSurface: { allowed: Array<{ path: string; name: string; kind: string }> } };

/** `path:name` → declared kind, from the file `npm run check:architecture` already enforces. */
const declaredKind = new Map(
  policy.publicFunctionSurface.allowed.map((entry) => [`${entry.path}:${entry.name}`, entry.kind]),
);

/** The keys `fixtureConvexClient.ts` registers, read as source text. */
const fixtureSource = readFileSync(join(ROOT, 'src', 'e2e', 'fixtureConvexClient.ts'), 'utf8');
const handlerBlock = fixtureSource.slice(
  fixtureSource.indexOf('const FIXTURE_QUERY_HANDLERS'),
  fixtureSource.indexOf('/**\n * The `path:name` a function reference carries.'),
);
const handled = new Set(
  [...handlerBlock.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]),
);

/** The `convex/`-relative path a ref names, as the policy file spells it. */
function policyKey(reference: string): string {
  const [path, name] = reference.split(':');
  return `convex/${path}.ts:${name}`;
}

describe('the E2E fixture covers every public query the client calls', () => {
  test('the scan found the references it is supposed to find', () => {
    // Without this the suite would pass vacuously the moment `publicFunctionRef` is renamed or
    // the refs move: an empty `referenced` set satisfies every assertion below.
    expect(referenced.size).toBeGreaterThanOrEqual(5);
    expect(handled.size).toBeGreaterThanOrEqual(5);
  });

  test('every referenced public QUERY has a fixture handler', () => {
    const queries = [...referenced].filter((reference) => {
      const kind = declaredKind.get(policyKey(reference));
      // An unknown reference is not silently skipped — the next test fails on it — but it is not
      // required to have a fixture either, because we do not know that it is a query.
      return kind === 'query';
    });
    const missing = queries.filter((reference) => !handled.has(reference));
    expect(missing).toEqual([]);
  });

  test('every referenced public function is declared in the architecture policy', () => {
    // The lookup above is only meaningful if it resolves. A ref the policy does not know about
    // would make the query filter skip it, and the missing fixture would go unnoticed — which is
    // exactly the hole this file exists to close.
    const undeclared = [...referenced].filter(
      (reference) => !declaredKind.has(policyKey(reference)),
    );
    expect(undeclared).toEqual([]);
  });

  test('no fixture handler is registered for a MUTATION', () => {
    // The fixture must REFUSE writes — ART-137's zero-mutation evidence depends on it. A handler
    // for a mutation would make the transport answer one instead of throwing, and the E2E
    // assertions that no write occurred would keep passing while a write was being served.
    const servedMutations = [...handled].filter(
      (reference) => declaredKind.get(policyKey(reference)) === 'mutation',
    );
    expect(servedMutations).toEqual([]);
  });
});
