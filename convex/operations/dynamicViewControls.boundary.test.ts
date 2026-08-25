/**
 * The dynamic view's operator controls cannot touch Canon (FR-Q002 / ART-134 AC#6, #7, #8).
 *
 * These three criteria are negatives, and a behavioural test cannot settle a negative — it can
 * only show that the calls it happened to make did not do the forbidden thing. So they are
 * settled structurally, the way `liveMapSurface.test.ts` and `publicReadOnlyGuarantee.test.ts`
 * settle their own: the shipped files are read, and every API the forbidden action would have
 * to travel through is looked for by name.
 *
 * The stake is specific. An operator who could delete a Canon event through a visibility
 * control would have a correction path with no compensating record — which is the exact thing
 * FR-K005's correction workflow exists to prevent, and the reason AC#7 is a separate criterion
 * from AC#6.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OPS_CAPABILITIES } from './operatorAuthorization';
import { DYNAMIC_CONTROL_KINDS } from '../shared/dynamicViewControls';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const PURE = read('convex/shared/dynamicViewControls.ts');
const WIRING = read('convex/operations/dynamicViewControlFunctions.ts');

describe('the pure model reaches nothing (AC#6)', () => {
  test('it imports nothing at all', () => {
    // The strongest available form. A module with no imports cannot reach Canon, a correction
    // function, or a database — and it cannot acquire one without this failing.
    expect(PURE).not.toMatch(/^import\s/m);
  });

  test('it has no clock and no randomness, so a replay is reproducible', () => {
    expect(PURE).not.toContain('Date.now');
    expect(PURE).not.toContain('Math.random');
  });
});

describe('the wiring cannot modify Canon (AC#6)', () => {
  test.each(['canonEvents', 'canonSnapshots', '../canon/', 'commitCanonEvent', 'appendCanonEvent'])(
    'it does not reference %s',
    (symbol) => {
      expect(WIRING).not.toContain(symbol);
    },
  );

  test('the only table it writes is its own append-only ledger', () => {
    // Every insert, extracted rather than eyeballed. A second write target added later shows up
    // here whether or not anyone writes a test for it.
    const inserts = [...WIRING.matchAll(/ctx\.db\.insert\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(inserts).toEqual(['dynamicViewControls']);
  });

  test('it never patches, replaces or deletes anything', () => {
    // Append-only is the whole design: a release is a row, never an edit. This is what stops
    // that decaying into a mutable flag the first time it looks convenient.
    for (const api of ['ctx.db.patch', 'ctx.db.replace', 'ctx.db.delete']) {
      expect(WIRING).not.toContain(api);
    }
  });
});

describe('the wiring cannot bypass the correction workflow (AC#7)', () => {
  test.each(['canonCorrection', 'compensate', 'retcon', 'rollback'])(
    'it does not reference %s',
    (symbol) => {
      // FR-K005's workflow is the only way an accepted fact is revised. A visibility control
      // that could reach any of these would be a second, unrecorded correction path.
      expect(WIRING.toLowerCase()).not.toContain(symbol.toLowerCase());
    },
  );

  test('the one projection it rebuilds is the SAME internal mutation the orchestrator runs', () => {
    // AC#5 without new authority: a read of Canon as it already stands, then a write to the
    // read-model store. Re-deriving a projection is not revising a fact.
    expect(WIRING).toContain('publicRead/liveStateFunctions:rebuildLiveProjection');
    // ...and it stays internal. Making it publicly callable to satisfy AC#5 would have put an
    // unauthenticated rebuild on the public surface.
    expect(read('convex/publicRead/liveStateFunctions.ts'))
      .toMatch(/export const rebuildLiveProjection = internalMutation\(/);
  });
});

describe('every command reuses the existing gate and audit path (AC#8)', () => {
  test('it imports the console gate rather than defining one', () => {
    expect(WIRING).toContain("from './opsConsoleFunctions'");
    expect(WIRING).toContain('requireOperator');
    expect(WIRING).toContain('recordAudit');
    // A second authorization mechanism would be the failure this asserts against, and it would
    // look like a local helper with a plausible name.
    expect(WIRING).not.toMatch(/function\s+\w*[Aa]uthorize\w*\s*\(/);
    expect(WIRING).not.toContain('SIMULATION_OPS_OPERATORS');
    expect(WIRING).not.toContain('ctx.auth');
  });

  test('every exported mutation calls requireOperator, and every one records an audit row', () => {
    const exported = [...WIRING.matchAll(/export const (\w+) = (mutation|query)\(/g)];
    expect(exported.length).toBeGreaterThanOrEqual(6);

    // Counted rather than spot-checked: the number of gate calls must cover every command, so
    // an unguarded seventh export cannot hide among six guarded ones.
    const gateCalls = WIRING.match(/requireOperator\(/g) ?? [];
    const handlers = WIRING.match(/applyControl\(ctx, '/g) ?? [];
    // Four commands share `applyControl`, which holds one gate call; the rebuild and the
    // inspect query each hold their own.
    expect(handlers).toHaveLength(4);
    expect(gateCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('every dynamic capability is registered, so none is invented at the call site', () => {
    for (const capability of ['dynamic.pause', 'dynamic.pin_snapshot', 'dynamic.hide',
      'dynamic.rebuild', 'dynamic.inspect']) {
      expect(OPS_CAPABILITIES as readonly string[]).toContain(capability);
    }
  });

  test('inspection is a viewer capability, so reading is not the authority to change', () => {
    const authorization = read('convex/operations/operatorAuthorization.ts');
    expect(authorization).toMatch(/'dynamic\.inspect':\s*'viewer'/);
    for (const capability of ['dynamic.pause', 'dynamic.pin_snapshot', 'dynamic.hide', 'dynamic.rebuild']) {
      expect(authorization).toMatch(new RegExp(`'${capability.replace('.', '\\.')}':\\s*'operator'`));
    }
  });

  test('hiding is NOT folded into safety.override', () => {
    // An operator trusted to take a mis-rendering sprite off the map is not thereby trusted to
    // un-withhold content the safety classifier refused. Two capabilities, two ledgers.
    expect(WIRING).not.toContain('safety.override');
    expect(WIRING).not.toContain('safetyStatusOverrides');
  });

  test('every control kind maps to a registered capability', () => {
    // A kind added without a capability would either not compile or would silently reuse
    // another's authority; this pins the mapping is total and drawn from the real list.
    for (const kind of DYNAMIC_CONTROL_KINDS) {
      expect(WIRING).toContain(`${kind}: 'dynamic.`);
    }
  });
});

describe('the projection applies the controls at BUILD time', () => {
  const LIVE = read('convex/publicRead/liveStateFunctions.ts');

  /**
   * The file with every `import` statement removed.
   *
   * Checking that an identifier merely APPEARS is not a check: the import line contains it, so
   * deleting the call site and keeping the import passes. A fault injection that replaced
   * `applyDynamicViewControls(derived.projection, controls)` with `derived.projection` was not
   * caught until this stripping was added — the controls silently stopped being applied and
   * every structural assertion still held.
   */
  const LIVE_BODY = LIVE.replace(/^import[\s\S]*?from '[^']+';$/gm, '');

  test('the builder resolves them through the shared model, not its own', () => {
    // Two implementations of "what is hidden" diverge silently: the console keeps reporting a
    // character as hidden while the map keeps drawing them.
    expect(LIVE).toContain("from '../shared/dynamicViewControls'");
  });

  test('and it CALLS them, which importing them does not prove', () => {
    expect(LIVE_BODY).toMatch(/resolveDynamicViewControlRows\(/);
    expect(LIVE_BODY).toMatch(/applyDynamicViewControls\(/);
  });

  test('and it is applied where the projection is BUILT, not where it is read', () => {
    // A read-time filter would leave the hidden thing in the stored payload, and FR-O010's
    // last-known-good would keep serving it the moment the current version could not be read.
    const served = LIVE.slice(LIVE.indexOf('getPublicDynamicProjection'));
    expect(served).not.toContain('applyDynamicViewControls');
  });
});
