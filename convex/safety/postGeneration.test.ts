import { readFileSync } from 'node:fs';
import {
  assertSanitizedSummaryFidelity,
  classifyPostGeneration,
  gatePostGenerationPublication,
  isPubliclyShowable,
  POST_GENERATION_LABELS,
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

/**
 * The gate predicate itself (ART-177).
 *
 * `isPubliclyShowable` is the one definition of the publish/withhold line, and until ART-177 it had
 * a single production caller while three sites wrote its body out by hand — one of them the
 * decision that publishes an Episode. Consolidating them made this the place a change to the line
 * takes effect, and nothing here pinned it: narrowing it to `label === 'allow'` left every suite in
 * the repository green, which an injection found.
 *
 * All four labels, named, so moving one across the line is a deliberate edit to a red test.
 */
describe('isPubliclyShowable is the one definition of the publish line', () => {
  it('shows allow and allow_with_warning', () => {
    expect(isPubliclyShowable('allow')).toBe(true);
    // The one an injection silently removed. A warning is an annotation on showable content, not
    // a refusal — `allow_with_warning` publishes with its warning codes attached.
    expect(isPubliclyShowable('allow_with_warning')).toBe(true);
  });

  it('withholds withhold and human_review_required', () => {
    expect(isPubliclyShowable('withhold')).toBe(false);
    // Pending human review is NOT provisionally showable. Treating "nobody has looked yet" as
    // permission is the whole failure mode a post-generation gate exists to prevent.
    expect(isPubliclyShowable('human_review_required')).toBe(false);
  });

  it('classifies every label in the vocabulary, so a new one cannot default to showable', () => {
    // Exhaustive over POST_GENERATION_LABELS rather than over a list written here: a fifth label
    // added to the vocabulary and forgotten here fails this test instead of landing on whichever
    // side the predicate's shape happens to give it.
    const showable = POST_GENERATION_LABELS.filter((label) => isPubliclyShowable(label));
    const withheld = POST_GENERATION_LABELS.filter((label) => !isPubliclyShowable(label));
    expect(showable).toEqual(['allow', 'allow_with_warning']);
    expect(withheld).toEqual(['withhold', 'human_review_required']);
    expect(showable.length + withheld.length).toBe(POST_GENERATION_LABELS.length);
  });
});
