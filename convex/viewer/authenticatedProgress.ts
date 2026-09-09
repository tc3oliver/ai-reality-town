/**
 * FR-J003 追蹤角色與 Arc — the authenticated half of viewer progress (ART-71).
 *
 * Pure module: no Convex, no clock, no randomness, no I/O. Same split as `./viewerProgress.ts`,
 * whose rules this reuses rather than restates — an authenticated viewer follows the same
 * characters, under the same caps, against the same published vocabulary. What is different is
 * only WHO the row belongs to, and that difference is one function: {@link authViewerKey}.
 *
 * ## Why this is a namespace and not a column
 *
 * `VIEWER_KEY_NAMESPACES` has carried `auth` since ART-39, unreachable, for exactly this task. An
 * authenticated row sits BESIDE the anonymous one rather than replacing it, which is what makes
 * FR-H004 AC#7's 「合併」 possible and 「遷移」 unnecessary: both operands still exist when the
 * merge runs, so a merge that goes wrong has lost nothing.
 *
 * ## The subject is digested, like every other viewer identifier here
 *
 * `authViewerKey` stores a digest of the identity provider's `subject`, never the subject itself.
 * The reason is the one `./schema.ts` gives for the device digest: a leaked row must not be
 * correlatable back to a value that still identifies someone. A Clerk `sub` is a stable account
 * identifier — more identifying than a browser token, not less — so it gets the same treatment.
 *
 * That the subject is TRUSTED is the one real difference from the device path, and it is Convex's
 * doing rather than ours: `ctx.auth.getUserIdentity()` returns a value only after Convex has
 * verified the JWT against the issuer in `convex/auth.config.ts`. So where `./viewerProgress.ts`
 * has to say plainly that 「deviceKey 是一項主張,不是身分」, this module does not — with the
 * corresponding obligation that the handler must never accept a subject from its arguments.
 *
 * ## What AC#7's second clause actually requires
 *
 * 「合併或遷移必須明確、經授權且無損」 — three properties, and each is enforced by a different part
 * of {@link planProgressMerge}:
 *
 *  - **明確 (explicit).** The merge is its own operation. Nothing merges as a side effect of
 *    signing in, because a viewer who signs in on a shared machine has not asked for that
 *    machine's history.
 *  - **經授權 (authorized).** The caller must present BOTH a verified identity and the device
 *    token itself. Holding the token is the only evidence that the anonymous history is theirs to
 *    claim, and the identity is the only thing that says which account claims it.
 *  - **無損 (lossless).** The merge is a union, and anything the caps cannot keep is REPORTED
 *    rather than dropped silently. A merge that quietly discarded four follows would satisfy a
 *    test asserting the result is well-formed while losing exactly what the clause protects.
 */

import { deviceDigest } from './environmentVote';
import {
  MAX_FOLLOWED_ARC_IDS,
  MAX_FOLLOWED_CHARACTER_IDS,
  parseViewerProgressEpisodeId,
  type ViewerKeyNamespace,
  type ViewerProgressRecord,
} from './viewerProgress';

/** The stored key for a verified identity. Never the subject itself. */
export function authViewerKey(subject: string): string {
  return `auth:${deviceDigest(subject)}`;
}

/** Which namespace a stored viewer key belongs to, or `null` when it is not a viewer key. */
export function viewerKeyNamespace(viewerKey: string): ViewerKeyNamespace | null {
  if (viewerKey.startsWith('device:')) return 'device';
  if (viewerKey.startsWith('auth:')) return 'auth';
  return null;
}

/**
 * A verified identity, reduced to the one field this module uses.
 *
 * Structural rather than Convex's `UserIdentity`, so the pure layer stays free of the server
 * types — and so a test cannot accidentally prove something about a mock's extra fields.
 */
export type VerifiedViewerIdentity = { subject: string };

export const AUTH_PROGRESS_REJECTION_CODES = [
  /** No verified identity. The endpoint is for authenticated viewers and says so. */
  'VIEWER_NOT_AUTHENTICATED',
  /** The identity carried no usable subject. Convex should never produce this; refuse rather than key on ''. */
  'VIEWER_IDENTITY_INVALID',
  /** The presented device token is not a well-formed progress token. */
  'MERGE_DEVICE_KEY_INVALID',
  /** There is no anonymous row under that token, so there is nothing to merge. */
  'MERGE_SOURCE_ABSENT',
] as const;
export type AuthProgressRejectionCode = (typeof AUTH_PROGRESS_REJECTION_CODES)[number];

/**
 * Resolve the stored key for a verified identity.
 *
 * Takes the identity rather than a subject string so a caller cannot reach this with a value that
 * came from its own arguments: the only way to obtain a `VerifiedViewerIdentity` is from
 * `ctx.auth.getUserIdentity()`, which Convex populates only after verifying the JWT.
 */
export function resolveAuthViewerKey(
  identity: VerifiedViewerIdentity | null,
): { ok: true; viewerKey: string } | { ok: false; code: AuthProgressRejectionCode } {
  if (identity === null) return { ok: false, code: 'VIEWER_NOT_AUTHENTICATED' };
  const subject = identity.subject;
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    return { ok: false, code: 'VIEWER_IDENTITY_INVALID' };
  }
  return { ok: true, viewerKey: authViewerKey(subject) };
}

/** What a merge kept, and what it could not. */
export type ProgressMergeSummary = {
  /** Follows present in the anonymous row that the merged record now carries. */
  addedCharacterIds: string[];
  addedArcIds: string[];
  /**
   * Follows the caps could not keep, published rather than dropped silently.
   *
   * A merge that discarded these quietly would still produce a well-formed record — which is why
   * losslessness has to be a reported quantity rather than an assertion about the output's shape.
   */
  droppedCharacterIds: string[];
  droppedArcIds: string[];
  /** Whether the merge moved the viewer's position forward, and from where. */
  advancedFrom: string | null;
  /** True when the two rows disagreed about spoiler mode and the account's setting was kept. */
  spoilerModeConflict: boolean;
};

export type ProgressMergePlan = {
  merged: ViewerProgressRecord;
  summary: ProgressMergeSummary;
};

/** The further of two episode ids, or whichever exists. Progress is a high-water mark. */
function furtherEpisode(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  const leftDay = parseViewerProgressEpisodeId(left)?.worldDay;
  const rightDay = parseViewerProgressEpisodeId(right)?.worldDay;
  // An unparseable id is not treated as day 0 — it is treated as no information, so a malformed
  // stored value cannot drag a viewer's position backwards.
  if (leftDay === undefined) return right;
  if (rightDay === undefined) return left;
  return rightDay > leftDay ? right : left;
}

/**
 * Union two follow lists under a cap, keeping `primary` first.
 *
 * The account's own follows win the cap because they are the ones the viewer chose while signed
 * in; the device's are the ones being claimed. Both orders are defensible and neither is
 * self-evidently right — so the one chosen is stated here, and whatever it displaces is returned
 * rather than discarded.
 */
function unionUnderCap(
  primary: readonly string[],
  secondary: readonly string[],
  cap: number,
): { kept: string[]; added: string[]; dropped: string[] } {
  const kept: string[] = [];
  const added: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const id of primary) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (kept.length < cap) kept.push(id);
    else dropped.push(id);
  }
  for (const id of secondary) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (kept.length < cap) {
      kept.push(id);
      added.push(id);
    } else {
      dropped.push(id);
    }
  }
  return { kept, added, dropped };
}

/**
 * Merge an anonymous device record into an authenticated one (FR-H004 AC#7, FR-J003).
 *
 * Pure and total. The caller has already established that the merge is explicit and authorized;
 * this settles what the result is, and what the merge could not carry.
 *
 * `account` may be `null` — an identity that has never recorded progress. That is the ordinary
 * first-sign-in case, and the anonymous record is then adopted whole rather than treated as a
 * conflict.
 */
export function planProgressMerge(input: {
  account: ViewerProgressRecord | null;
  device: ViewerProgressRecord;
}): ProgressMergePlan {
  const account = input.account;
  const device = input.device;

  const characters = unionUnderCap(
    account?.followedCharacterIds ?? [], device.followedCharacterIds, MAX_FOLLOWED_CHARACTER_IDS);
  const arcs = unionUnderCap(
    account?.followedArcIds ?? [], device.followedArcIds, MAX_FOLLOWED_ARC_IDS);

  const accountEpisode = account?.lastViewedEpisodeId ?? null;
  const lastViewedEpisodeId = furtherEpisode(accountEpisode, device.lastViewedEpisodeId);

  // The account's own spoiler mode is a setting the viewer chose while signed in; the device's is
  // a setting they chose before. Keeping the account's is the conservative reading of「這個帳號要
  // 看到什麼」, and the disagreement is reported so a client can offer the choice rather than
  // silently deciding it.
  const spoilerMode = account?.spoilerMode ?? device.spoilerMode;

  return {
    merged: {
      lastViewedEpisodeId,
      followedCharacterIds: characters.kept,
      followedArcIds: arcs.kept,
      spoilerMode,
    },
    summary: {
      addedCharacterIds: characters.added,
      addedArcIds: arcs.added,
      droppedCharacterIds: characters.dropped,
      droppedArcIds: arcs.dropped,
      advancedFrom: lastViewedEpisodeId !== accountEpisode ? accountEpisode : null,
      spoilerModeConflict: account !== null && account.spoilerMode !== device.spoilerMode,
    },
  };
}

/**
 * Whether a merge kept everything both rows carried.
 *
 * Exported because 「無損」 is the clause's own word, and a claim in a docblock is not evidence.
 * A merge is lossless exactly when nothing was dropped — the cap is the only thing that can drop
 * anything, and it does so only when the union genuinely exceeds what the product allows.
 */
export const mergeWasLossless = (summary: ProgressMergeSummary): boolean =>
  summary.droppedCharacterIds.length === 0 && summary.droppedArcIds.length === 0;
