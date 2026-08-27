/**
 * The server-owned catalog of votable environment events (FR-J001, ART-45).
 *
 * PRD 1.0 Epic J lists seven acceptable candidates (停電 / 暴雨 / 道路封閉 / 陌生人抵達 /
 * 報社收到匿名文件 / 工廠停工 / 節慶取消) and five unacceptable ones (命令角色殺人、指定角色
 * 愛上某人、指定犯人、強迫角色洩漏秘密、直接改寫 Canon Fact). This module is the acceptable
 * list, expressed as data.
 *
 * ## Why the catalog exists at all
 *
 * A viewer submits a candidate **id**, never text. The event a winning vote eventually becomes
 * is built server-side from the entry below, so the sentence that reaches Canon was written by
 * this repository and reviewed like any other source file. That is the mechanical form of
 * UX-005 「觀眾影響環境，但不能指定結果」 and of the architecture invariant that neither an LLM
 * nor a viewer may author a world fact — both may only propose, and here the viewer cannot even
 * propose freely, only choose among proposals the world already sanctioned.
 *
 * The rejected alternative was a free-text candidate submission passed through
 * `classifyViewerInput`. The classifier is good, but it is a filter over an unbounded input
 * space; a catalog is a bounded one. Where a closed set of choices is sufficient for the
 * requirement, a closed set is the stronger control, and the classifier is then kept as a
 * defence-in-depth gate over the catalog itself (`validateBallotCandidates` in
 * `convex/viewer/environmentVote.ts`) rather than as the only thing standing between a stranger
 * and a prompt.
 *
 * ## Why it lives in `shared`
 *
 * `viewer` (which runs the ballot) and `simulation` (which injects the winner) may not depend on
 * each other — `architecture/module-boundaries.json` allows neither edge, and adding one would
 * let the ballot reach the Canon commit pipeline directly. Both may depend on `shared`. Putting
 * the catalog here is therefore what keeps the winning id and the eventual event definition in
 * one place without giving the ballot any authority over Canon.
 *
 * Pure module: no Convex, no clock, no randomness, no imports.
 */

/**
 * One votable environment change.
 *
 * The shape is deliberately narrow. An entry can only ever become a `world_event` carrying a
 * single `fact_created` state change about the world subject — it has no `participantIds`
 * field, no character id, no relationship delta and no outcome. A candidate that wanted to
 * kill a character or name a culprit is not expressible here, which is AC#5 enforced by the
 * type rather than by review.
 */
export type EnvironmentVoteCandidate = {
  /** Stable id. This is the ONLY value a viewer ever submits. */
  readonly candidateId: string;
  /** Ballot label shown to viewers. */
  readonly title: string;
  /** One-line ballot description. States a condition, never a consequence. */
  readonly description: string;
  /**
   * World-environment fact key this candidate sets (`fact_created.predicate`), and its value.
   * Matches the `worldEnvironment` projection the reducer maintains, so a winning vote is
   * visible in exactly the same place a Director-proposed environment change is.
   */
  readonly predicate: string;
  readonly value: string;
  /** Public summary carried on the proposed event. Bounded by `MAX_PUBLIC_SUMMARY_LENGTH`. */
  readonly publicSummary: string;
};

/**
 * The seven acceptable candidates from FR-J001, in PRD order.
 *
 * Each is a CONDITION of the world. None names a character, an action or a result: a blackout
 * happens, and what the residents then do about it is decided by the Director, the characters
 * and Canon validation exactly as on any other day. 「勝出不代表指定後續結果」(AC#5) is a
 * property of this table's contents, and `environmentVote.test.ts` asserts it over every row
 * rather than trusting the reading.
 */
export const ENVIRONMENT_VOTE_CATALOG: readonly EnvironmentVoteCandidate[] = [
  {
    candidateId: 'power_outage',
    title: '停電',
    description: '鎮上的電力在今天中斷。',
    predicate: 'power',
    value: 'outage',
    publicSummary: '鎮上停電了。',
  },
  {
    candidateId: 'heavy_storm',
    title: '暴雨',
    description: '一場暴雨籠罩整個小鎮。',
    predicate: 'weather',
    value: 'storm',
    publicSummary: '暴雨籠罩小鎮。',
  },
  {
    candidateId: 'road_closure',
    title: '道路封閉',
    description: '對外道路今天無法通行。',
    predicate: 'road_access',
    value: 'closed',
    publicSummary: '對外道路封閉。',
  },
  {
    candidateId: 'stranger_arrival',
    title: '陌生人抵達',
    description: '一位沒有人認得的旅人抵達鎮上。',
    predicate: 'visitors',
    value: 'unknown_traveller',
    publicSummary: '一位陌生的旅人抵達鎮上。',
  },
  {
    candidateId: 'anonymous_document',
    title: '報社收到匿名文件',
    description: '報社的信箱裡出現一份沒有署名的文件。',
    predicate: 'press_desk',
    value: 'anonymous_document',
    publicSummary: '報社收到一份匿名文件。',
  },
  {
    candidateId: 'factory_shutdown',
    title: '工廠停工',
    description: '工廠今天停止運作。',
    predicate: 'factory',
    value: 'shutdown',
    publicSummary: '工廠停工。',
  },
  {
    candidateId: 'festival_cancelled',
    title: '節慶取消',
    description: '原訂的節慶活動宣告取消。',
    predicate: 'festival',
    value: 'cancelled',
    publicSummary: '節慶活動取消。',
  },
];

export const ENVIRONMENT_VOTE_CANDIDATE_IDS: readonly string[] =
  ENVIRONMENT_VOTE_CATALOG.map((candidate) => candidate.candidateId);

/**
 * Prefix every viewer-elected proposal's `idempotencyKey` carries.
 *
 * The one marker that survives into accepted Canon, and therefore the only way a later reader
 * can tell 「哪個事件由觀眾投票觸發」(FR-J002) without a side table. Declared here, next to the
 * catalog, so `viewer` (which mints the key) and `simulation` (which reads it back off accepted
 * history) cannot drift — neither module may import the other.
 */
export const VIEWER_VOTE_IDEMPOTENCY_PREFIX = 'vote:';

/**
 * The `modelRef` of the FR-J002 consequence read model for one world day (ART-46).
 *
 * Here, in `shared`, for the same reason the prefix above is: FIVE modules have to spell this
 * string identically — the projection that publishes it, the post-commit pipeline that names it,
 * the homepage that reads it, the E2E fixture that answers it, and two in-memory test harnesses —
 * and no two of them may import each other. A hand-built template string in each was the ART-146
 * shape exactly: the fixture and the client disagreed about a key, the query resolved to nothing,
 * and the page failed somewhere that looked unrelated.
 *
 * `modelKind` deliberately stays in `convex/publicRead/voteConsequenceProjection.ts` beside
 * `READ_MODEL_KINDS`, which is the registry it has to agree with.
 */
export function voteConsequenceModelRef(worldId: string, targetWorldDay: number): string {
  return `voteConsequence:${worldId}:${targetWorldDay}`;
}

/** The catalog entry for an id, or `null`. Total: an unknown id is a value, not a throw. */
export function findEnvironmentVoteCandidate(candidateId: string): EnvironmentVoteCandidate | null {
  return ENVIRONMENT_VOTE_CATALOG.find((candidate) => candidate.candidateId === candidateId) ?? null;
}
