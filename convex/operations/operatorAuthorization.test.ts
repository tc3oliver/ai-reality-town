import { readFileSync } from 'node:fs';
import {
  authorizeOperator,
  buildOperatorAuditEntry,
  capabilitiesForRole,
  constantTimeEquals,
  hasCapability,
  isUnauthorizedError,
  OPS_CAPABILITIES,
  OPS_CAPABILITY_MINIMUM_ROLE,
  OPERATOR_ROLES,
  OperatorAuthorizationError,
  parseOperatorRegistry,
  resolveOperatorPrincipal,
  type OperatorRegistry,
  type OperatorRole,
  type OpsCapability,
} from './operatorAuthorization';

const REGISTRY_JSON = JSON.stringify([
  { operatorId: 'ops-admin', role: 'admin', subjects: ['clerk|admin-1'], token: 'admin-token-value' },
  { operatorId: 'ops-runner', role: 'operator', subjects: ['clerk|runner-1'], token: 'runner-token-value' },
  { operatorId: 'ops-reader', role: 'viewer', subjects: ['clerk|reader-1'] },
  { operatorId: 'ops-scoped', role: 'operator', subjects: ['clerk|scoped-1'], worldIds: ['mistwood'] },
  { operatorId: 'ops-retired', role: 'admin', subjects: ['clerk|retired-1'], token: 't', disabled: true },
]);

const registry = (): OperatorRegistry => parseOperatorRegistry(REGISTRY_JSON);

function expectDenied(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isUnauthorizedError(thrown)).toBe(true);
  // AC#3: the denial must be identical for every cause, so nothing about the
  // world, the operator, or the capability can be inferred from it.
  expect((thrown as Error).message).toBe('[OPS_UNAUTHORIZED] operator is not authorized for this operation');
}

describe('parseOperatorRegistry — fails closed', () => {
  it.each([
    ['unset', undefined],
    ['null', null],
    ['blank', '   '],
    ['not JSON', '{not json'],
    ['not an array', '{"operatorId":"a"}'],
    ['JSON null', 'null'],
  ])('returns an empty registry when the variable is %s', (_label, raw) => {
    expect(parseOperatorRegistry(raw)).toEqual([]);
  });

  it('drops malformed entries instead of throwing, keeping the valid ones', () => {
    const parsed = parseOperatorRegistry(JSON.stringify([
      { operatorId: 'good', role: 'admin', subjects: ['s1'] },
      { operatorId: '', role: 'admin', subjects: ['s2'] },
      { operatorId: 'bad-role', role: 'superuser', subjects: ['s3'] },
      { operatorId: 'no-credential', role: 'admin', subjects: [] },
      'not-an-object',
      null,
    ]));
    expect(parsed.map((entry) => entry.operatorId)).toEqual(['good']);
  });

  it('keeps only the first entry for a duplicated operatorId', () => {
    const parsed = parseOperatorRegistry(JSON.stringify([
      { operatorId: 'dup', role: 'viewer', subjects: ['s1'] },
      { operatorId: 'dup', role: 'admin', subjects: ['s2'] },
    ]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe('viewer');
  });

  it('normalizes an empty worldIds allowlist to "every world"', () => {
    const parsed = parseOperatorRegistry(JSON.stringify([
      { operatorId: 'a', role: 'admin', subjects: ['s'], worldIds: [] },
    ]));
    expect(parsed[0].worldIds).toBeUndefined();
  });
});

describe('constantTimeEquals', () => {
  it('matches identical strings and rejects every difference', () => {
    expect(constantTimeEquals('secret', 'secret')).toBe(true);
    expect(constantTimeEquals('secret', 'secreT')).toBe(false);
    expect(constantTimeEquals('secret', 'secre')).toBe(false);
    expect(constantTimeEquals('secret', 'secretx')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });

  it('inspects the whole input rather than short-circuiting on the first difference', () => {
    // A prefix-matching and a fully-mismatching candidate of equal length must
    // both be rejected; a short-circuiting compare would leak the shared prefix.
    expect(constantTimeEquals('abcdef', 'abcdeZ')).toBe(false);
    expect(constantTimeEquals('abcdef', 'ZZZZZZ')).toBe(false);
  });
});

describe('resolveOperatorPrincipal', () => {
  it('resolves a registered identity subject', () => {
    const principal = resolveOperatorPrincipal({ identity: { subject: 'clerk|admin-1' } }, registry());
    expect(principal).toEqual({ operatorId: 'ops-admin', role: 'admin', source: 'identity', subject: 'clerk|admin-1' });
  });

  it('falls back to tokenIdentifier when subject is absent', () => {
    const principal = resolveOperatorPrincipal({ identity: { subject: null, tokenIdentifier: 'clerk|reader-1' } }, registry());
    expect(principal?.operatorId).toBe('ops-reader');
  });

  it('resolves a matching operatorId + ops token', () => {
    const principal = resolveOperatorPrincipal({ operatorId: 'ops-runner', token: 'runner-token-value' }, registry());
    expect(principal).toEqual({ operatorId: 'ops-runner', role: 'operator', source: 'token', subject: 'token' });
  });

  it('never leaks the token into the principal', () => {
    const principal = resolveOperatorPrincipal({ operatorId: 'ops-admin', token: 'admin-token-value' }, registry());
    expect(JSON.stringify(principal)).not.toContain('admin-token-value');
  });

  it.each([
    ['no credentials at all', {}],
    ['a null identity', { identity: null }],
    ['an unknown subject', { identity: { subject: 'clerk|stranger' } }],
    ['a blank subject', { identity: { subject: '  ' } }],
    ['a token without an operatorId', { token: 'admin-token-value' }],
    ['an operatorId without a token', { operatorId: 'ops-admin' }],
    ['a wrong token', { operatorId: 'ops-admin', token: 'not-the-token' }],
    ["another operator's token", { operatorId: 'ops-admin', token: 'runner-token-value' }],
    ['an unknown operatorId', { operatorId: 'ghost', token: 'admin-token-value' }],
    ['a viewer entry that has no token', { operatorId: 'ops-reader', token: 'anything' }],
  ])('returns null for %s', (_label, credentials) => {
    expect(resolveOperatorPrincipal(credentials, registry())).toBeNull();
  });

  it('refuses a disabled operator on both the identity and the token path', () => {
    expect(resolveOperatorPrincipal({ identity: { subject: 'clerk|retired-1' } }, registry())).toBeNull();
    expect(resolveOperatorPrincipal({ operatorId: 'ops-retired', token: 't' }, registry())).toBeNull();
  });

  it('prefers a verified identity over a supplied token', () => {
    const principal = resolveOperatorPrincipal(
      { identity: { subject: 'clerk|reader-1' }, operatorId: 'ops-admin', token: 'admin-token-value' },
      registry(),
    );
    expect(principal).toMatchObject({ operatorId: 'ops-reader', role: 'viewer', source: 'identity' });
  });

  it('resolves nothing against an empty registry', () => {
    expect(resolveOperatorPrincipal({ identity: { subject: 'clerk|admin-1' } }, [])).toBeNull();
  });
});

describe('capability matrix', () => {
  it('covers every FR-K001 control exactly once, plus the FR-K006 emergency, FR-K003 remediation, FR-P004 safety and FR-Q002 dynamic-view controls', () => {
    expect([...OPS_CAPABILITIES].sort()).toEqual([
      // FR-M003 / ART-59. Two, for the reason FR-K005 has two, and separated from
      // `model_config.*` because they govern different things: model configuration decides HOW a
      // world is authored, a budget decides WHETHER it is authored at all today.
      'budget.inspect', 'budget.write',
      'canon.compensate', 'canon.correct', 'canon.retcon',
      // FR-Q002 / ART-134. Named individually rather than counted, so adding a capability
      // is a reviewed edit here as well as there — which is the whole point of an
      // exhaustive list, and is how this test caught the five new ones.
      'dynamic.hide', 'dynamic.inspect', 'dynamic.pause', 'dynamic.pin_snapshot',
      'dynamic.rebuild',
      // FR-K005 / ART-52. Two, not one: writing decides which model authors every subsequent
      // scene and what the world costs, while reading is as read-only as `world.inspect`.
      'model_config.inspect', 'model_config.write',
      'run.retry', 'safety.override', 'scene.cancel', 'schedule.inspect', 'slot.advance',
      'snapshot.create', 'world.emergency_resume', 'world.emergency_stop',
      'world.inspect', 'world.pause', 'world.resume', 'world.rollback',
    ]);
    expect(Object.keys(OPS_CAPABILITY_MINIMUM_ROLE).sort()).toEqual([...OPS_CAPABILITIES].sort());
  });

  const expected: Record<OperatorRole, OpsCapability[]> = {
    // `dynamic.inspect` joins the viewer set: reading the state of the public view is not
    // the authority to change it, which is why it is a separate capability from the four
    // that do change it.
    // `model_config.inspect` joins it for the same reason: reading what a world is configured
    // to do is not the authority to change it, and `model_config.write` is `admin`.
    viewer: ['world.inspect', 'schedule.inspect', 'dynamic.inspect', 'model_config.inspect',
      'budget.inspect'],
    operator: ['world.pause', 'world.resume', 'slot.advance', 'run.retry', 'scene.cancel',
      'world.inspect', 'schedule.inspect', 'model_config.inspect', 'budget.inspect',
      'dynamic.inspect', 'dynamic.pause', 'dynamic.pin_snapshot', 'dynamic.hide', 'dynamic.rebuild'],
    admin: [...OPS_CAPABILITIES],
  };

  it.each(OPERATOR_ROLES)('grants %s exactly its documented capabilities', (role) => {
    expect(capabilitiesForRole(role).sort()).toEqual([...expected[role]].sort());
  });

  it('reserves snapshot creation for an administrator', () => {
    expect(hasCapability('admin', 'snapshot.create')).toBe(true);
    expect(hasCapability('operator', 'snapshot.create')).toBe(false);
    expect(hasCapability('viewer', 'snapshot.create')).toBe(false);
  });

  it('gives a viewer no write capability at all', () => {
    // Derived from the role table rather than from a second hand-written list: an inspect
    // capability added later is exempt automatically, and a WRITE capability added later is
    // not — which is the direction that matters.
    const readOnly: readonly OpsCapability[] = [
      'world.inspect', 'schedule.inspect', 'dynamic.inspect', 'model_config.inspect',
      'budget.inspect',
    ];
    for (const capability of OPS_CAPABILITIES) {
      if (readOnly.includes(capability)) continue;
      expect(hasCapability('viewer', capability)).toBe(false);
    }
  });
});

describe('authorizeOperator', () => {
  it('authorizes an admin for every capability', () => {
    for (const capability of OPS_CAPABILITIES) {
      const principal = authorizeOperator({
        credentials: { identity: { subject: 'clerk|admin-1' } }, registry: registry(), capability, worldId: 'mistwood',
      });
      expect(principal.operatorId).toBe('ops-admin');
    }
  });

  it('authorizes an operator for the running-world controls', () => {
    for (const capability of ['world.pause', 'world.resume', 'slot.advance', 'run.retry', 'scene.cancel'] as const) {
      expect(authorizeOperator({
        credentials: { identity: { subject: 'clerk|runner-1' } }, registry: registry(), capability, worldId: 'mistwood',
      }).role).toBe('operator');
    }
  });

  it.each(OPS_CAPABILITIES)('denies an unauthenticated caller %s with the uniform error', (capability) => {
    expectDenied(() => authorizeOperator({
      credentials: {}, registry: registry(), capability, worldId: 'mistwood',
    }));
  });

  it.each(OPS_CAPABILITIES)('denies a caller with an empty registry %s with the uniform error', (capability) => {
    expectDenied(() => authorizeOperator({
      credentials: { identity: { subject: 'clerk|admin-1' } }, registry: [], capability, worldId: 'mistwood',
    }));
  });

  it('denies an under-privileged operator without revealing the required role', () => {
    expectDenied(() => authorizeOperator({
      credentials: { identity: { subject: 'clerk|runner-1' } }, registry: registry(),
      capability: 'snapshot.create', worldId: 'mistwood',
    }));
    expectDenied(() => authorizeOperator({
      credentials: { identity: { subject: 'clerk|reader-1' } }, registry: registry(),
      capability: 'world.pause', worldId: 'mistwood',
    }));
  });

  it('enforces the per-operator world allowlist', () => {
    expect(authorizeOperator({
      credentials: { identity: { subject: 'clerk|scoped-1' } }, registry: registry(),
      capability: 'world.pause', worldId: 'mistwood',
    }).operatorId).toBe('ops-scoped');
    expectDenied(() => authorizeOperator({
      credentials: { identity: { subject: 'clerk|scoped-1' } }, registry: registry(),
      capability: 'world.pause', worldId: 'other-world',
    }));
  });

  it('denies a blank worldId and an unknown capability', () => {
    expectDenied(() => authorizeOperator({
      credentials: { identity: { subject: 'clerk|admin-1' } }, registry: registry(),
      capability: 'world.pause', worldId: '  ',
    }));
    expectDenied(() => authorizeOperator({
      credentials: { identity: { subject: 'clerk|admin-1' } }, registry: registry(),
      capability: 'world.destroy' as OpsCapability, worldId: 'mistwood',
    }));
  });

  it('produces a byte-identical denial across every unauthorized shape (AC#3)', () => {
    const messages = new Set<string>();
    const attempts: Parameters<typeof authorizeOperator>[0][] = [
      { credentials: {}, registry: registry(), capability: 'world.pause', worldId: 'mistwood' },
      { credentials: {}, registry: registry(), capability: 'snapshot.create', worldId: 'no-such-world' },
      { credentials: { identity: { subject: 'clerk|stranger' } }, registry: registry(), capability: 'world.inspect', worldId: 'mistwood' },
      { credentials: { identity: { subject: 'clerk|reader-1' } }, registry: registry(), capability: 'scene.cancel', worldId: 'mistwood' },
      { credentials: { operatorId: 'ops-admin', token: 'wrong' }, registry: registry(), capability: 'run.retry', worldId: 'mistwood' },
      { credentials: { identity: { subject: 'clerk|retired-1' } }, registry: registry(), capability: 'world.resume', worldId: 'mistwood' },
    ];
    for (const attempt of attempts) {
      try {
        authorizeOperator(attempt);
        throw new Error('expected a denial');
      } catch (error) {
        messages.add((error as Error).message);
      }
    }
    expect(messages.size).toBe(1);
  });
});

describe('buildOperatorAuditEntry', () => {
  const principal = { operatorId: 'ops-admin', role: 'admin' as const, source: 'identity' as const, subject: 'clerk|admin-1' };

  it('records who, what, why, and when', () => {
    const entry = buildOperatorAuditEntry({
      principal, worldId: 'mistwood', capability: 'world.pause', target: 'mistwood',
      reason: 'provider outage', outcome: 'applied', resultCode: 'OPS_OK', at: 1_700,
    });
    expect(entry).toEqual({
      schemaVersion: 1, worldId: 'mistwood', operatorId: 'ops-admin', subject: 'clerk|admin-1',
      role: 'admin', source: 'identity', capability: 'world.pause', target: 'mistwood',
      reason: 'provider outage', outcome: 'applied', resultCode: 'OPS_OK', at: 1_700,
    });
  });

  it('requires a non-empty reason', () => {
    expect(() => buildOperatorAuditEntry({
      principal, worldId: 'mistwood', capability: 'world.pause', reason: '   ',
      outcome: 'applied', resultCode: 'OPS_OK', at: 1,
    })).toThrow(OperatorAuthorizationError);
  });

  it('rejects a non-finite timestamp', () => {
    expect(() => buildOperatorAuditEntry({
      principal, worldId: 'mistwood', capability: 'world.pause', reason: 'r',
      outcome: 'applied', resultCode: 'OPS_OK', at: Number.NaN,
    })).toThrow(OperatorAuthorizationError);
  });

  it('refuses to write credential material into the audit trail (NFR-005)', () => {
    expect(() => buildOperatorAuditEntry({
      principal, worldId: 'mistwood', capability: 'world.pause',
      reason: 'rotating token=abc123', outcome: 'applied', resultCode: 'OPS_OK', at: 1,
    })).toThrow(/OPS_AUDIT_SECRET_LEAK/);
    expect(() => buildOperatorAuditEntry({
      principal, worldId: 'mistwood', capability: 'world.pause', target: 'apiKey:sk-live-1',
      reason: 'r', outcome: 'applied', resultCode: 'OPS_OK', at: 1,
    })).toThrow(/OPS_AUDIT_SECRET_LEAK/);
  });

  it('normalizes a blank target to absent', () => {
    const entry = buildOperatorAuditEntry({
      principal, worldId: 'mistwood', capability: 'world.pause', target: '  ',
      reason: 'r', outcome: 'no_op', resultCode: 'OPS_NO_OP', at: 1,
    });
    expect(entry.target).toBeUndefined();
  });
});

describe('audit H-1 — retiring the shared ops-token once identity is configured', () => {
  it('resolveOperatorPrincipal ignores the token when allowTokenFallback is false', () => {
    const tokenOnly = { operatorId: 'ops-admin', token: 'admin-token-value' };
    // Bootstrap era default: the token still admits.
    expect(resolveOperatorPrincipal(tokenOnly, registry())).toMatchObject({ source: 'token' });
    // Token branch closed: the same credentials are refused...
    expect(resolveOperatorPrincipal(tokenOnly, registry(), false)).toBeNull();
    // ...while verified identity still works.
    expect(resolveOperatorPrincipal({ identity: { subject: 'clerk|admin-1' } }, registry(), false))
      .toMatchObject({ operatorId: 'ops-admin', source: 'identity' });
  });

  it('authorizeOperator denies token-only credentials once the token branch is closed', () => {
    const tokenOnly = { operatorId: 'ops-runner', token: 'runner-token-value' };
    expect(authorizeOperator({
      credentials: tokenOnly, registry: registry(), capability: 'world.pause', worldId: 'mistwood',
    }).operatorId).toBe('ops-runner');
    expectDenied(() => authorizeOperator({
      credentials: tokenOnly, registry: registry(), capability: 'world.pause',
      worldId: 'mistwood', allowTokenFallback: false,
    }));
    const byIdentity = authorizeOperator({
      credentials: { identity: { subject: 'clerk|admin-1' } }, registry: registry(),
      capability: 'world.emergency_stop', worldId: 'mistwood', allowTokenFallback: false,
    });
    expect(byIdentity.operatorId).toBe('ops-admin');
  });

  it('requireOperator closes the token branch once CLERK_JWT_ISSUER_DOMAIN is set', () => {
    const source = readFileSync('convex/operations/opsConsoleFunctions.ts', 'utf8');
    expect(source).toContain("process.env.SIMULATION_OPS_ALLOW_TOKEN_FALLBACK === '1'");
    expect(source).toContain('!process.env.CLERK_JWT_ISSUER_DOMAIN');
    expect(source).toContain('allowTokenFallback,');
  });
});
