/**
 * FR-G005 / ART-36 — episode-derived share formats.
 *
 * Every assertion here was fault-injected: the guarantee it names was broken in the source, this
 * file was watched to fail on that named test, and the source restored.
 *
 * The provenance suite is deliberately built so it CAN fail. `validateEpisodeShareFormats` is
 * never handed the ids it is supposed to be checking against — the "accepted" set is written out
 * in the test, separately from the Episode the copy was derived from, so a validator that simply
 * echoed the builder's output back would be caught rather than confirmed.
 */

import { buildDailyEpisode, validateDailyEpisode, type EpisodeSourceEvent } from '../episode';
import { InMemoryCanonStore } from '../../canon/inMemoryStore';
import type { AcceptedEvent } from '../../canon/model';
import {
  decideShareRelease,
  deriveEpisodeShareFormats,
  deriveGatedShareFormats,
  episodeShareContentRef,
  shareFormatsContentRef,
  shareFormatsPublicText,
  shareFormatsSafetySourceId,
  validateEpisodeShareFormats,
  ShareFormatError,
  SHARE_FORMAT_KINDS,
  SHARE_FORMAT_LABELS,
  SHARE_FORMAT_MAX_LENGTHS,
  type EpisodeShareFormats,
  type ShareSourceEpisode,
} from './shareFormats';

const WORLD_ID = 'mistwood';
const WORLD_DAY = 4;
const EPISODE_NUMBER = 4;

const source = (eventId: string, over: Partial<EpisodeSourceEvent> = {}): EpisodeSourceEvent => ({
  eventId, publicSummary: `Public ${eventId}`, participantIds: [`character-${eventId}`],
  arcIds: ['arc-1'], importance: 0.5, publicFactIds: [], publicRelationshipChanges: [],
  newQuestions: [`Question ${eventId}?`], resolvedQuestions: [], ...over,
});

/** A real `DailyEpisode`, which satisfies {@link ShareSourceEpisode} structurally. */
function fixtureEpisode(sources: readonly EpisodeSourceEvent[]): ShareSourceEpisode {
  return validateDailyEpisode(
    buildDailyEpisode(WORLD_ID, WORLD_DAY, EPISODE_NUMBER, sources), sources, [],
  );
}

const SOURCES = [source('e1'), source('e2'), source('e3')];
/** Written out here, NOT read off the Episode. See the file header. */
const ACCEPTED = ['e1', 'e2', 'e3'];

const derived = (episode: ShareSourceEpisode = fixtureEpisode(SOURCES)): EpisodeShareFormats =>
  deriveEpisodeShareFormats(episode);
const byKind = (formats: EpisodeShareFormats, kind: string) =>
  formats.formats.find((format) => format.kind === kind)!;

describe('FR-G005 AC#2 — derived content marks its source Episode', () => {
  it('emits all four FR-G005 formats, each labelled and traced to the source Episode', () => {
    const formats = validateEpisodeShareFormats(derived(), ACCEPTED,
      { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER });

    expect(formats.formats.map(({ kind }) => kind)).toEqual([...SHARE_FORMAT_KINDS]);
    expect(formats.formats.map(({ label }) => label))
      .toEqual(['地方新聞', '社群短文', '分享卡文案', '明日預告']);
    expect(formats.sourceEpisode).toEqual({
      worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER,
      contentRef: episodeShareContentRef(WORLD_ID, WORLD_DAY),
      sourceEventIds: ACCEPTED,
    });
    // Every format carries copy, within its cap, and cites only accepted events.
    for (const format of formats.formats) {
      expect(format.text.trim().length).toBeGreaterThan(0);
      expect(format.text.length).toBeLessThanOrEqual(SHARE_FORMAT_MAX_LENGTHS[format.kind]);
      expect(format.sourceEventIds.every((id) => ACCEPTED.includes(id))).toBe(true);
    }
    expect(byKind(formats, 'local_news').text).toContain('【地方新聞】第 4 集：Public e1');
    expect(byKind(formats, 'next_day_teaser').text).toContain('【明日預告】');
    expect(byKind(formats, 'share_card').text).toBe('第 4 集・Public e1');
  });

  it('is deterministic — the same Episode yields byte-identical copy', () => {
    const episode = fixtureEpisode(SOURCES);
    expect(deriveEpisodeShareFormats(episode)).toEqual(deriveEpisodeShareFormats(episode));
  });

  it('uses a content reference distinct from the Episode it derives from', () => {
    // Sharing one reference would make the two publication records collide, so the Episode's
    // status and its share copy's status could not differ -- which is the whole point of AC#3.
    expect(shareFormatsContentRef(WORLD_ID, WORLD_DAY)).not.toBe(episodeShareContentRef(WORLD_ID, WORLD_DAY));
    expect(shareFormatsSafetySourceId(WORLD_ID, WORLD_DAY)).toBe('episode_share:mistwood:4');
  });

  it('rejects copy citing an event the accepted log does not contain', () => {
    const formats = derived();
    // Non-tautology proof: the SAME object passes against the full accepted set and fails against
    // one missing `e3`. A validator echoing its own input could not tell these two calls apart.
    expect(() => validateEpisodeShareFormats(formats, ACCEPTED,
      { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER })).not.toThrow();
    expect(() => validateEpisodeShareFormats(formats, ['e1', 'e2'],
      { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER }))
      .toThrow(/cites an event outside the accepted set: e3/);
  });

  it('rejects copy that names a different source Episode', () => {
    const formats = derived();
    expect(() => validateEpisodeShareFormats(formats, ACCEPTED,
      { worldId: WORLD_ID, worldDay: 5, episodeNumber: EPISODE_NUMBER }))
      .toThrow(/names a different source Episode/);
    expect(() => validateEpisodeShareFormats(formats, ACCEPTED,
      { worldId: 'elsewhere', worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER }))
      .toThrow(/names a different source Episode/);
    // The identity matches but the reference does not: a share format pointing at another day's
    // Episode record would send a reviewer to the wrong publication.
    expect(() => validateEpisodeShareFormats(
      { ...formats, sourceEpisode: { ...formats.sourceEpisode, contentRef: 'episode:mistwood:9' } },
      ACCEPTED, { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER },
    )).toThrow(/content reference does not match/);
  });

  it('rejects a missing, reordered, mislabelled, empty or oversized format', () => {
    const formats = derived();
    const at = (index: number) => formats.formats[index];
    const withFormats = (list: unknown[]) => ({ ...formats, formats: list });
    const expected = { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER };

    expect(() => validateEpisodeShareFormats(withFormats(formats.formats.slice(0, 3)), ACCEPTED, expected))
      .toThrow(/all 4 FR-G005 formats are required/);
    expect(() => validateEpisodeShareFormats(withFormats([at(1), at(0), at(2), at(3)]), ACCEPTED, expected))
      .toThrow(/expected format 'local_news' at position 0/);
    expect(() => validateEpisodeShareFormats(
      withFormats([{ ...at(0), label: SHARE_FORMAT_LABELS.social_post }, at(1), at(2), at(3)]), ACCEPTED, expected,
    )).toThrow(/label does not match/);
    expect(() => validateEpisodeShareFormats(
      withFormats([{ ...at(0), text: '   ' }, at(1), at(2), at(3)]), ACCEPTED, expected,
    )).toThrow(/local_news must carry copy/);
    expect(() => validateEpisodeShareFormats(
      withFormats([at(0), at(1), { ...at(2), text: 'x'.repeat(SHARE_FORMAT_MAX_LENGTHS.share_card + 1) }, at(3)]),
      ACCEPTED, expected,
    )).toThrow(/share_card exceeds its 60-character cap/);
  });

  it('rejects an unknown field, wrong schema version, or non-object envelope', () => {
    const expected = { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER };
    expect(() => validateEpisodeShareFormats(null, ACCEPTED, expected)).toThrow(/must be an object/);
    expect(() => validateEpisodeShareFormats({ ...derived(), schemaVersion: 2 }, ACCEPTED, expected))
      .toThrow(/unsupported schema version/);
    expect(() => validateEpisodeShareFormats({ ...derived(), extra: 1 }, ACCEPTED, expected))
      .toThrow(/unknown field extra/);
    expect(() => validateEpisodeShareFormats({ ...derived(), omissions: 'none' }, ACCEPTED, expected))
      .toThrow(/must be an array/);
  });

  it('throws ShareFormatError with a machine-readable code, not a bare Error', () => {
    try {
      validateEpisodeShareFormats(derived(), [], { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ShareFormatError);
      expect((error as ShareFormatError).code).toBe('SHARE_SOURCE_NOT_ACCEPTED');
    }
  });

  it('derives copy for a quiet day without inventing a source', () => {
    const quiet = fixtureEpisode([]);
    const formats = validateEpisodeShareFormats(deriveEpisodeShareFormats(quiet), [],
      { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER });
    expect(formats.sourceEpisode.sourceEventIds).toEqual([]);
    expect(formats.formats.every(({ sourceEventIds }) => sourceEventIds.length === 0)).toBe(true);
    expect(formats.formats).toHaveLength(4);
  });
});

describe('FR-G005 — nothing is dropped silently', () => {
  const longSummary = 'L'.repeat(300);

  it('reports which developments a length cap kept out of 地方新聞', () => {
    const sources = [
      source('e1', { publicSummary: longSummary }),
      source('e2', { publicSummary: longSummary }),
      source('e3', { publicSummary: longSummary }),
    ];
    const formats = validateEpisodeShareFormats(derived(fixtureEpisode(sources)), ACCEPTED,
      { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER });

    const omission = formats.omissions.find((entry) => entry.kind === 'local_news');
    expect(omission).toBeDefined();
    expect(omission!.reason).toBe('scene_not_covered');
    expect(omission!.droppedCharacters).toBeGreaterThan(0);
    // The report NAMES the events, so a reviewer can see which developments are absent.
    expect([...omission!.omittedSourceEventIds].sort()).toEqual(['e1', 'e2', 'e3']);
    expect(byKind(formats, 'local_news').sourceEventIds).toEqual([]);
  });

  it('reports characters cut from a single oversized line', () => {
    const formats = derived(fixtureEpisode([source('e1', { publicSummary: longSummary })]));
    const card = byKind(formats, 'share_card');
    const omission = formats.omissions.find((entry) => entry.kind === 'share_card');
    expect(card.text.length).toBe(SHARE_FORMAT_MAX_LENGTHS.share_card);
    expect(omission).toBeDefined();
    expect(omission!.kind).toBe('share_card');
    expect(omission!.reason).toBe('length_cap');
    expect(omission!.omittedSourceEventIds).toEqual([]);
    expect(omission!.droppedCharacters).toBeGreaterThan(200);
  });

  it('rejects copy that dropped an accepted development without reporting it', () => {
    const sources = [source('e1', { publicSummary: longSummary }), source('e2'), source('e3')];
    const formats = derived(fixtureEpisode(sources));
    expect(formats.omissions.some((entry) => entry.kind === 'local_news')).toBe(true);
    // Strip the report and keep the shortened copy: this is the failure the rule exists for.
    expect(() => validateEpisodeShareFormats(
      { ...formats, omissions: formats.omissions.filter((entry) => entry.kind !== 'local_news') },
      ACCEPTED, { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER },
    )).toThrow(/dropped \d+ accepted development\(s\) without reporting them/);
  });

  it('rejects a malformed omission report', () => {
    const formats = derived();
    const expected = { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER };
    const withOmission = (omission: unknown) => ({ ...formats, omissions: [omission] });
    expect(() => validateEpisodeShareFormats(withOmission({ kind: 'nope', reason: 'length_cap', droppedCharacters: 1, omittedSourceEventIds: [] }), ACCEPTED, expected))
      .toThrow(/unknown share format kind/);
    expect(() => validateEpisodeShareFormats(withOmission({ kind: 'local_news', reason: 'because', droppedCharacters: 1, omittedSourceEventIds: [] }), ACCEPTED, expected))
      .toThrow(/unknown omission reason/);
    expect(() => validateEpisodeShareFormats(withOmission({ kind: 'local_news', reason: 'length_cap', droppedCharacters: -1, omittedSourceEventIds: [] }), ACCEPTED, expected))
      .toThrow(/non-negative integer/);
    // An omission may not launder an unaccepted id into the record either.
    expect(() => validateEpisodeShareFormats(withOmission({ kind: 'local_news', reason: 'scene_not_covered', droppedCharacters: 1, omittedSourceEventIds: ['ghost'] }), ACCEPTED, expected))
      .toThrow(/cites an event outside the accepted set: ghost/);
  });
});

describe('FR-G005 AC#3 — inappropriate content is never published automatically', () => {
  const formats = validateEpisodeShareFormats(derived(), ACCEPTED,
    { worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER });

  it('offers manual release as the BEST outcome — there is no automatic one', () => {
    const decision = decideShareRelease({
      formats, sourceEpisodeStatus: 'ready', effectiveSafetyLabel: 'allow',
    });
    expect(decision.outcome).toBe('manual_release_required');
    expect(decision.formats).toEqual(formats);
    // The union is closed. `blocked | manual_release_required` are the only two outcomes this
    // gate can produce; adding a third would be an edit to `ShareReleaseDecision`, which is what
    // makes "no automatic external publication" a property of the type rather than of a habit.
    expect(['blocked', 'manual_release_required']).toContain(decision.outcome);
  });

  it('withholds the copy AND its text when the safety gate refuses', () => {
    for (const label of ['withhold', 'human_review_required'] as const) {
      const decision = decideShareRelease({ formats, sourceEpisodeStatus: 'ready', effectiveSafetyLabel: label });
      expect(decision.outcome).toBe('blocked');
      expect(decision.reasonCodes).toEqual(['SHARE_SAFETY_WITHHELD']);
      // Refused copy is not handed back: a caller cannot reach the text by ignoring the outcome.
      expect(decision.formats).toBeNull();
    }
  });

  it('allows the two publishable labels, so the gate is the existing one and not a stricter twin', () => {
    for (const label of ['allow', 'allow_with_warning'] as const) {
      expect(decideShareRelease({ formats, sourceEpisodeStatus: 'ready', effectiveSafetyLabel: label }).outcome)
        .toBe('manual_release_required');
    }
  });

  it('refuses to reframe an Episode the pipeline already withheld', () => {
    for (const status of ['withheld', 'failed', 'generated']) {
      const decision = decideShareRelease({ formats, sourceEpisodeStatus: status, effectiveSafetyLabel: 'allow' });
      expect(decision.outcome).toBe('blocked');
      expect(decision.reasonCodes).toContain('SHARE_SOURCE_EPISODE_NOT_READY');
      expect(decision.formats).toBeNull();
    }
  });

  it('reports both reasons when both refuse', () => {
    const decision = decideShareRelease({ formats, sourceEpisodeStatus: 'withheld', effectiveSafetyLabel: 'withhold' });
    expect(decision.reasonCodes).toEqual(['SHARE_SOURCE_EPISODE_NOT_READY', 'SHARE_SAFETY_WITHHELD']);
  });

  it('classifies the DERIVED text, so unsafe copy is caught in the share format itself', () => {
    // The Episode's own gate saw the Episode's text. This proves the derived copy is classified
    // on its own terms: the unsafe phrase reaches the share format through a scene summary and
    // the gate that refuses it is the ART-52 classifier, not a second opinion written here.
    const unsafe = fixtureEpisode([source('e1', { publicSummary: 'A guide with graphic dismemberment.' })]);
    const { decision, classification } = deriveGatedShareFormats({
      episode: unsafe, acceptedSourceEventIds: ['e1'], sourceEpisodeStatus: 'ready',
    });
    expect(classification.label).toBe('withhold');
    expect(classification.reasonCodes).toContain('EXTREME_VIOLENCE_DETAIL');
    expect(classification.kind).toBe('public_artifact');
    expect(classification.sourceId).toBe(shareFormatsSafetySourceId(WORLD_ID, WORLD_DAY));
    expect(decision.outcome).toBe('blocked');
    expect(decision.formats).toBeNull();
  });

  it('honours a later operator override in both directions (FR-P004 reuse)', () => {
    const clean = fixtureEpisode(SOURCES);
    const gate = (overrides: { label: 'allow' | 'withhold'; createdAt: number }[]) =>
      deriveGatedShareFormats({
        episode: clean, acceptedSourceEventIds: ACCEPTED, sourceEpisodeStatus: 'ready',
        safetyOverrides: overrides,
      }).decision.outcome;
    expect(gate([])).toBe('manual_release_required');
    expect(gate([{ label: 'withhold', createdAt: 10 }])).toBe('blocked');
    // Latest wins, so a withhold that was later revoked stops blocking.
    expect(gate([{ label: 'withhold', createdAt: 10 }, { label: 'allow', createdAt: 20 }]))
      .toBe('manual_release_required');
  });

  it('classifies every character of every format, not just the first', () => {
    const text = shareFormatsPublicText(formats);
    for (const format of formats.formats) expect(text).toContain(format.text);
  });
});

describe('FR-G005 AC#1 — derived content produces no new Canon', () => {
  /**
   * A behavioural companion to the build-time guarantee.
   *
   * The architecture checker already fails the build if `convex/editorial/derived` names a write
   * surface at all (`canonWriteBoundary.forbiddenModules`), and the dependency graph forbids this
   * module from importing `canon`. This runs the full derive-validate-classify-gate cycle against
   * a real accepted-event store anyway and compares the log byte for byte, because the two
   * guarantees fail differently: the boundary catches a NAME, and this catches an EFFECT.
   */
  it('leaves the accepted-event log byte-identical across a full derive-and-gate cycle', async () => {
    const store = new InMemoryCanonStore();
    const accepted: AcceptedEvent[] = SOURCES.map((entry, index) => ({
      schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: `key-${entry.eventId}`,
      proposedBy: { type: 'character', id: 'a' }, worldDay: WORLD_DAY, timeSlot: 'morning',
      eventType: 'social_encounter' as AcceptedEvent['eventType'], locationId: 'loc-1',
      participantIds: ['a'], causedByEventIds: [], publicSummary: entry.publicSummary,
      stateChanges: [], eventId: entry.eventId, acceptedAt: 1_000 + index,
      sequenceNumber: index + 1, validationVersion: '1', traceId: 't1',
    } as AcceptedEvent));
    for (const event of accepted) await store.appendCommit(event);

    const before = JSON.stringify(store.committedEvents());
    const { decision } = deriveGatedShareFormats({
      episode: fixtureEpisode(SOURCES),
      // Read from the store, which is the point: the accepted set is an INPUT to the check.
      acceptedSourceEventIds: (await store.loadAcceptedEvents(WORLD_ID)).map(({ eventId }) => eventId),
      sourceEpisodeStatus: 'ready',
    });
    expect(decision.outcome).toBe('manual_release_required');
    expect(JSON.stringify(store.committedEvents())).toBe(before);
    expect(store.committedEvents()).toHaveLength(SOURCES.length);
  });

  it('cannot be handed a mutable Episode — the source is read-only all the way down', () => {
    // Compile-time, not runtime: `ShareSourceEpisode` declares every field and every array
    // `readonly`, so a derivation that tried to edit the Episode it reads would not build.
    // Asserted here as documentation of the intent; `tsc` is what enforces it.
    const scenes: ShareSourceEpisode['keyScenes'] = fixtureEpisode(SOURCES).keyScenes;
    expect(scenes.length).toBeGreaterThan(0);
    // @ts-expect-error a readonly scene list is not assignable to a mutable one. `tsc` rejecting
    // this line IS the guarantee; the assertion below only keeps the binding used.
    const mutable: { title: string; summary: string; sourceEventIds: string[] }[] = scenes;
    expect(mutable.length).toBe(scenes.length);
  });
});
