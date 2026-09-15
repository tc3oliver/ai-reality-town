/**
 * What a viewer actually reads (ART-183).
 *
 * Every assertion here is on a FINAL public output — the onboarding summary's `summaryText`, the
 * live projection's payload, the label a chip renders — rather than on the helper that produced
 * it. That is deliberate and it is the lesson of the defect: each individual helper was doing
 * what its own tests said, and the home page still rendered
 * 「已知事實:currentArcPremise是…、name是Zhao Ming」 beside 「第 3 天 / night」, because nothing
 * asserted on the composed result a person sees.
 *
 * The four defect classes are covered separately so a regression names itself:
 *
 * 1. English placeholder templates on the production path.
 * 2. Raw schema keys rendered into Chinese prose.
 * 3. Entity ids rendered where a name belongs.
 * 4. Truncation that cuts inside a token.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TIME_SLOTS } from '../canon/eventTypes';
import type { AcceptedEvent } from '../canon/model';
import {
  IDENTITY_FACT_PREDICATES,
  LABELLED_TIME_SLOTS,
  factPredicateLabel,
  timeSlotLabel,
} from '../shared/publicLabels';
import { safeCutIndex, truncateForPublic } from '../shared/publicText';
import { entityNameMap, renderEntityNames } from './entityNames';
import { buildLiveProjection } from './liveState';
import { buildOnboardingSummary } from './onboardingSummary';

const ROOT = process.cwd();

// --- 1. English placeholder templates -----------------------------------------------------

/**
 * The exact strings the live site rendered, each with the file that produced it.
 *
 * Asserted against the SOURCE rather than against an output, because that is the only way to
 * catch the reintroduction: these are default/fallback branches, so a test that merely exercised
 * the happy path would keep passing while a placeholder returned to the fallback beside it.
 */
const BANNED_PLACEHOLDERS: ReadonlyArray<{ file: string; fragment: string }> = [
  { file: 'convex/editorial/episode.ts', fragment: 'Key scene ' },
  { file: 'convex/editorial/episode.ts', fragment: 'Quiet beat ' },
  { file: 'convex/editorial/episode.ts', fragment: 'World Day ' },
  { file: 'convex/editorial/episode.ts', fragment: 'A quiet day in Mistwood' },
  { file: 'convex/editorial/episode.ts', fragment: 'No accepted public development was recorded' },
  { file: 'convex/editorial/episode.ts', fragment: 'The town passed a quiet day' },
  { file: 'convex/editorial/episodeFunctions.ts', fragment: 'Relationship changed between' },
  { file: 'convex/operations/longRunHarness.ts', fragment: 'Relationship changed between' },
  { file: 'convex/operations/postCommitLive.ts', fragment: 'Arc from world day' },
  { file: 'convex/operations/postCommitLive.ts', fragment: 'How will ' },
  { file: 'convex/simulation/worldDayLive.ts', fragment: 'Press the matter of' },
  { file: 'convex/simulation/worldDayLive.ts', fragment: 'Stay with routine work' },
  { file: 'convex/simulation/worldDayLive.ts', fragment: ' raises "' },
  { file: 'convex/simulation/worldDayLive.ts', fragment: 'Waiting longer costs' },
  { file: 'convex/simulation/characterIntent.ts', fragment: "'Remain in place'" },
  /**
   * Found by a SECOND sweep, after the first pass of this task had already merged. The first
   * sweep keyed on lines that assigned a summary or a title and missed three that a viewer reads
   * just as directly — including the arc premise, which is the exact field that rendered as
   * 「currentArcPremise是…」 on the live home page. Listed here so the gap cannot reopen quietly.
   */
  { file: 'convex/operations/postCommitLive.ts', fragment: 'were drawn into an unresolved matter' },
  { file: 'convex/operations/postCommitLive.ts', fragment: 'carries the outcome of' },
  { file: 'convex/simulation/worldDayLive.ts', fragment: 'What does this town owe' },
];

describe('no English placeholder reaches a viewer-facing field', () => {
  it.each(BANNED_PLACEHOLDERS)('$file no longer emits "$fragment"', ({ file, fragment }) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    // Comments explaining the removal are allowed to quote it; emitted code is not. Stripping
    // block and line comments is what keeps this test from being un-documentable.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    expect(code).not.toContain(fragment);
  });

  it('does not put the pacingStage scheduler enum into dramatic pressure', () => {
    const source = readFileSync(join(ROOT, 'convex/simulation/worldDayLive.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    const pressure = /dramaticPressure: `([^`]*)`/u.exec(code);
    if (pressure === null) throw new Error('dramaticPressure is no longer a template literal — has it moved?');
    expect(pressure[1]).not.toContain('pacingStage');
  });
});

// --- 2. Raw schema keys -------------------------------------------------------------------

const onboardingInput = (facts: ReadonlyArray<{ predicate: string; value: string | number }>) => ({
  worldId: 'mistwood',
  majorEvent: { eventId: 'e1', publicSummary: '磨坊的帳目被重新翻開。' },
  importance: 0.9,
  characters: [{ characterId: 'zhao-ming', name: 'Zhao Ming' }],
  facts: facts.map((fact, index) => ({ factId: `f${index}`, ...fact })),
  question: '這筆錢究竟流向何處?',
  recommendedEpisode: { episodeNumber: 3, worldDay: 2 },
  scene: { title: '關鍵場景 1', summary: '兩人在磨坊對帳。' },
});

describe('the onboarding summary renders no raw schema key', () => {
  it('labels a registered predicate in Chinese instead of printing the key', () => {
    const { summaryText } = buildOnboardingSummary(onboardingInput([{ predicate: 'weather', value: '大雨' }]));
    expect(summaryText).toContain('天氣:大雨');
    expect(summaryText).not.toContain('weather');
  });

  it('renders the VALUE alone for a predicate the registry has never heard of', () => {
    /**
     * The exact defect: `currentArcPremise` is LLM-authored, so no registry can contain it, and
     * the previous code fell through to `${predicate}是${value}`. The value is public prose and
     * stands on its own; the key never should have been shown at all.
     */
    const premise = '一把無名置物櫃鑰匙,可能揭開車站關閉的真正原因。';
    const { summaryText } = buildOnboardingSummary(
      onboardingInput([{ predicate: 'currentArcPremise', value: premise }]),
    );
    expect(summaryText).toContain(premise);
    expect(summaryText).not.toContain('currentArcPremise');
    expect(summaryText).not.toContain('是');
  });

  it('never lets a camelCase key survive into the composed text, whatever the model invents', () => {
    const { summaryText } = buildOnboardingSummary(
      onboardingInput([
        { predicate: 'someBrandNewPredicate', value: '一段公開敘述。' },
        { predicate: 'another_invented_key', value: '另一段公開敘述。' },
      ]),
    );
    expect(summaryText).not.toMatch(/[a-z]+[A-Z][a-zA-Z]*/u);
    expect(summaryText).not.toContain('another_invented_key');
  });

  it('treats name and age as identity, so the summary never reports them as news', () => {
    expect([...IDENTITY_FACT_PREDICATES].sort()).toEqual(['age', 'name']);
    // Both have labels, because the character projection still needs to render them with one.
    expect(factPredicateLabel('name')).toBe('姓名');
    expect(factPredicateLabel('age')).toBe('年齡');
  });
});

// --- 3. Entity ids where a name belongs ---------------------------------------------------

const event = (over: Partial<AcceptedEvent> = {}): AcceptedEvent => ({
  schemaVersion: 1,
  eventId: 'mistwood#event#1',
  worldId: 'mistwood',
  sequenceNumber: 1,
  worldDay: 3,
  timeSlot: 'night',
  type: 'scene_played',
  participantIds: ['he-jun', 'zhao-ming'],
  locationId: 'mistwood-mill',
  publicSummary: 'he-jun 與 zhao-ming 在 mistwood-mill 對帳。',
  stateChanges: [],
  causedByEventIds: [],
  idempotencyKey: 'k1',
  acceptedAt: 1,
  validationVersion: 'canon-v1',
  ...over,
} as unknown as AcceptedEvent);

const NAMES = entityNameMap([
  { id: 'he-jun', name: 'He Jun' },
  { id: 'zhao-ming', name: 'Zhao Ming' },
  { id: 'mistwood-mill', name: '霧林磨坊' },
]);

describe('the live projection renders names, not ids', () => {
  it('substitutes every known id in the published event summary', () => {
    const payload = buildLiveProjection({
      worldId: 'mistwood',
      acceptedEvents: [event()],
      arcs: [],
      publishedEpisode: null,
      displayNames: NAMES,
    });
    expect(payload.recentEvents[0].summary).toBe('He Jun 與 Zhao Ming 在 霧林磨坊 對帳。');
    expect(payload.recentEvents[0].summary).not.toContain('he-jun');
    expect(payload.recentEvents[0].summary).not.toContain('mistwood-mill');
  });

  it('substitutes inside an arc title and its open question', () => {
    const payload = buildLiveProjection({
      worldId: 'mistwood',
      acceptedEvents: [event()],
      arcs: [{
        arcId: 'arc:mistwood:50', status: 'resolving',
        title: '第 2 天中午開始的故事線',
        currentQuestion: 'he-jun 要如何收拾 mistwood-mill 發生的事?',
      }],
      publishedEpisode: null,
      displayNames: NAMES,
    });
    expect(payload.activeArcs[0].currentQuestion).toBe('He Jun 要如何收拾 霧林磨坊 發生的事?');
  });

  it('carries a display name on every character, falling back to the id only when unnamed', () => {
    // A character enters `knownCharacters` through a state change, not through `participantIds`.
    const moved = event({
      stateChanges: [
        { type: 'character_location_changed', characterId: 'he-jun', toLocationId: 'mistwood-mill' },
        { type: 'character_location_changed', characterId: 'nobody', toLocationId: 'mistwood-mill' },
      ],
    } as unknown as Partial<AcceptedEvent>);
    const payload = buildLiveProjection({
      worldId: 'mistwood',
      acceptedEvents: [moved],
      arcs: [],
      publishedEpisode: null,
      displayNames: NAMES,
    });
    const byId = new Map(payload.characters.map((character) => [character.characterId, character.displayName]));
    expect(byId.get('he-jun')).toBe('He Jun');
    expect(byId.get('nobody')).toBe('nobody');
  });

  it('does not substitute a partial match inside a longer id', () => {
    // `he-jun` must not fire inside `he-junior`, or a longer id becomes a mangled name.
    expect(renderEntityNames('he-junior 在場。', NAMES)).toBe('he-junior 在場。');
    expect(renderEntityNames('he-jun 在場。', NAMES)).toBe('He Jun 在場。');
  });

  it('prefers the longest id when two ids share a prefix', () => {
    const names = entityNameMap([
      { id: 'mistwood-mill', name: '磨坊' },
      { id: 'mistwood-mill-annex', name: '磨坊側廳' },
    ]);
    expect(renderEntityNames('在 mistwood-mill-annex 碰面', names)).toBe('在 磨坊側廳 碰面');
  });

  it('drops a name that equals its own id, so an unfilled record cannot look substituted', () => {
    expect(entityNameMap([{ id: 'he-jun', name: 'he-jun' }]).size).toBe(0);
  });
});

// --- 4. Truncation ------------------------------------------------------------------------

describe('public truncation does not cut inside a word', () => {
  it('backs off to the start of a Latin token rather than splitting it', () => {
    /**
     * Asserted as an EXACT string. The first version of this test checked
     * `not.toMatch(/mistwoo…$/)`, which a blind cut also satisfies — it lands on `mist`, not on
     * `mistwoo` — so reverting `safeCutIndex` to the old behaviour left the whole file green.
     * An assertion that cannot fail is the defect class CLAUDE.md §9 names; the budget here cuts
     * four characters into `mistwood`, and only the exact result distinguishes the two rules.
     */
    const text = 'Digitize the surviving archives at mistwood-hall';
    expect(truncateForPublic(text, 38)).toBe('Digitize the surviving archives at…');
  });

  it('still cuts at the budget when the next character is a boundary', () => {
    expect(truncateForPublic('abc def ghijkl', 8)).toBe('abc def…');
  });

  it('cuts CJK where the budget ran out, because CJK has no word boundary to find', () => {
    expect(truncateForPublic('磨坊的帳目被重新翻開了', 6)).toBe('磨坊的帳目…');
  });

  it('refuses to back off across a run longer than a word, which would discard the content', () => {
    /**
     * `shareFormats` composes a 60-character card from a 300-character unbroken run. An
     * unbounded back-off returned seven characters of it — technically not mid-token, and
     * useless. The bound is what makes the rule a presentation fix rather than a data loss.
     */
    const text = `abc ${'L'.repeat(300)}`;
    expect(safeCutIndex(text, 59)).toBe(59);
    expect(truncateForPublic(text, 60)).toHaveLength(60);
  });

  it('always marks that content was omitted', () => {
    expect(truncateForPublic('a'.repeat(100), 20).endsWith('…')).toBe(true);
  });
});

// --- 5. The time-slot vocabulary ----------------------------------------------------------

describe('every time slot Canon can produce has a Chinese label', () => {
  it('covers the canon vocabulary exactly, in both directions', () => {
    /**
     * `shared` may depend on nothing, so `LABELLED_TIME_SLOTS` is a hand-copy of canon's
     * `TIME_SLOTS`. This is the check that makes the copy safe: adding a slot to canon without a
     * label fails HERE, by name, instead of printing an English identifier to a viewer.
     */
    expect([...LABELLED_TIME_SLOTS].sort()).toEqual([...TIME_SLOTS].sort());
  });

  it('renders each slot in Chinese, with no Latin left', () => {
    for (const slot of TIME_SLOTS) {
      expect(timeSlotLabel(slot)).not.toMatch(/[A-Za-z]/u);
    }
  });

  it('returns an unknown slot unchanged rather than blank', () => {
    // The concern the old `timeStateLabel` docblock raised: a sixth slot must not render empty.
    expect(timeSlotLabel('dawn')).toBe('dawn');
  });
});
