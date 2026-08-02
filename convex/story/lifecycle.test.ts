import { readFileSync } from 'node:fs';
import {
  ALLOWED_ARC_TRANSITIONS,
  ArcLifecycleError,
  InMemoryArcLifecycleStore,
  assertArcSourceMatchesAcceptedEvent,
  createArcLifecycle,
  isActiveArcStatus,
  selectActiveArcContext,
  transitionArcLifecycle,
} from './lifecycle';
import { STORY_ARC_STATUSES, type ArcLifecycleRecord, type StoryArcStatus } from './model';

const provenance = (sequence: number) => ({
  sourceEventId: `w#event#${sequence}`,
  sourceEventSequenceNumber: sequence,
  reason: `transition ${sequence}`,
  changedAt: 1000 + sequence,
});

function recordAt(status: StoryArcStatus): ArcLifecycleRecord {
  return { ...createArcLifecycle('w', `arc-${status}`, provenance(0)), status };
}

function expectArcError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('expected ArcLifecycleError');
  } catch (error) {
    expect(error).toBeInstanceOf(ArcLifecycleError);
    expect(error).toMatchObject({ code });
  }
}

describe('FR-F002 Story Arc lifecycle', () => {
  it('allows every declared transition and rejects every undeclared transition', () => {
    for (const fromStatus of STORY_ARC_STATUSES) {
      for (const toStatus of STORY_ARC_STATUSES) {
        const input = { expectedStatus: fromStatus, toStatus, ...provenance(1) };
        if (ALLOWED_ARC_TRANSITIONS[fromStatus].includes(toStatus)) {
          expect(transitionArcLifecycle(recordAt(fromStatus), input).status).toBe(toStatus);
        } else {
          expect(() => transitionArcLifecycle(recordAt(fromStatus), input)).toThrow(ArcLifecycleError);
          try {
            transitionArcLifecycle(recordAt(fromStatus), input);
          } catch (error) {
            expect(error).toMatchObject({ code: 'ARC_INVALID_TRANSITION' });
          }
        }
      }
    }
  });

  it('rejects stale expected status, invalid provenance, and non-accepted source identity', () => {
    const emerging = createArcLifecycle('w', 'arc-1', provenance(0));
    expectArcError(() => transitionArcLifecycle(emerging, {
      expectedStatus: 'active', toStatus: 'escalating', ...provenance(1),
    }), 'ARC_STATUS_CONFLICT');
    expectArcError(() => createArcLifecycle('w', 'arc-2', { ...provenance(0), reason: '' }), 'ARC_INVALID_PROVENANCE');
    expectArcError(() => assertArcSourceMatchesAcceptedEvent('w#event#2', null), 'ARC_INVALID_PROVENANCE');
    expectArcError(() => assertArcSourceMatchesAcceptedEvent('w#event#2', 'w#event#1'), 'ARC_INVALID_PROVENANCE');
    expect(() => assertArcSourceMatchesAcceptedEvent('w#event#2', 'w#event#2')).not.toThrow();
  });

  it('excludes emerging, resolved, and archived arcs from main active context', () => {
    expect(STORY_ARC_STATUSES.filter(isActiveArcStatus)).toEqual(['active', 'escalating', 'climax', 'resolving']);
    const selected = selectActiveArcContext(STORY_ARC_STATUSES.map(recordAt));
    expect(selected.map((record) => record.status)).toEqual(['active', 'escalating', 'climax', 'resolving']);
  });

  it('preserves the complete transition history after archival and keeps it queryable', () => {
    const store = new InMemoryArcLifecycleStore();
    store.create(createArcLifecycle('w', 'arc-history', provenance(0)));
    const path: Array<[StoryArcStatus, StoryArcStatus]> = [
      ['emerging', 'active'], ['active', 'escalating'], ['escalating', 'climax'],
      ['climax', 'resolving'], ['resolving', 'resolved'], ['resolved', 'archived'],
    ];
    path.forEach(([expectedStatus, toStatus], index) => store.transition('w', 'arc-history', {
      expectedStatus, toStatus, ...provenance(index + 1),
    }));
    expect(store.active('w')).toEqual([]);
    const archived = store.get('w', 'arc-history');
    expect(archived).toMatchObject({ status: 'archived', revision: 6 });
    expect(archived?.transitions).toHaveLength(7);
    expect(archived?.transitions.map((transition) => transition.sourceEventId))
      .toEqual(Array.from({ length: 7 }, (_, index) => `w#event#${index}`));
  });

  it('keeps all persistence and query functions internal', () => {
    const source = readFileSync('convex/story/functions.ts', 'utf8');
    expect(source).toContain('internalMutation({');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{/);
    expect(source).not.toMatch(/\bquery\(\{/);
  });
});
