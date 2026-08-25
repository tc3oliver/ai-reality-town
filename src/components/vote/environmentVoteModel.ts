/**
 * Pure render model for the daily environment ballot (FR-J001 / ART-45).
 *
 * The one client module in `src` that is allowed to reach a write lives next door
 * ({@link ./useEnvironmentVote.ts}), and it is deliberately three lines long. Everything with a
 * correctness boundary — what the panel says, which control is offered, how a refusal is
 * explained — is here, as pure functions over plain data, so it is unit-testable without a DOM
 * and so the component stays a render layer.
 *
 * No React, no Convex, no clock, no randomness, no storage.
 */

/** The published ballot shape (`getEnvironmentVoteBallot`), redeclared as every public page does. */
export type EnvironmentVoteBallot = {
  worldId: string;
  worldDay: number;
  targetWorldDay: number;
  cutoffAt: number;
  candidates: Array<{ candidateId: string; title: string; description: string; votes: number }>;
  totalVotes: number;
};

/**
 * Stable refusal codes the server may return, mapped to viewer-facing text.
 *
 * Written out rather than derived, because these strings are the ONE place a stranger's
 * submission produces visible output. A default branch covers a code this build has not heard
 * of, so a server that grows a new refusal degrades to a generic sentence instead of rendering
 * `undefined` — or, worse, rendering the code.
 */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  VOTE_ROUND_NOT_OPEN: '投票已經截止了。',
  VOTE_ROUND_FULL: '這一輪投票已達上限。',
  VOTE_CANDIDATE_UNKNOWN: '這個選項不在今天的候選名單中。',
  VOTE_DEVICE_KEY_INVALID: '無法辨識這台裝置，請重新整理頁面。',
  VOTE_DEVICE_LIMIT_REACHED: '這台裝置今天已經投過票了。',
  VOTE_DEVICE_ATTEMPTS_EXHAUSTED: '這台裝置今天的嘗試次數已用完。',
  VOTE_INPUT_REJECTED: '這次送出的內容沒有通過安全檢查。',
};

export const GENERIC_REFUSAL_TEXT = '這次投票沒有成功，請稍後再試。';

export function refusalText(code: string | null): string {
  if (code === null) return GENERIC_REFUSAL_TEXT;
  return REFUSAL_TEXT[code] ?? GENERIC_REFUSAL_TEXT;
}

/** What the panel is currently doing. `idle` covers both "not yet voted" and "ready to retry". */
export type VoteInteractionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'accepted'; candidateId: string }
  | { kind: 'refused'; code: string | null };

export type EnvironmentVoteViewModel = {
  /** Whether a ballot exists to render at all — the honest source of `voteAvailable`. */
  available: boolean;
  /** Heading-level status sentence. Always present, so the section never renders empty. */
  status: string;
  /** What a winning vote would affect, or null when there is no ballot. */
  affectsWorldDay: number | null;
  options: Array<{
    candidateId: string;
    title: string;
    description: string;
    votes: number;
    /** Whole-percent share of the round's votes; 0 when nothing has been cast. */
    sharePercent: number;
    /** False once this device has voted, while a submission is in flight, or after the cutoff. */
    selectable: boolean;
    /** True for the option this device elected. */
    chosen: boolean;
  }>;
  totalVotes: number;
  /** Message shown under the options, or null. Carries a refusal or the thank-you. */
  message: string | null;
  /** The FR-J001 UX-005 promise, always rendered beside the ballot. */
  disclaimer: string;
};

/**
 * The promise the ballot must keep in front of the viewer at all times (UX-005).
 *
 * 「勝出不代表指定後續結果」is an acceptance criterion about the SYSTEM, and the system upholds
 * it structurally — the catalog cannot express an outcome. Saying so on the ballot is a
 * separate obligation: a viewer who believes they are commanding a character has been misled
 * even if the code refuses to obey them.
 */
export const VOTE_DISCLAIMER =
  '投票只會改變環境，不會指定任何角色的行動或結局；後續發展仍由角色與世界規則決定。';

const NO_BALLOT_STATUS = '投票尚未開放。';

/**
 * Compose the panel's render model.
 *
 * `now` is passed in rather than read, so the cutoff boundary is testable at an exact instant.
 * A ballot whose cutoff has passed still renders — with its counts and without its controls —
 * because a viewer arriving one minute late should see what was decided, not an empty section.
 */
export function composeEnvironmentVoteViewModel(input: {
  ballot: EnvironmentVoteBallot | null;
  interaction: VoteInteractionState;
  now: number;
  /**
   * Whether this render has a submit channel at all.
   *
   * Defaults to `true`. It is `false` wherever the panel is mounted outside a Convex provider —
   * the accessibility suite renders the real markup with no client, and the panel must show the
   * ballot there rather than throw. Modelled here instead of branching in the component so
   * "which control is offered" stays one testable function.
   */
  canSubmit?: boolean;
}): EnvironmentVoteViewModel {
  const { ballot, interaction, now } = input;
  const canSubmit = input.canSubmit ?? true;
  if (ballot === null) {
    return {
      available: false,
      status: NO_BALLOT_STATUS,
      affectsWorldDay: null,
      options: [],
      totalVotes: 0,
      message: null,
      disclaimer: VOTE_DISCLAIMER,
    };
  }

  const open = now < ballot.cutoffAt;
  const chosenId = interaction.kind === 'accepted' ? interaction.candidateId : null;
  // A device that has already voted, or is mid-submission, gets no further controls. This is a
  // courtesy, not the control: the server enforces the same limit and does not trust the page.
  const selectable = canSubmit && open && interaction.kind !== 'submitting' && chosenId === null;

  return {
    available: open,
    status: open
      ? `投票進行中，將影響第 ${ballot.targetWorldDay} 天的環境。`
      : `第 ${ballot.worldDay} 天的投票已截止。`,
    affectsWorldDay: ballot.targetWorldDay,
    options: ballot.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      title: candidate.title,
      description: candidate.description,
      votes: candidate.votes,
      sharePercent: ballot.totalVotes === 0
        ? 0
        : Math.round((candidate.votes / ballot.totalVotes) * 100),
      selectable,
      chosen: candidate.candidateId === chosenId,
    })),
    totalVotes: ballot.totalVotes,
    message: messageFor(interaction),
    disclaimer: VOTE_DISCLAIMER,
  };
}

function messageFor(interaction: VoteInteractionState): string | null {
  switch (interaction.kind) {
    case 'accepted':
      return '已收到你的投票。';
    case 'refused':
      return refusalText(interaction.code);
    case 'submitting':
      return '送出中…';
    default:
      return null;
  }
}
