/**
 * Episode-derived share formats (FR-G005 / ART-36).
 *
 * Four pieces of copy derived from one accepted Daily Episode: 地方新聞, 社群短文, 分享卡文案,
 * and 明日預告. Nothing here generates anything — every character of substance is quoted from an
 * Episode that was already assembled from Accepted Events, already checked for secret leakage by
 * `validateDailyEpisode`, and already classified by the ART-52 post-generation gate. This module
 * only reframes it.
 *
 * ## Why this is its own module rather than a file in `editorial`
 *
 * FR-G005 AC#1 says 衍生內容不得產生新 Canon. That is a negative, and a negative is not settled by
 * a test that shows the calls it happened to make wrote nothing. So it is settled by the build:
 * `architecture/module-boundaries.json` declares `derivedContent` (root `convex/editorial/derived`)
 * and lists it in `canonWriteBoundary.forbiddenModules`, which means `npm run check:architecture`
 * FAILS if any file here so much as NAMES a Convex write registration, a database write call, the
 * accepted-event table, or a commit entry point — the policy holds that list, and this comment
 * deliberately spells none of them, because naming one here would itself trip the check.
 *
 * The dependency graph is the second half: `derivedContent` may
 * depend on `safety` and `shared` and NOTHING else — not `canon`, and deliberately not `editorial`
 * either, so the derived copy cannot reach the Episode WRITER whose output it reads.
 *
 * That last exclusion is why {@link ShareSourceEpisode} is declared here structurally instead of
 * importing `DailyEpisode`. A `DailyEpisode` satisfies it by shape, so the wiring passes one
 * straight through with no adapter, and this module still cannot name a single symbol from the
 * module that persists episodes. Its fields are `readonly` throughout for the same reason: the
 * source an outreach format reads is not a thing it may edit, and the compiler says so.
 *
 * Pure — no Convex imports, no clock, no randomness, no I/O.
 */

import {
  classifyPostGeneration,
  isPubliclyShowable,
  resolveEffectiveSafetyLabel,
  type PostGenerationClassification,
  type PostGenerationLabel,
  type SafetyStatusOverrideLike,
} from '../../safety/postGeneration';
import { truncateForPublic } from '../../shared/publicText';

/** The four formats FR-G005 names, in the order they are always emitted. */
export const SHARE_FORMAT_KINDS = ['local_news', 'social_post', 'share_card', 'next_day_teaser'] as const;
export type ShareFormatKind = (typeof SHARE_FORMAT_KINDS)[number];

/**
 * Display labels, zh-Hant, inline literals — the repo runs no i18n framework.
 *
 * These are the ONLY words this module contributes. Everything else is the Episode's own text,
 * passed through verbatim: an Episode summary is Canon-derived public copy, and re-writing or
 * translating it here would make the share format say something the Episode does not.
 */
export const SHARE_FORMAT_LABELS: Readonly<Record<ShareFormatKind, string>> = {
  local_news: '地方新聞',
  social_post: '社群短文',
  share_card: '分享卡文案',
  next_day_teaser: '明日預告',
};

/**
 * Length caps, in characters rather than 中文字.
 *
 * FR-G003's recap bands are stated in 中文字 and `countChineseCharacters` is the right unit there,
 * because those bands govern text the pipeline writes. These caps govern text the pipeline
 * QUOTES, and an Episode's `publicSummary` is whatever the provider produced — a band counted in
 * CJK code points would let a 900-character Latin summary through a "150 中文字" cap untouched and
 * then overflow the card it was sized for. The cap that has to hold is the rendered one.
 */
export const SHARE_FORMAT_MAX_LENGTHS: Readonly<Record<ShareFormatKind, number>> = {
  local_news: 220,
  social_post: 140,
  share_card: 60,
  next_day_teaser: 80,
};

export class ShareFormatError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'ShareFormatError';
  }
}

/**
 * The fields of an accepted Daily Episode a share format may read.
 *
 * Structurally compatible with `editorial/episode.ts`'s `DailyEpisode`, and NOT an import of it —
 * see the module header. `publicFactIds` and `relationshipChanges` are deliberately absent: no
 * share format quotes a fact id or a relationship delta, so this module is never handed them.
 */
export type ShareSourceEpisode = {
  readonly worldId: string;
  readonly worldDay: number;
  readonly episodeNumber: number;
  readonly title: string;
  readonly headline: string;
  readonly oneLineSummary: string;
  readonly keyScenes: readonly {
    readonly title: string;
    readonly summary: string;
    readonly sourceEventIds: readonly string[];
  }[];
  readonly newQuestions: readonly string[];
  readonly nextEpisodeTease: string;
  readonly sourceEventIds: readonly string[];
};

/**
 * The source Episode a piece of derived copy came from (FR-G005 AC#2).
 *
 * `contentRef` is the SAME string the FR-K004 publication lifecycle uses for the Episode
 * (`episode:<worldId>:<worldDay>`), so an operator holding a share format can look up the
 * Episode's publication record without a second identifier scheme. `sourceEventIds` follows
 * the repo's provenance idiom (`RecapFormats.sourceEventIds`, `DailyEpisode.sourceEventIds`):
 * the accepted events the Episode itself cited.
 */
export type ShareSourceEpisodeRef = {
  readonly worldId: string;
  readonly worldDay: number;
  readonly episodeNumber: number;
  readonly contentRef: string;
  readonly sourceEventIds: readonly string[];
};

export type ShareFormat = {
  readonly kind: ShareFormatKind;
  readonly label: string;
  readonly text: string;
  /** The accepted events whose text reached THIS format. Always a subset of the Episode's. */
  readonly sourceEventIds: readonly string[];
};

/**
 * What a format left out, and why.
 *
 * Present because a share format that silently dropped a key scene would read as a complete
 * account of the day while being a partial one, and nothing downstream could tell the
 * difference. `droppedCharacters` counts what the cap removed; `omittedSourceEventIds` names
 * the accepted events whose text is therefore absent, so a reviewer can see WHICH developments
 * were cut rather than only that something was.
 */
export type ShareOmission = {
  readonly kind: ShareFormatKind;
  readonly reason: 'length_cap' | 'scene_not_covered';
  readonly droppedCharacters: number;
  readonly omittedSourceEventIds: readonly string[];
};

export type EpisodeShareFormats = {
  readonly schemaVersion: 1;
  readonly sourceEpisode: ShareSourceEpisodeRef;
  readonly formats: readonly ShareFormat[];
  readonly omissions: readonly ShareOmission[];
};

/** The publication-lifecycle content reference for an Episode. */
export const episodeShareContentRef = (worldId: string, worldDay: number): string =>
  `episode:${worldId}:${worldDay}`;

/** The content reference for the share formats DERIVED from that Episode. */
export const shareFormatsContentRef = (worldId: string, worldDay: number): string =>
  `episode_share:${worldId}:${worldDay}`;

const unique = (values: readonly string[]): string[] => [...new Set(values)];
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();

/**
 * Compose one format's text and report what the cap removed.
 *
 * `segments` are appended in order until the next one would not fit; the tail that did not fit
 * is what the omission reports. A final {@link truncateForPublic} is still applied, because a
 * single segment longer than the whole cap has to be cut mid-way rather than dropped entirely —
 * dropping it would leave a format with a label and no content.
 */
function compose(
  kind: ShareFormatKind,
  segments: readonly { readonly text: string; readonly sourceEventIds: readonly string[] }[],
  separator: string,
): { text: string; sourceEventIds: string[]; omission: ShareOmission | null } {
  const maxLength = SHARE_FORMAT_MAX_LENGTHS[kind];
  const usable = segments.filter((segment) => segment.text.length > 0);
  const included: typeof usable = [];
  const omitted: typeof usable = [];
  let assembled = '';
  for (const segment of usable) {
    const candidate = assembled.length === 0 ? segment.text : `${assembled}${separator}${segment.text}`;
    // The first segment is always taken even when it alone exceeds the cap: it is truncated
    // below, and a format with no text at all reports nothing rather than reporting less.
    if (candidate.length > maxLength && included.length > 0) omitted.push(segment);
    else {
      assembled = candidate;
      included.push(segment);
    }
  }
  const text = truncateForPublic(assembled, maxLength);
  const droppedCharacters = assembled.length - text.length
    + omitted.reduce((total, segment) => total + segment.text.length + separator.length, 0);
  const omittedSourceEventIds = unique(omitted.flatMap((segment) => [...segment.sourceEventIds]));
  return {
    text,
    sourceEventIds: unique(included.flatMap((segment) => [...segment.sourceEventIds])),
    omission: droppedCharacters > 0 || omittedSourceEventIds.length > 0
      ? {
        kind,
        reason: omittedSourceEventIds.length > 0 ? 'scene_not_covered' : 'length_cap',
        droppedCharacters,
        omittedSourceEventIds,
      }
      : null,
  };
}

/**
 * Derive the four FR-G005 share formats from one accepted Daily Episode.
 *
 * Deterministic: same Episode in, same copy out, no clock and no randomness — the same
 * requirement the reducers carry, and the reason a regenerated share format can be compared
 * against its predecessor rather than merely replacing it.
 *
 * ## Provenance, per format (AC#2)
 *
 * 地方新聞 quotes key scenes individually, so it carries exactly the events of the scenes that
 * fit — and its own headline line carries NONE, because the Episode builder does not record
 * which event produced `headline` and attributing it to one would be a guess. Its
 * `sourceEventIds` therefore means precisely "the developments this copy quotes", which is what
 * lets {@link validateEpisodeShareFormats} check that nothing was dropped unreported.
 *
 * The other three are built from the Episode ENVELOPE — `headline`, `oneLineSummary`,
 * `nextEpisodeTease`, `newQuestions` — which the Episode builder derived from its whole ordered
 * source set, so they carry the Episode's full `sourceEventIds`. The source Episode reference
 * carries the full list either way, so AC#2 does not rest on this distinction.
 */
export function deriveEpisodeShareFormats(episode: ShareSourceEpisode): EpisodeShareFormats {
  if (episode.worldId.trim().length === 0 || !Number.isSafeInteger(episode.worldDay) || episode.worldDay < 0
      || !Number.isSafeInteger(episode.episodeNumber) || episode.episodeNumber < 1) {
    throw new ShareFormatError('SHARE_INVALID_SOURCE', 'invalid source Episode envelope');
  }
  const episodeSourceEventIds = unique([...episode.sourceEventIds]);
  const sourceEpisode: ShareSourceEpisodeRef = {
    worldId: episode.worldId,
    worldDay: episode.worldDay,
    episodeNumber: episode.episodeNumber,
    contentRef: episodeShareContentRef(episode.worldId, episode.worldDay),
    sourceEventIds: episodeSourceEventIds,
  };
  const headline = clean(episode.headline);
  const oneLine = clean(episode.oneLineSummary);
  const omissions: ShareOmission[] = [];
  const formats: ShareFormat[] = [];

  const add = (kind: ShareFormatKind, composed: ReturnType<typeof compose>): void => {
    formats.push({ kind, label: SHARE_FORMAT_LABELS[kind], text: composed.text, sourceEventIds: composed.sourceEventIds });
    if (composed.omission) omissions.push(composed.omission);
  };

  // 地方新聞 — a local-paper item: the day's headline, then each key scene as its own line.
  add('local_news', compose('local_news', [
    { text: `【${SHARE_FORMAT_LABELS.local_news}】第 ${episode.episodeNumber} 集：${headline}`, sourceEventIds: [] },
    ...episode.keyScenes.map((scene) => ({
      text: `${clean(scene.title)}：${clean(scene.summary)}`,
      sourceEventIds: scene.sourceEventIds,
    })),
  ], '\n'));

  // 社群短文 — one paragraph a reader can post as-is. No channel handle, no hashtag pointing at
  // a platform: this copy is never transmitted anywhere by this deployment (see
  // {@link decideShareRelease}), and dressing it as a ready-to-send post would suggest otherwise.
  add('social_post', compose('social_post', [
    { text: headline, sourceEventIds: episodeSourceEventIds },
    { text: oneLine, sourceEventIds: episodeSourceEventIds },
  ], '——'));

  // 分享卡文案 — the one line that fits on a card beside the episode number.
  add('share_card', compose('share_card', [
    { text: `第 ${episode.episodeNumber} 集・${headline}`, sourceEventIds: episodeSourceEventIds },
  ], ''));

  // 明日預告 — the Episode's own tease, plus the questions it left open.
  add('next_day_teaser', compose('next_day_teaser', [
    { text: `【${SHARE_FORMAT_LABELS.next_day_teaser}】${clean(episode.nextEpisodeTease)}`, sourceEventIds: episodeSourceEventIds },
    ...episode.newQuestions.map((question) => ({ text: clean(question), sourceEventIds: episodeSourceEventIds })),
  ], ' '));

  return { schemaVersion: 1, sourceEpisode, formats, omissions };
}

/** Every character of derived copy, for the post-generation classifier. */
export function shareFormatsPublicText(formats: EpisodeShareFormats): string {
  return formats.formats.map((format) => format.text).join(' ');
}

const stringArray = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value)) throw new ShareFormatError('SHARE_FORMAT_INVALID', 'must be an array', path);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ShareFormatError('SHARE_FORMAT_INVALID', 'must be a non-empty string', `${path}[${index}]`);
    }
    return entry;
  });
};

function parseOmission(value: unknown, index: number): ShareOmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'must be an object', `omissions[${index}]`);
  }
  const row = value as Record<string, unknown>;
  const allowed = ['kind', 'reason', 'droppedCharacters', 'omittedSourceEventIds'];
  const unknownKey = Object.keys(row).find((key) => !allowed.includes(key));
  if (unknownKey) throw new ShareFormatError('SHARE_FORMAT_INVALID', `unknown field ${unknownKey}`, `omissions[${index}]`);
  if (!(SHARE_FORMAT_KINDS as readonly unknown[]).includes(row.kind)) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'unknown share format kind', `omissions[${index}].kind`);
  }
  if (row.reason !== 'length_cap' && row.reason !== 'scene_not_covered') {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'unknown omission reason', `omissions[${index}].reason`);
  }
  if (!Number.isSafeInteger(row.droppedCharacters) || (row.droppedCharacters as number) < 0) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'dropped character count must be a non-negative integer', `omissions[${index}].droppedCharacters`);
  }
  return {
    kind: row.kind as ShareFormatKind,
    reason: row.reason,
    droppedCharacters: row.droppedCharacters as number,
    omittedSourceEventIds: stringArray(row.omittedSourceEventIds, `omissions[${index}].omittedSourceEventIds`),
  };
}

/**
 * Validate derived share formats against FR-G005.
 *
 * `acceptedSourceEventIds` MUST come from the accepted-event log, NOT from the Episode object
 * the formats were derived from, and `expectedEpisode` from the caller's own identity for the
 * day. Handing this function the builder's own output for either would make every check below a
 * tautology that passes on any input — the failure ART-46 shipped and this file exists not to
 * repeat. The wiring reads the day's accepted events by index for exactly this reason.
 *
 * - AC#2 every format, and the envelope, resolve only to accepted events of the named Episode.
 * - AC#2 the source Episode reference matches the Episode the caller asked about.
 * - House rule: a format whose text was cut MUST carry a matching omission — silent truncation
 *   is a validation failure, not a formatting detail.
 */
export function validateEpisodeShareFormats(
  value: unknown,
  acceptedSourceEventIds: readonly string[],
  expectedEpisode: { readonly worldId: string; readonly worldDay: number; readonly episodeNumber: number },
): EpisodeShareFormats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'share formats must be an object');
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'unsupported schema version', 'schemaVersion');
  }
  const allowed = ['schemaVersion', 'sourceEpisode', 'formats', 'omissions'];
  const unknownKey = Object.keys(row).find((key) => !allowed.includes(key));
  if (unknownKey) throw new ShareFormatError('SHARE_FORMAT_INVALID', `unknown field ${unknownKey}`, unknownKey);

  const accepted = new Set(acceptedSourceEventIds);
  const assertTraced = (ids: readonly string[], path: string): void => {
    const untraced = ids.filter((id) => !accepted.has(id));
    if (untraced.length > 0) {
      throw new ShareFormatError('SHARE_SOURCE_NOT_ACCEPTED', `cites an event outside the accepted set: ${untraced[0]}`, path);
    }
  };

  const episodeRow = row.sourceEpisode;
  if (!episodeRow || typeof episodeRow !== 'object' || Array.isArray(episodeRow)) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'source Episode reference must be an object', 'sourceEpisode');
  }
  const reference = episodeRow as Record<string, unknown>;
  const referenceAllowed = ['worldId', 'worldDay', 'episodeNumber', 'contentRef', 'sourceEventIds'];
  if (Object.keys(reference).some((key) => !referenceAllowed.includes(key))) {
    throw new ShareFormatError('SHARE_FORMAT_INVALID', 'unknown field', 'sourceEpisode');
  }
  if (reference.worldId !== expectedEpisode.worldId || reference.worldDay !== expectedEpisode.worldDay
      || reference.episodeNumber !== expectedEpisode.episodeNumber) {
    throw new ShareFormatError('SHARE_SOURCE_EPISODE_MISMATCH', 'derived content names a different source Episode', 'sourceEpisode');
  }
  if (reference.contentRef !== episodeShareContentRef(expectedEpisode.worldId, expectedEpisode.worldDay)) {
    throw new ShareFormatError('SHARE_SOURCE_EPISODE_MISMATCH', 'source Episode content reference does not match the named Episode', 'sourceEpisode.contentRef');
  }
  const envelopeSourceEventIds = stringArray(reference.sourceEventIds, 'sourceEpisode.sourceEventIds');
  assertTraced(envelopeSourceEventIds, 'sourceEpisode.sourceEventIds');

  if (!Array.isArray(row.formats)) throw new ShareFormatError('SHARE_FORMAT_INVALID', 'must be an array', 'formats');
  const formats = row.formats.map((entry, index): ShareFormat => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ShareFormatError('SHARE_FORMAT_INVALID', 'must be an object', `formats[${index}]`);
    }
    const format = entry as Record<string, unknown>;
    const formatAllowed = ['kind', 'label', 'text', 'sourceEventIds'];
    if (Object.keys(format).some((key) => !formatAllowed.includes(key))) {
      throw new ShareFormatError('SHARE_FORMAT_INVALID', 'unknown field', `formats[${index}]`);
    }
    const kind = SHARE_FORMAT_KINDS[index];
    if (format.kind !== kind) {
      throw new ShareFormatError('SHARE_FORMAT_MISSING', `expected format '${kind}' at position ${index}`, `formats[${index}].kind`);
    }
    if (format.label !== SHARE_FORMAT_LABELS[kind]) {
      throw new ShareFormatError('SHARE_FORMAT_INVALID', 'label does not match the format kind', `formats[${index}].label`);
    }
    if (typeof format.text !== 'string' || format.text.trim().length === 0) {
      throw new ShareFormatError('SHARE_FORMAT_EMPTY', `${kind} must carry copy`, `formats[${index}].text`);
    }
    if (format.text.length > SHARE_FORMAT_MAX_LENGTHS[kind]) {
      throw new ShareFormatError('SHARE_FORMAT_TOO_LONG',
        `${kind} exceeds its ${SHARE_FORMAT_MAX_LENGTHS[kind]}-character cap (got ${format.text.length})`, `formats[${index}].text`);
    }
    const sourceEventIds = stringArray(format.sourceEventIds, `formats[${index}].sourceEventIds`);
    assertTraced(sourceEventIds, `formats[${index}].sourceEventIds`);
    return { kind, label: format.label, text: format.text, sourceEventIds };
  });
  if (formats.length !== SHARE_FORMAT_KINDS.length) {
    throw new ShareFormatError('SHARE_FORMAT_MISSING', `all ${SHARE_FORMAT_KINDS.length} FR-G005 formats are required (got ${formats.length})`, 'formats');
  }

  if (!Array.isArray(row.omissions)) throw new ShareFormatError('SHARE_FORMAT_INVALID', 'must be an array', 'omissions');
  const omissions = row.omissions.map((entry, index) => parseOmission(entry, index));
  for (const [index, omission] of omissions.entries()) {
    assertTraced(omission.omittedSourceEventIds, `omissions[${index}].omittedSourceEventIds`);
  }
  // Nothing the Episode reported may vanish from 地方新聞 unreported.
  //
  // Checked against `local_news` specifically because it is the only format that quotes key
  // scenes INDIVIDUALLY -- the other three are built from the Episode envelope and therefore
  // carry its whole source list by construction, which would make this check vacuous. Stated as
  // coverage rather than by looking for a trailing ellipsis: a provider's summary can legitimately
  // end in one, and a rule that read that as evidence of cutting would fail generation over
  // punctuation.
  const localNews = formats.find((format) => format.kind === 'local_news');
  const accountedFor = new Set([
    ...(localNews?.sourceEventIds ?? []),
    ...omissions.filter((omission) => omission.kind === 'local_news')
      .flatMap((omission) => omission.omittedSourceEventIds),
  ]);
  const unreported = envelopeSourceEventIds.filter((id) => !accountedFor.has(id));
  if (unreported.length > 0) {
    throw new ShareFormatError('SHARE_SILENT_OMISSION',
      `${SHARE_FORMAT_LABELS.local_news} dropped ${unreported.length} accepted development(s) without reporting them`,
      'omissions');
  }

  return structuredClone({
    schemaVersion: 1 as const,
    sourceEpisode: {
      worldId: expectedEpisode.worldId,
      worldDay: expectedEpisode.worldDay,
      episodeNumber: expectedEpisode.episodeNumber,
      contentRef: reference.contentRef,
      sourceEventIds: envelopeSourceEventIds,
    },
    formats,
    omissions,
  }) as EpisodeShareFormats;
}

/**
 * Whether derived copy may leave this deployment (FR-G005 AC#3).
 *
 * ## What "外部發布" means here, precisely
 *
 * This deployment has NO external publication transport. There is no social API client, no
 * outbound webhook, and `publicFunctionSurface.forbiddenRegistrations` bans `httpAction` outright,
 * so nothing can even receive a push. `docs/prd-1.0-closure-matrix.md` records the same finding
 * against PRD §6's non-goal. AC#3 is therefore NOT implemented as "we checked before sending",
 * because there is nothing to send with, and a test asserting that an empty set was never
 * transmitted would prove nothing.
 *
 * It is implemented as a REFUSAL AT THE CANDIDATE BOUNDARY instead: this is the only function
 * that decides whether derived copy is releasable, and its result type has no released variant.
 * The best outcome available is `manual_release_required` — copy an administrator may take, by
 * hand, after reading it. An automated path cannot reach anything better, because nothing better
 * exists to reach. The FR-K004 lifecycle carries the same rule in the other direction: share
 * records are created by the `system` actor, and `publish` is admin-only, so the pipeline that
 * generates this copy throws `PUBLICATION_UNAUTHORIZED` if it ever tries to publish it.
 *
 * Adding an external transport later therefore takes an edit to this union, which is the point.
 *
 * ## What blocks
 *
 * The safety verdict is the EXISTING ART-52/FR-P004 one — the classifier's label as revised by
 * any operator override, resolved by `resolveEffectiveSafetyLabel` and read through
 * `isPubliclyShowable`. This function forms no opinion of its own about whether text is safe; a
 * second, disagreeing opinion is the failure mode a derived-content gate is most likely to have.
 */
export type ShareReleaseDecision =
  | { readonly outcome: 'blocked'; readonly reasonCodes: readonly string[]; readonly formats: null }
  | { readonly outcome: 'manual_release_required'; readonly reasonCodes: readonly string[]; readonly formats: EpisodeShareFormats };

export type ShareReleaseInput = {
  readonly formats: EpisodeShareFormats;
  /** `dailyEpisodes.status` for the source Episode. Only a `ready` Episode may be reframed. */
  readonly sourceEpisodeStatus: string;
  /** The label governing the DERIVED copy right now, classifier verdict plus operator overrides. */
  readonly effectiveSafetyLabel: PostGenerationLabel;
};

export function decideShareRelease(input: ShareReleaseInput): ShareReleaseDecision {
  const reasonCodes: string[] = [];
  // A withheld or failed Episode is content the pipeline already refused to show. Reframing it
  // as 地方新聞 would republish it under a different heading, which is the same leak wearing a
  // label -- so the source status is checked as well as the derived copy's own classification.
  if (input.sourceEpisodeStatus !== 'ready') reasonCodes.push('SHARE_SOURCE_EPISODE_NOT_READY');
  if (!isPubliclyShowable(input.effectiveSafetyLabel)) reasonCodes.push('SHARE_SAFETY_WITHHELD');
  if (reasonCodes.length > 0) return { outcome: 'blocked', reasonCodes, formats: null };
  return { outcome: 'manual_release_required', reasonCodes: [], formats: input.formats };
}

/** The safety `sourceId` a day's derived copy is classified and overridden under. */
export const shareFormatsSafetySourceId = (worldId: string, worldDay: number): string =>
  `episode_share:${worldId}:${worldDay}`;

export type GatedShareFormatsInput = {
  readonly episode: ShareSourceEpisode;
  /**
   * The day's accepted event ids, read from the accepted-event log by the caller.
   *
   * MUST NOT be taken from {@link GatedShareFormatsInput.episode}. See
   * {@link validateEpisodeShareFormats} on why that would make the provenance check vacuous.
   */
  readonly acceptedSourceEventIds: readonly string[];
  /** `dailyEpisodes.status` for the source Episode. */
  readonly sourceEpisodeStatus: string;
  /** Operator revisions of THIS copy's label, in ledger order. Empty on a first run. */
  readonly safetyOverrides?: readonly SafetyStatusOverrideLike[];
};

/**
 * Derive, validate, classify and gate a day's share formats in one deterministic step.
 *
 * One function rather than four calls at each site because the ORDER carries the guarantee:
 * provenance is checked before the copy is classified, and the copy is classified before
 * anything decides whether it may be released. A caller that assembled these itself could put
 * the gate first and still pass a test that only looked at the outcome.
 */
export function deriveGatedShareFormats(input: GatedShareFormatsInput): {
  decision: ShareReleaseDecision;
  classification: PostGenerationClassification;
  formats: EpisodeShareFormats;
} {
  const formats = validateEpisodeShareFormats(
    deriveEpisodeShareFormats(input.episode),
    input.acceptedSourceEventIds,
    {
      worldId: input.episode.worldId,
      worldDay: input.episode.worldDay,
      episodeNumber: input.episode.episodeNumber,
    },
  );
  const sourceId = shareFormatsSafetySourceId(input.episode.worldId, input.episode.worldDay);
  // The derived copy gets its OWN classification: it is different text from the Episode's --
  // reordered, re-framed and cut to fit -- and reusing the Episode's verdict would claim a gate
  // ran over characters it never saw.
  const classification = classifyPostGeneration({
    classificationId: `${sourceId}:safety`,
    worldId: input.episode.worldId,
    sourceId,
    kind: 'public_artifact',
    text: shareFormatsPublicText(formats),
    coreFactIds: [...formats.sourceEpisode.sourceEventIds],
  });
  return {
    decision: decideShareRelease({
      formats,
      sourceEpisodeStatus: input.sourceEpisodeStatus,
      // Latest operator revision wins, by the one FR-P004 definition of it.
      effectiveSafetyLabel: resolveEffectiveSafetyLabel(classification, input.safetyOverrides ?? []),
    }),
    classification,
    formats,
  };
}
