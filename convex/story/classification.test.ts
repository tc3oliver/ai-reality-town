import { readFileSync } from 'node:fs';
import { ARC_EVENT_ROLES, type ArcEventClassification } from './model';
import {
  MAX_EVENT_ARC_MEMBERSHIPS, MAX_PRIMARY_ARC_MEMBERSHIPS, ArcClassificationError,
  parseArcEventClassification, validateArcClassificationReferences,
} from './classification';

function classification(overrides: Partial<ArcEventClassification> = {}): ArcEventClassification {
  return {
    schemaVersion: 1, worldId: 'w', sourceEventId: 'w#event#4', sourceEventSequenceNumber: 4,
    memberships: [{ arcId: 'arc-a', primary: true, importance: 0.8, role: 'development', coreCharacterIdsAdded: ['a'], coreCharacterIdsRemoved: [] }],
    newArc: null, ...overrides,
  };
}

describe('FR-F001 Story Arc event classification', () => {
  it('accepts bounded multi-arc membership and every declared event role', () => {
    const memberships = ARC_EVENT_ROLES.map((role, index) => ({
      arcId: `arc-${index}`, primary: index < MAX_PRIMARY_ARC_MEMBERSHIPS,
      importance: 0.8, role, coreCharacterIdsAdded: [], coreCharacterIdsRemoved: [],
    })).slice(0, MAX_EVENT_ARC_MEMBERSHIPS);
    expect(parseArcEventClassification(classification({ memberships })).memberships).toEqual(memberships);
  });

  it('rejects membership overflow, duplicate arcs, and too many primary arcs', () => {
    const item = classification().memberships[0];
    expect(() => parseArcEventClassification(classification({ memberships: Array.from({ length: MAX_EVENT_ARC_MEMBERSHIPS + 1 }, (_, index) => ({ ...item, arcId: `a-${index}` })) }))).toThrow('[ARC_CLASSIFICATION_MEMBERSHIP_LIMIT]');
    expect(() => parseArcEventClassification(classification({ memberships: [item, { ...item }] }))).toThrow('duplicate arc');
    expect(() => parseArcEventClassification(classification({ memberships: Array.from({ length: MAX_PRIMARY_ARC_MEMBERSHIPS + 1 }, (_, index) => ({ ...item, arcId: `a-${index}` })) }))).toThrow('[ARC_CLASSIFICATION_PRIMARY_LIMIT]');
  });

  it('requires a new arc to have premise/question and an inciting membership', () => {
    const inciting = { ...classification().memberships[0], arcId: 'new', role: 'inciting_incident' as const };
    const valid = classification({ memberships: [inciting], newArc: { arcId: 'new', title: 'The stopped clock', premise: 'A warning divides the town.', currentQuestion: 'Who stopped the clock?', coreCharacterIds: ['a'] } });
    expect(parseArcEventClassification(valid).newArc?.premise).toBe('A warning divides the town.');
    expect(() => parseArcEventClassification({ ...valid, newArc: { ...valid.newArc!, premise: '' } })).toThrow('non-empty text');
    expect(() => parseArcEventClassification({ ...valid, memberships: [{ ...inciting, role: 'development' }] })).toThrow('inciting incident');
  });

  it('prevents low-importance events from creating arbitrary arcs', () => {
    const item = { ...classification().memberships[0], arcId: 'new', importance: 0.59, role: 'inciting_incident' as const };
    expect(() => parseArcEventClassification(classification({ memberships: [item], newArc: { arcId: 'new', title: 'Minor chat', premise: 'A passing remark.', currentQuestion: 'Will anyone care?', coreCharacterIds: ['a'] } }))).toThrow('[ARC_CLASSIFICATION_LOW_IMPORTANCE_NEW_ARC]');
  });

  it('validates existing arc and changed core-character references', () => {
    const parsed = parseArcEventClassification(classification());
    expect(() => validateArcClassificationReferences(parsed, new Set(), new Set(['a']))).toThrow('[ARC_CLASSIFICATION_UNKNOWN_ARC]');
    expect(() => validateArcClassificationReferences(parsed, new Set(['arc-a']), new Set())).toThrow('[ARC_CLASSIFICATION_UNKNOWN_CHARACTER]');
    expect(() => validateArcClassificationReferences(parsed, new Set(['arc-a']), new Set(['a']))).not.toThrow();
  });

  it('keeps classification persistence and reads internal-only', () => {
    const source = readFileSync('convex/story/classificationFunctions.ts', 'utf8');
    expect(source).toContain('internalMutation'); expect(source).toContain('internalQuery');
    expect(source).not.toMatch(/import\s*\{[^}]*\b(?:mutation|query)\b/); expect(ArcClassificationError).toBeDefined();
  });
});
