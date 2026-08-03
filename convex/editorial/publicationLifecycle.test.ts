import {
  assertAuthorized,
  createPublicationRecord,
  isPublishable,
  isTerminalPublicationStatus,
  PUBLICATION_STATUSES,
  regeneratePublication,
  transitionPublication,
  validatePublicationRecord,
  PublicationLifecycleError,
  type PublicationActor,
  type PublicationRecord,
} from './publicationLifecycle';

const admin: PublicationActor = { type: 'admin', id: 'op-1' };
const system: PublicationActor = { type: 'system', id: 'scheduler' };

function freshRecord(over: Partial<PublicationRecord> = {}): PublicationRecord {
  return createPublicationRecord({
    publicationId: 'pub-1',
    worldId: 'w1',
    contentKind: 'episode',
    contentRef: 'episode:w1:1',
    summary: 'A quiet morning in Mistwood.',
    actor: system,
    reason: 'generated from accepted events',
    at: 1_000,
    ...over,
  });
}

describe('createPublicationRecord', () => {
  it('starts a record in generated at version 1 with a create audit event', () => {
    const record = freshRecord();
    expect(record.status).toBe('generated');
    expect(record.version).toBe(1);
    expect(record.audit).toHaveLength(1);
    expect(record.audit[0].action).toBe('create');
    expect(record.audit[0].versionBefore).toBe(0);
    expect(record.audit[0].versionAfter).toBe(1);
  });

  it('rejects an empty contentRef and empty reason', () => {
    expect(() => createPublicationRecord({
      publicationId: 'pub-x', worldId: 'w1', contentKind: 'episode', contentRef: '', summary: null,
      actor: system, reason: 'r', at: 1,
    })).toThrow(PublicationLifecycleError);
    expect(() => createPublicationRecord({
      publicationId: 'pub-x', worldId: 'w1', contentKind: 'episode', contentRef: 'c', summary: null,
      actor: system, reason: ' ', at: 1,
    })).toThrow(PublicationLifecycleError);
  });
});

describe('transitionPublication — legal happy path', () => {
  it('advances generated -> validated -> safety_review -> ready -> published', () => {
    let record = freshRecord();
    record = transitionPublication(record, 'validate', system, 'validated episode shape', 2_000);
    expect(record.status).toBe('validated');
    record = transitionPublication(record, 'begin_safety_review', system, 'safety review started', 3_000);
    expect(record.status).toBe('safety_review');
    record = transitionPublication(record, 'pass_safety_review', system, 'safety passed', 4_000);
    expect(record.status).toBe('ready');
    expect(isPublishable(record)).toBe(true);
    record = transitionPublication(record, 'publish', admin, 'publish to public read model', 5_000);
    expect(record.status).toBe('published');
    expect(isPublishable(record)).toBe(false);
    // Audit accumulated in order, versions untouched across forward transitions.
    expect(record.audit.map((event) => event.action)).toEqual(['create', 'validate', 'begin_safety_review', 'pass_safety_review', 'publish']);
    expect(record.version).toBe(1);
  });

  it('does not mutate the input record (returns a new audited copy)', () => {
    const record = freshRecord();
    const snapshotAuditLen = record.audit.length;
    const next = transitionPublication(record, 'validate', system, 'r', 2_000);
    expect(record.audit).toHaveLength(snapshotAuditLen);
    expect(next.audit).toHaveLength(snapshotAuditLen + 1);
    expect(record.status).toBe('generated');
  });
});

describe('withhold and resume', () => {
  it('can withhold a ready record without touching canon (pure module has no canon surface)', () => {
    const ready = transitionPublication(
      transitionPublication(transitionPublication(freshRecord(), 'validate', system, 'r', 2), 'begin_safety_review', system, 'r', 3),
      'pass_safety_review', system, 'r', 4,
    );
    const withheld = transitionPublication(ready, 'withhold', admin, 'inappropriate content reported', 5_000);
    expect(withheld.status).toBe('withheld');
    expect(withheld.audit.at(-1)?.action).toBe('withhold');
    // FR-K004 AC#2: withholding is a status change only; nothing is deleted.
    expect(withheld.worldId).toBe(ready.worldId);
    expect(withheld.summary).toBe(ready.summary);
  });

  it('can withhold a published record and then resume it to ready', () => {
    let record = transitionPublication(
      transitionPublication(transitionPublication(transitionPublication(freshRecord(), 'validate', system, 'r', 2), 'begin_safety_review', system, 'r', 3), 'pass_safety_review', system, 'r', 4),
      'publish', admin, 'r', 5,
    );
    record = transitionPublication(record, 'withhold', admin, 'takedown', 6_000);
    expect(record.status).toBe('withheld');
    record = transitionPublication(record, 'resume_to_ready', admin, 'cleared on review', 7_000);
    expect(record.status).toBe('ready');
  });
});

describe('illegal transitions', () => {
  it('rejects publishing straight from generated (skipping validation and review)', () => {
    expect(() => transitionPublication(freshRecord(), 'publish', admin, 'r', 2)).toThrow(PublicationLifecycleError);
  });

  it('rejects resuming a record that is not withheld', () => {
    expect(() => transitionPublication(freshRecord(), 'resume_to_ready', admin, 'r', 2)).toThrow(PublicationLifecycleError);
  });

  it('rejects every transition out of the terminal superseded status', () => {
    const { supersededPrior } = regeneratePublication(freshRecord(), 'pub-2', 'new summary', admin, 'refresh', 9_000);
    expect(isTerminalPublicationStatus(supersededPrior.status)).toBe(true);
    expect(() => transitionPublication(supersededPrior, 'publish', admin, 'r', 10)).toThrow(PublicationLifecycleError);
    expect(() => transitionPublication(supersededPrior, 'withhold', admin, 'r', 10)).toThrow(PublicationLifecycleError);
  });
});

describe('authorization', () => {
  it('allows the system actor to drive generation-stage transitions', () => {
    const record = transitionPublication(freshRecord(), 'validate', system, 'r', 2);
    expect(record.status).toBe('validated');
  });

  it('requires an administrator for publish, withhold, resume, and regenerate', () => {
    const ready = transitionPublication(
      transitionPublication(transitionPublication(freshRecord(), 'validate', system, 'r', 2), 'begin_safety_review', system, 'r', 3),
      'pass_safety_review', system, 'r', 4,
    );
    expect(() => transitionPublication(ready, 'publish', system, 'r', 5)).toThrow(PublicationLifecycleError);
    expect(() => transitionPublication(ready, 'withhold', system, 'r', 5)).toThrow(PublicationLifecycleError);
    expect(() => regeneratePublication(ready, 'pub-2', null, system, 'r', 5)).toThrow(PublicationLifecycleError);
  });

  it('rejects an unknown actor type', () => {
    expect(() => assertAuthorized('publish', { type: 'viewer' as unknown as 'admin', id: 'x' })).toThrow(PublicationLifecycleError);
  });
});

describe('regeneratePublication', () => {
  it('supersedes the current record and spawns a fresh generated record at the next version with a new summary', () => {
    const published = transitionPublication(
      transitionPublication(transitionPublication(transitionPublication(freshRecord(), 'validate', system, 'r', 2), 'begin_safety_review', system, 'r', 3), 'pass_safety_review', system, 'r', 4),
      'publish', admin, 'r', 5,
    );
    const { supersededPrior, next } = regeneratePublication(published, 'pub-2', 'Revised public summary.', admin, 'admin refreshed summary', 9_000);
    expect(supersededPrior.status).toBe('superseded');
    expect(supersededPrior.version).toBe(1);
    expect(supersededPrior.audit.at(-1)).toMatchObject({ action: 'regenerate', toStatus: 'superseded', versionAfter: 2 });
    expect(next.status).toBe('generated');
    expect(next.version).toBe(2);
    expect(next.summary).toBe('Revised public summary.');
    expect(next.publicationId).toBe('pub-2');
    expect(next.audit.at(-1)).toMatchObject({ action: 'create', versionBefore: 1, versionAfter: 2 });
  });

  it('refuses to regenerate an already-superseded record', () => {
    const { supersededPrior } = regeneratePublication(freshRecord(), 'pub-2', null, admin, 'r', 9);
    expect(() => regeneratePublication(supersededPrior, 'pub-3', null, admin, 'r', 10)).toThrow(PublicationLifecycleError);
  });
});

describe('validatePublicationRecord', () => {
  it('round-trips a well-formed record and rejects malformed rows', () => {
    const record = freshRecord();
    const parsed = validatePublicationRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed).toEqual(record);
    expect(() => validatePublicationRecord({ ...record, status: 'frozen' })).toThrow(PublicationLifecycleError);
    expect(() => validatePublicationRecord({ ...record, version: 0 })).toThrow(PublicationLifecycleError);
    expect(() => validatePublicationRecord({ ...record, schemaVersion: 2 })).toThrow(PublicationLifecycleError);
  });
});

describe('publication status catalogue', () => {
  it('exposes the seven FR-K004 statuses', () => {
    expect(PUBLICATION_STATUSES).toEqual([
      'generated', 'validated', 'safety_review', 'ready', 'published', 'withheld', 'superseded',
    ]);
  });
});
