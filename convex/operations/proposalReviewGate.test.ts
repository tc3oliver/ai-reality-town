/**
 * ART-154 / audit finding H-1 — the review surface's authorization gate, tested through the
 * REGISTERED QUERIES rather than through the pure policy module.
 *
 * The defect this file exists for was invisible to every test that already covered review
 * authorization, and the reason is worth stating: `proposalReview.test.ts`'s gate section calls
 * `authorizeOperator` directly, supplying `registry` and `capability` itself. That is the pure
 * policy, and the pure policy was never wrong. What was wrong was the WIRING — the argument the
 * query's own helper failed to pass — and a test that constructs the policy call by hand can
 * never see a missing argument at a call site it does not use.
 *
 * So both halves below go through `_handler` on the real `query` exports, with `process.env` set
 * to the deployment's actual configuration, and assert on the outcome a client would get.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';

import { isUnauthorizedError } from './operatorAuthorization';
import { listProposedEventReviews, reviewProposedEvent } from './proposalReviewFunctions';

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

const WORLD_ID = 'mistwood';
const OPERATOR_ID = 'ops-run';
const TOKEN = 'shared-bootstrap-token';

const REGISTRY = JSON.stringify([
  { operatorId: OPERATOR_ID, role: 'operator', subjects: ['clerk|runner'], token: TOKEN },
]);

/**
 * Enough of a `ctx` to reach — or be refused before — the store reads.
 *
 * Every query returns empty, which is a legitimate answer for a world with no scenes: the
 * admitted case below asserts `[]`, and the denied case never gets here at all, because
 * `requireOperator` is the first statement in both handlers. That ordering is itself part of
 * FR-K001 AC#3 (a denied caller must not learn whether the world exists), so a future change
 * that read first and authorized second would surface here as the denial test seeing a read.
 */
function makeCtx(identitySubject: string | null) {
  let reads = 0;
  const empty: Record<string, unknown> = {
    withIndex: () => empty,
    order: () => empty,
    filter: () => empty,
    collect: () => { reads += 1; return Promise.resolve([]); },
    take: () => { reads += 1; return Promise.resolve([]); },
    first: () => { reads += 1; return Promise.resolve(null); },
    unique: () => { reads += 1; return Promise.resolve(null); },
  };
  return {
    ctx: {
      auth: {
        getUserIdentity: () => Promise.resolve(identitySubject === null ? null : { subject: identitySubject }),
      },
      db: { query: () => empty, get: () => { reads += 1; return Promise.resolve(null); } },
    },
    readCount: () => reads,
  };
}

const QUERIES: Array<[string, Registered, Record<string, unknown>]> = [
  ['listProposedEventReviews', listProposedEventReviews as unknown as Registered, {}],
  ['reviewProposedEvent', reviewProposedEvent as unknown as Registered, { idempotencyKey: 'whatever' }],
];

describe('ART-154: the review queries honour the same token-retirement switch as the ops console', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    delete process.env.SIMULATION_OPS_ALLOW_TOKEN_FALLBACK;
    delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  /**
   * THE REGRESSION. This is the deployment's real configuration as of 2026-09-06:
   * `CLERK_JWT_ISSUER_DOMAIN` set, escape hatch unset. Before ART-154 both queries returned data
   * here, because their private gate never passed `allowTokenFallback` and `authorizeOperator`
   * defaults it to `true`.
   */
  it.each(QUERIES)('denies a token-only caller to %s once an identity provider is configured', async (_name, fn, extra) => {
    process.env.CLERK_JWT_ISSUER_DOMAIN = 'example.clerk.accounts.dev';
    const { ctx, readCount } = makeCtx(null);

    let thrown: unknown = null;
    try {
      await fn._handler(ctx, { worldId: WORLD_ID, operatorId: OPERATOR_ID, operatorToken: TOKEN, ...extra });
    } catch (error) {
      thrown = error;
    }
    // The uniform console denial specifically — not merely "it threw", which a broken fixture
    // would also satisfy.
    expect(thrown).not.toBeNull();
    expect(isUnauthorizedError(thrown)).toBe(true);

    // Denied before any row was touched (FR-K001 AC#3), not denied after leaking existence.
    expect(readCount()).toBe(0);
  });

  /**
   * The other side of the switch, so the test above cannot pass merely because everything is
   * denied. A deployment that has not yet configured an identity provider must keep working on
   * the bootstrap token, or retiring the token locks the operator out — the exact failure mode
   * `requireOperator`'s own comment warns about.
   */
  it.each(QUERIES)('still admits the token-only caller to %s before an identity provider exists', async (_name, fn, extra) => {
    const { ctx } = makeCtx(null);
    await expect(fn._handler(ctx, {
      worldId: WORLD_ID, operatorId: OPERATOR_ID, operatorToken: TOKEN, ...extra,
    })).resolves.toBeDefined();
  });

  /** ...and the explicit escape hatch still overrides a configured provider, as documented. */
  it.each(QUERIES)('honours SIMULATION_OPS_ALLOW_TOKEN_FALLBACK=1 for %s', async (_name, fn, extra) => {
    process.env.CLERK_JWT_ISSUER_DOMAIN = 'example.clerk.accounts.dev';
    process.env.SIMULATION_OPS_ALLOW_TOKEN_FALLBACK = '1';
    const { ctx } = makeCtx(null);
    await expect(fn._handler(ctx, {
      worldId: WORLD_ID, operatorId: OPERATOR_ID, operatorToken: TOKEN, ...extra,
    })).resolves.toBeDefined();
  });

  /** A verified identity is unaffected by any of the above — it is the path the switch moves TO. */
  it.each(QUERIES)('admits a registered verified identity to %s with the provider configured', async (_name, fn, extra) => {
    process.env.CLERK_JWT_ISSUER_DOMAIN = 'example.clerk.accounts.dev';
    const { ctx } = makeCtx('clerk|runner');
    await expect(fn._handler(ctx, { worldId: WORLD_ID, ...extra })).resolves.toBeDefined();
  });
});

/**
 * The structural half. The behavioural tests above prove THESE two queries are fixed; this one
 * is what stops the same defect being reintroduced by a third surface next quarter.
 *
 * `authorizeOperator` takes `allowTokenFallback` as an OPTIONAL argument defaulting to `true`,
 * which means every direct caller is one forgotten line away from a permanently open token path,
 * and the omission is invisible at the call site. Making the argument required was considered and
 * rejected: it would force the value on unit tests of the pure policy, where the default is
 * exactly the right thing and the deployment env is not in scope. Constraining WHO may call it is
 * the narrower fix — the env-reading wrapper stays in one place, and this test names it.
 */
describe('ART-154: authorizeOperator has exactly one production call site', () => {
  // Repo-relative, matching `convex/canon/reducer.purity.test.ts`'s source scan: Jest runs with
  // the repository root as cwd, and that test has depended on it for as long as it has existed.
  const CONVEX_ROOT = 'convex';
  const ALLOWED = ['operations/opsConsoleFunctions.ts'];
  // Where the function is DEFINED, and where its own `allowTokenFallback ?? true` default lives.
  const DEFINITION = 'operations/operatorAuthorization.ts';

  function productionSources(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === '_generated' || entry === 'node_modules') continue;
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) { productionSources(full, acc); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
      acc.push(full);
    }
    return acc;
  }

  it('finds the sources it claims to scan', () => {
    // Guard against the silent-pass shape of this whole test: an empty or mis-rooted file list
    // would make the assertion below trivially true for the wrong reason.
    const sources = productionSources(CONVEX_ROOT).map((file) => file.slice(CONVEX_ROOT.length + 1));
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain(DEFINITION);
    expect(sources).toContain('operations/proposalReviewFunctions.ts');
  });

  it('is called only by the wrapper that reads the deployment env', () => {
    const callers = productionSources(CONVEX_ROOT)
      .map((file) => file.slice(CONVEX_ROOT.length + 1))
      .filter((file) => file !== DEFINITION)
      .filter((file) => /\bauthorizeOperator\s*\(/.test(readFileSync(`${CONVEX_ROOT}/${file}`, 'utf8')))
      .sort();

    expect(callers).toEqual(ALLOWED);
  });
});
