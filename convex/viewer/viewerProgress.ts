/**
 * Viewer progress — the whole decision layer for FR-H004 / ART-39 (PRD §13.12).
 *
 * Pure module: no Convex, no clock, no randomness, no I/O. Every rule with a correctness
 * boundary lives here so it can be unit-tested directly, and the Convex adapter in
 * {@link ./viewerProgressFunctions.ts} is left with nothing but row access. Same split, and for
 * the same reason, as {@link ./environmentVote.ts}.
 *
 * ## What AC#7 does and does not claim
 *
 * FR-H004 AC#7 reads「匿名裝置進度與已登入進度不得跨身分讀取或修改;合併或遷移必須明確、經授權
 * 且無損」. This module delivers the FIRST clause, structurally:
 *
 *  - Every read and every write is keyed on a digest of the CALLER'S OWN token, looked up through
 *    the `by_world_and_viewer` index. No caller supplies a row id, nothing scans, and there is no
 *    argument through which one viewer can name another's row. Cross-identity access is not
 *    refused by a check that could be forgotten — there is no code path that reaches another
 *    row at all.
 *  - `viewerProgressFunctions.test.ts` proves it from the outside: a request presenting digest B
 *    can neither observe nor mutate digest A's row.
 *
 * **And it must be said plainly what that is worth.** The token is minted by the browser and is
 * never verified against anything. So this isolation holds against ACCIDENT (two devices cannot
 * collide into one row) and against ENUMERATION (there is no id to guess and no listing to walk),
 * and it does NOT hold against an adversary who has obtained someone else's token — that person
 * simply is that viewer, exactly as {@link ./environmentVote.ts} already records for voting:
 * 「deviceKey 是一項主張,不是身分」.
 *
 * The SECOND clause — explicit, authorized, lossless merging — is not implemented and is not
 * simulated. This deployment has no viewer authentication at all (`convex/auth.config.ts`
 * returns `providers: []` without `CLERK_JWT_ISSUER_DOMAIN`, and the only `getUserIdentity()`
 * callers are operator functions), so「已登入進度」is a provably empty set: a merge written now
 * would have no second operand, its authorization predicate would have no credential to consult,
 * and its losslessness could only be demonstrated against a fabricated identity in a test —
 * evidence about the test, not about the system. ART-71 (FR-J003) owns that half and depends on
 * this task. The `viewerKey` namespace below is what makes it a merge rather than a migration.
 *
 * ## Abuse resistance
 *
 * Progress is written far more often than a ballot is cast, so the budget is larger — but it
 * counts the same thing, ATTEMPTS rather than accepted writes, so probing the surface with
 * unknown ids costs a caller exactly what recording progress costs them.
 *
 *  - **The follow sets are validated against published content, not merely length-capped.** An
 *    unchecked array of caller-supplied strings is a free string store wearing a product feature
 *    as a disguise. Both caps apply and both are enforced here.
 *  - **A world is capped in total rows.** Clearing storage mints a new token and therefore buys a
 *    new row, so the row count is the resource that actually costs something.
 */

import { classifyViewerInput } from '../safety/viewerInput';
import { deviceDigest } from './environmentVote';
import { isSpoilerMode, type SpoilerMode } from './spoilerMode';

export const VIEWER_PROGRESS_SCHEMA_VERSION = 1;

/**
 * Accepted shape of an opaque progress token. Identical to the ballot's `DEVICE_KEY_PATTERN`
 * because both are the same kind of value — an opaque browser-minted token — but the TOKENS are
 * different values under different storage keys, so the two surfaces cannot be joined on one
 * column (§15). See `src/components/recap/viewerProgressKey.ts`.
 */
const PROGRESS_DEVICE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/**
 * Whether a client-supplied token has the accepted shape.
 *
 * Exported so the READ path can refuse a malformed key before it touches a row. Digesting
 * garbage produces a perfectly well-formed digest, so without this the read would go looking for
 * a row that cannot exist — and the claim that a malformed key is answered without a row access
 * would be a comment describing a code path that was not there.
 */
export function isProgressDeviceKey(value: unknown): value is string {
  return typeof value === 'string' && PROGRESS_DEVICE_KEY_PATTERN.test(value);
}

/**
 * The identity namespaces a `viewerKey` may carry.
 *
 * `device` is all that exists today. `auth` is declared now, and unreachable now, so that ART-71
 * adds authenticated rows beside anonymous ones instead of rewriting the anonymous ones —
 * which is what「合併」can mean and「遷移」cannot.
 */
export const VIEWER_KEY_NAMESPACES = ['device', 'auth'] as const;
export type ViewerKeyNamespace = (typeof VIEWER_KEY_NAMESPACES)[number];

/** The stored key for a browser-minted device token. Never the token itself. */
export function deviceViewerKey(deviceKey: string): string {
  return `device:${deviceDigest(deviceKey)}`;
}

export function isViewerKey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return false;
  return (VIEWER_KEY_NAMESPACES as readonly string[]).includes(value.slice(0, separator));
}

/**
 * §13.12's `lastViewedEpisodeId`, derived rather than stored-and-trusted.
 *
 * Editorial episodes carry no id of their own — they are addressed by `(worldId, worldDay)`
 * everywhere in this codebase, including the `#episode/<worldId>/<worldDay>` deep link the public
 * pages already build. Deriving the PRD's field from that pair keeps one spelling and makes the
 * value checkable against the published episode index, which is what turns「參照驗證」into
 * something a test can settle.
 */
export function viewerProgressEpisodeId(worldId: string, worldDay: number): string {
  return `episode:${worldId}:${worldDay}`;
}

/** The `(worldId, worldDay)` an episode id names, or `null` when it is not one. */
export function parseViewerProgressEpisodeId(
  episodeId: string,
): { worldId: string; worldDay: number } | null {
  const match = /^episode:(.+):(\d+)$/.exec(episodeId);
  if (match === null) return null;
  const worldDay = Number(match[2]);
  return Number.isSafeInteger(worldDay) && worldDay >= 0 ? { worldId: match[1], worldDay } : null;
}

/** FR-H005's default perspective, and the only one the published data can currently serve. */
export const DEFAULT_SPOILER_MODE: SpoilerMode = 'publicOnly';

/**
 * How many characters and arcs one viewer may follow.
 *
 * Small on purpose, and not only for storage: FR-H004 AC#2 asks the recap to PRIORITISE followed
 * content, and a follow set the size of the cast prioritises nothing. Mistwood has twelve
 * residents and the world sustains 1–3 active arcs (§5.1 G6), so these bounds are the roster and
 * roughly twice the live arc portfolio.
 */
export const MAX_FOLLOWED_CHARACTER_IDS = 12;
export const MAX_FOLLOWED_ARC_IDS = 6;

/**
 * Submissions one device may make against one world, accepted and refused alike.
 *
 * Larger than the ballot's five because progress is legitimately re-recorded — every time the
 * viewer follows someone, changes spoiler mode, or marks a new position — and small enough that
 * the endpoint cannot be used to enumerate which character and arc ids a world contains. That
 * second property is the one that matters: referential validation would otherwise turn every
 * refusal into an oracle answering「這個 id 存在嗎」.
 */
export const MAX_ATTEMPTS_PER_DEVICE_PER_WORLD = 60;

/**
 * Hard ceiling on `viewerProgress` rows for one world.
 *
 * One row per (world, device), so a caller rotating tokens to evade the attempt budget is buying
 * rows out of this budget instead. Capping attempts alone would leave the row count unbounded,
 * which is the resource that actually costs something.
 */
export const MAX_PROGRESS_ROWS_PER_WORLD = 100_000;

export const VIEWER_PROGRESS_REJECTION_CODES = [
  'PROGRESS_ATTEMPTS_EXHAUSTED',
  'PROGRESS_DEVICE_KEY_INVALID',
  'PROGRESS_WORLD_UNKNOWN',
  'PROGRESS_WORLD_FULL',
  'PROGRESS_FOLLOW_LIMIT_EXCEEDED',
  'PROGRESS_INPUT_REJECTED',
  'PROGRESS_SPOILER_MODE_INVALID',
  'PROGRESS_REFERENCE_UNKNOWN',
] as const;
export type ViewerProgressRejectionCode = (typeof VIEWER_PROGRESS_REJECTION_CODES)[number];

/**
 * The refusals that must write NOTHING — no row, no counter, not even a timestamp.
 *
 * The line is drawn where it can be stated rather than remembered: **a refusal writes nothing
 * when it was decided before the submission's CONTENT was examined.** Those four are properties
 * of the caller and the world, not of what was submitted, so recording an attempt for them would
 * meter something the budget does not exist to meter — and in two cases it would do active harm:
 *
 *  - `PROGRESS_WORLD_FULL` can only fire when this device has NO row yet, so writing the attempt
 *    means allocating the very row the ceiling just refused, and incrementing `rowCount` past the
 *    ceiling. The one refusal whose entire purpose is "do not allocate" would allocate.
 *  - `PROGRESS_WORLD_UNKNOWN` is the same failure with an unbounded multiplier: a made-up
 *    `worldId` gets its own counter starting at zero, so a per-world ceiling bounds nothing
 *    across worlds.
 *
 * Every refusal that DID examine content — the follow caps, the classifier, the spoiler mode, the
 * referential checks — still records its attempt. Those are exactly the ones that could otherwise
 * turn this surface into an oracle, and they are what the budget is for.
 *
 * Exported so {@link ./viewerProgressFunctions.ts} derives its early return from this list
 * instead of keeping a second copy that can drift from it.
 */
export const NON_WRITING_REJECTION_CODES: readonly ViewerProgressRejectionCode[] = [
  'PROGRESS_ATTEMPTS_EXHAUSTED',
  'PROGRESS_DEVICE_KEY_INVALID',
  'PROGRESS_WORLD_UNKNOWN',
  'PROGRESS_WORLD_FULL',
];

export function refusalWritesNothing(code: ViewerProgressRejectionCode): boolean {
  return NON_WRITING_REJECTION_CODES.includes(code);
}

/** Untrusted, caller-supplied. Nothing here is stored before it has passed this module. */
export type ViewerProgressSubmission = {
  worldId: string;
  /** Opaque, client-supplied, untrusted. Validated structurally; never logged as-is. */
  deviceKey: string;
  /** `episode:<worldId>:<worldDay>`, or null to leave the position unrecorded. */
  lastViewedEpisodeId: string | null;
  followedCharacterIds: readonly string[];
  followedArcIds: readonly string[];
  spoilerMode: string;
};

/** What this device has already done against this world. */
export type ViewerProgressHistory = { attempts: number };

/**
 * The published content a submission may reference (AC#6 runtime validation, referential half).
 *
 * Built by the adapter from the `episodes:<worldId>` read model, which is the only published
 * source that carries the world's whole character and arc vocabulary in one row. Passed in as
 * sets so this module stays free of the read model's shape.
 */
export type PublishedWorldContent = {
  characterIds: ReadonlySet<string>;
  arcIds: ReadonlySet<string>;
  episodeIds: ReadonlySet<string>;
};

/** The §13.12 record, after validation. `viewerKey` and `worldId` are the adapter's to supply. */
export type ViewerProgressRecord = {
  lastViewedEpisodeId: string | null;
  followedCharacterIds: string[];
  followedArcIds: string[];
  spoilerMode: SpoilerMode;
};

export type ViewerProgressDecision =
  | { accepted: true; record: ViewerProgressRecord }
  | { accepted: false; code: ViewerProgressRejectionCode };

export class ViewerProgressError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ViewerProgressError';
  }
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * The whole per-submission decision, in one pure function (AC#6, AC#7 first clause).
 *
 * Ordered so the cheapest and least informative refusals come first: an exhausted device is
 * refused before its submission is parsed, so burning the budget yields nothing, and referential
 * refusals — the only ones that say anything about the world — come last, behind the budget that
 * bounds how many of them a caller can collect. Every branch returns a stable code and none of
 * them echoes the submission.
 */
export function evaluateViewerProgressSubmission(input: {
  submission: ViewerProgressSubmission;
  history: ViewerProgressHistory;
  /**
   * The world's published vocabulary, or `null` when the world has published NO episode index
   * at all — which is the only evidence this module has that a `worldId` names anything.
   *
   * `null` and "published but empty" are deliberately different. The second is a real world that
   * has not shipped an episode yet; the first is a string the caller made up.
   */
  published: PublishedWorldContent | null;
  /** Current `viewerProgress` row count for this world. */
  rowCount: number;
  /** Whether this device already has a row — only a NEW row spends the world's ceiling. */
  hasExistingRow: boolean;
}): ViewerProgressDecision {
  const { submission, history, published, rowCount, hasExistingRow } = input;

  if (history.attempts >= MAX_ATTEMPTS_PER_DEVICE_PER_WORLD) {
    return { accepted: false, code: 'PROGRESS_ATTEMPTS_EXHAUSTED' };
  }
  if (!isProgressDeviceKey(submission.deviceKey)) {
    return { accepted: false, code: 'PROGRESS_DEVICE_KEY_INVALID' };
  }
  // `worldId` is a caller-supplied string like any other, and until this check it was validated
  // by nothing: an empty submission against a made-up world passed every referential check
  // VACUOUSLY (`[].some(...)` is `false`) and allocated a row plus a fresh counter. Anchoring on
  // a published row before any write is the same thing `submitEnvironmentVote` does with the open
  // round — it refuses `VOTE_ROUND_NOT_OPEN` before it writes anything, rather than trusting the
  // `worldId` it was handed.
  //
  // This leaks nothing new: `getPublishedReadModel` is an anonymous public query, so whether a
  // world has published content is already answerable without this surface.
  if (published === null) {
    return { accepted: false, code: 'PROGRESS_WORLD_UNKNOWN' };
  }
  if (!hasExistingRow && rowCount >= MAX_PROGRESS_ROWS_PER_WORLD) {
    return { accepted: false, code: 'PROGRESS_WORLD_FULL' };
  }

  const characterIds = unique([...submission.followedCharacterIds]);
  const arcIds = unique([...submission.followedArcIds]);
  if (characterIds.length > MAX_FOLLOWED_CHARACTER_IDS || arcIds.length > MAX_FOLLOWED_ARC_IDS) {
    return { accepted: false, code: 'PROGRESS_FOLLOW_LIMIT_EXCEEDED' };
  }

  // FR-L003 defence in depth, and the same ordering the ballot uses: the referential check below
  // would refuse an injection payload anyway, but the classifier refuses it BEFORE the id is
  // compared, so it never reaches a code path that could log it.
  const submitted = [
    ...characterIds,
    ...arcIds,
    ...(submission.lastViewedEpisodeId === null ? [] : [submission.lastViewedEpisodeId]),
  ];
  for (const text of submitted) {
    if (classifyViewerInput({ surface: 'viewer_progress', text }).label === 'reject') {
      return { accepted: false, code: 'PROGRESS_INPUT_REJECTED' };
    }
  }

  if (!isSpoilerMode(submission.spoilerMode)) {
    return { accepted: false, code: 'PROGRESS_SPOILER_MODE_INVALID' };
  }

  // Referential validation. Without it the follow sets are an unauthenticated key-value store
  // with a 60-write budget, which is what `classifyViewerInput` exists to stop being possible.
  if (submission.lastViewedEpisodeId !== null
    && !published.episodeIds.has(submission.lastViewedEpisodeId)) {
    return { accepted: false, code: 'PROGRESS_REFERENCE_UNKNOWN' };
  }
  if (characterIds.some((characterId) => !published.characterIds.has(characterId))) {
    return { accepted: false, code: 'PROGRESS_REFERENCE_UNKNOWN' };
  }
  if (arcIds.some((arcId) => !published.arcIds.has(arcId))) {
    return { accepted: false, code: 'PROGRESS_REFERENCE_UNKNOWN' };
  }

  return {
    accepted: true,
    record: {
      lastViewedEpisodeId: submission.lastViewedEpisodeId,
      // Sorted so the same follow set serialises one way, and a re-record of an unchanged
      // selection produces an identical row rather than a reordered one.
      followedCharacterIds: [...characterIds].sort(),
      followedArcIds: [...arcIds].sort(),
      spoilerMode: submission.spoilerMode,
    },
  };
}

/**
 * Runtime validation of a STORED record on the way out (AC#6).
 *
 * The write path above is not the only way a row can be wrong: a row written by an older schema,
 * or by a future namespace this build does not know, must not be served as though this build
 * understood it. So the read path validates too, and an unreadable row is reported as a defect
 * rather than coerced into something plausible. `spoilerMode` is the field that matters most —
 * an unrecognised mode would silently decide what a viewer is shown.
 */
export function validateViewerProgressRecord(value: unknown): ViewerProgressRecord {
  if (typeof value !== 'object' || value === null) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'record must be an object');
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== VIEWER_PROGRESS_SCHEMA_VERSION) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'unsupported schema version');
  }
  if (!isViewerKey(row.viewerKey)) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'viewerKey carries no known namespace');
  }
  if (!isSpoilerMode(row.spoilerMode)) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'spoilerMode is not a known mode');
  }
  const lastViewedEpisodeId = row.lastViewedEpisodeId ?? null;
  if (lastViewedEpisodeId !== null
    && (typeof lastViewedEpisodeId !== 'string' || parseViewerProgressEpisodeId(lastViewedEpisodeId) === null)) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'lastViewedEpisodeId is not an episode id');
  }
  const stringArray = (field: string): string[] => {
    const candidate = row[field];
    if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== 'string')) {
      throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', `${field} must be an array of strings`);
    }
    return candidate as string[];
  };
  const followedCharacterIds = stringArray('followedCharacterIds');
  const followedArcIds = stringArray('followedArcIds');
  if (followedCharacterIds.length > MAX_FOLLOWED_CHARACTER_IDS
    || followedArcIds.length > MAX_FOLLOWED_ARC_IDS) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'stored follow set exceeds its cap');
  }
  if (!Number.isFinite(row.updatedAt)) {
    throw new ViewerProgressError('VIEWER_PROGRESS_INVALID', 'updatedAt must be finite');
  }
  return {
    lastViewedEpisodeId,
    followedCharacterIds,
    followedArcIds,
    spoilerMode: row.spoilerMode,
  };
}
