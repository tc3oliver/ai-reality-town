import { readFileSync } from 'node:fs';
import {
  assertSanitizedSummaryFidelity,
  classifyPostGeneration,
  gatePostGenerationPublication,
  type PostGenerationCandidate,
} from './postGeneration';

const candidate = (text: string, kind: 'scene' | 'public_artifact' = 'public_artifact'): PostGenerationCandidate => ({
  classificationId: 'safety-1', worldId: 'w', sourceId: 'episode-1', kind, text,
  coreFactIds: ['w#event#1', 'w#event#2'],
});

describe('FR-L002 post-generation safety classification and gating', () => {
  it('labels ordinary and warning content while allowing publication', async () => {
    expect(classifyPostGeneration(candidate('The mayor opened the meeting.')).label).toBe('allow');
    expect(classifyPostGeneration(candidate('A resident was injured in a fight.'))).toMatchObject({
      label: 'allow_with_warning', warningCodes: ['NON_GRAPHIC_VIOLENCE'],
    });
    const published: string[] = [];
    const result = await gatePostGenerationPublication(candidate('A resident was injured.'), ({ sourceId }) => {
      published.push(sourceId);
      return Promise.resolve();
    });
    expect(result.publishable).toBe(true);
    expect(published).toEqual(['episode-1']);
  });

  it.each([
    ['explicit sexual content', 'EXPLICIT_SEXUAL_CONTENT'],
    ['graphic torture', 'EXTREME_VIOLENCE_DETAIL'],
    ['detailed instructions to break into a home', 'REAL_CRIME_INSTRUCTION'],
  ])('withholds high-risk content and exposes a stable reason (%s)', async (text, code) => {
    let publishCalls = 0;
    const publish = (): Promise<void> => { publishCalls += 1; return Promise.resolve(); };
    const result = await gatePostGenerationPublication(candidate(text), publish);
    expect(result).toMatchObject({ publishable: false, classification: { label: 'withhold', reasonCodes: [code] } });
    expect(publishCalls).toBe(0);
  });

  it('routes personal data and real-person impersonation to human review without publishing', async () => {
    let publishCalls = 0;
    const publish = (): Promise<void> => { publishCalls += 1; return Promise.resolve(); };
    expect((await gatePostGenerationPublication(candidate('Her private address was disclosed.'), publish)).classification)
      .toMatchObject({ label: 'human_review_required', reasonCodes: ['PERSONAL_DATA'] });
    expect(publishCalls).toBe(0);
  });

  it('allows detail removal only when the ordered core facts remain identical', () => {
    const original = candidate('Graphic detail around the accepted events.');
    expect(() => assertSanitizedSummaryFidelity(original, { ...original, text: 'The accepted events occurred.' })).not.toThrow();
    expect(() => assertSanitizedSummaryFidelity(original, { ...original, text: 'A different event occurred.', coreFactIds: ['w#event#2'] }))
      .toThrow(/identical ordered core Fact IDs/);
  });

  it('fails closed on classifier failure and never publishes or changes Canon', async () => {
    let publishCalls = 0;
    const publish = (): Promise<void> => { publishCalls += 1; return Promise.resolve(); };
    const result = await gatePostGenerationPublication(candidate('content'), publish, () => { throw new Error('classifier unavailable'); });
    expect(result).toMatchObject({
      publishable: false,
      classification: { label: 'human_review_required', reasonCodes: ['CLASSIFIER_FAILURE'] },
    });
    expect(publishCalls).toBe(0);
    const source = readFileSync('convex/safety/postGeneration.ts', 'utf8');
    expect(source).not.toMatch(/canon\/|commitProposedEvent|reduceWorldEvent/);
  });

  it('persists labels idempotently and keeps block reasons queryable through internal APIs', () => {
    const source = readFileSync('convex/safety/postGenerationFunctions.ts', 'utf8');
    expect(source).toContain('deduplicated: true');
    expect(source).toContain('reasonCodes: [...row.reasonCodes]');
    expect(source).toContain('internalMutation({');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{|\bquery\(\{/);
  });
});
