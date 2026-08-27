/**
 * Pure render model for the viewer-intervention consequence view (FR-J002 / ART-46).
 *
 * The counterpart to {@link ./environmentVoteModel.ts}: the ballot says what a vote may do, this
 * says what one did — and, far more often, what cannot be shown to have followed from it.
 *
 * ## The one thing this module must not do
 *
 * FR-J002 AC#2 forbids the system from labelling all downstream outcomes as directly caused by
 * the vote. The server already refuses to infer causality (see
 * `convex/publicRead/voteConsequenceProjection.ts`), and the view must not put it back with
 * wording. So the four buckets get four DIFFERENT labels, each naming what its evidence actually
 * is, the uncertain bucket is never described as an effect, and
 * {@link VOTE_CONSEQUENCE_DISCLAIMER} is rendered unconditionally rather than only when
 * something is uncertain.
 *
 * On today's real data `direct` and `downstream` are empty — no provider writes
 * `causedByEventIds` — so the common case is a view that says so plainly.
 * {@link NO_CAUSAL_EDGE_NOTE} exists because an empty list reads like "the vote had no
 * consequences", which is a different and unsupported claim from "Canon records no causal link".
 *
 * No React, no Convex, no clock, no randomness, no storage.
 */

/**
 * The published `voteConsequence` payload, redeclared as every public page redeclares the model
 * it reads. `src/components/vote` may not depend on `convex/publicRead` (the module boundary in
 * `architecture/module-boundaries.json`), so the shape is restated here and the server owns it.
 */
export type VoteConsequenceNode = {
  eventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  publicSummary: string | null;
  publicationStatus: string;
  bucket: string;
  depth: number | null;
  path: string[];
  provenance: { basis: string; sourceEventIds: string[] };
};

export type VoteConsequencePayload = {
  worldId: string;
  targetWorldDay: number;
  trigger: VoteConsequenceNode | null;
  direct: VoteConsequenceNode[];
  downstream: VoteConsequenceNode[];
  uncertain: VoteConsequenceNode[];
  explicitCausalEdgeCount: number;
};

/**
 * The promise the consequence view must keep in front of the viewer at all times.
 *
 * Rendered whether or not anything is uncertain. A disclaimer a viewer only meets when the
 * system happens to be unsure is a disclaimer that reads as an apology for one screen rather
 * than as a statement about how the world works.
 */
export const VOTE_CONSEQUENCE_DISCLAIMER =
  '這裡只列出 Canon 記錄有據可查的關聯;投票之後發生的事並不等於由投票直接造成,後續發展仍由角色與世界規則決定。';

/** Said when the day has no accepted viewer-vote event at all. */
export const NO_TRIGGER_STATUS = '這一天沒有由觀眾投票觸發的事件。';

/**
 * Said when a trigger exists but Canon records no causal edge from it — today's normal case.
 *
 * The distinction this sentence protects: 「沒有記錄到因果關聯」 is a statement about the
 * evidence, 「沒有造成任何影響」 would be a statement about the world. Only the first is true.
 */
export const NO_CAUSAL_EDGE_NOTE =
  'Canon 目前沒有記錄任何事件明確由這次投票引發,因此下方不列出直接影響或後續衍生事件。';

/** What each bucket's provenance actually is, in the viewer's language. */
const BASIS_TEXT: Readonly<Record<string, string>> = {
  vote_idempotency_key: '依據:事件本身的投票識別碼',
  canon_caused_by: '依據:Canon 明確記錄的因果關聯',
  director_plan_context: '依據:導演在規劃這個場景時被告知了這次投票(不代表因果)',
};

export const GENERIC_BASIS_TEXT = '依據:已接受事件的來源記錄';

export function basisText(basis: string): string {
  return BASIS_TEXT[basis] ?? GENERIC_BASIS_TEXT;
}

/** A single row as the panel renders it. */
export type VoteConsequenceItem = {
  eventId: string;
  /** Never empty: a withheld summary renders the refusal, not a blank line. */
  summary: string;
  /** `第 7 天 · morning`, so a row is locatable without opening anything. */
  when: string;
  /** Causal distance, already worded; null where there is none to state. */
  depthLabel: string | null;
  basisLabel: string;
};

export type VoteConsequenceSection = {
  key: 'trigger' | 'direct' | 'downstream' | 'uncertain';
  title: string;
  /** What this bucket means, and — for `uncertain` — what it deliberately does not mean. */
  description: string;
  items: VoteConsequenceItem[];
  /** Shown in place of the list when the bucket is empty. Always present. */
  emptyText: string;
};

export type VoteConsequenceViewModel = {
  /** Whether a payload was published at all — the honest source of "not available". */
  available: boolean;
  /** True while a read this section depends on is still in flight. */
  loading: boolean;
  /** Heading-level status sentence. Always present, so the section never renders empty. */
  status: string;
  /** The 「沒有記錄到因果關聯」 note, or null when there is at least one Canon edge. */
  causalEvidenceNote: string | null;
  sections: VoteConsequenceSection[];
  disclaimer: string;
};

const WITHHELD_SUMMARY = '(這段敘述目前不予公開)';
const NO_SUMMARY = '(無摘要)';

function itemFrom(node: VoteConsequenceNode): VoteConsequenceItem {
  const summary = node.publicationStatus === 'withheld'
    ? WITHHELD_SUMMARY
    : (node.publicSummary ?? NO_SUMMARY);
  return {
    eventId: node.eventId,
    summary,
    when: `第 ${node.worldDay} 天 · ${node.timeSlot}`,
    // Depth 0 is the trigger itself; saying 「距離投票 0 層」 about the vote event is noise.
    depthLabel: node.depth === null || node.depth === 0 ? null : `因果距離 ${node.depth} 層`,
    basisLabel: basisText(node.provenance.basis),
  };
}

const SECTION_COPY: Readonly<Record<VoteConsequenceSection['key'], {
  title: string; description: string; emptyText: string;
}>> = {
  trigger: {
    title: '投票觸發事件',
    description: '這一天由觀眾投票送進世界的事件。',
    emptyText: NO_TRIGGER_STATUS,
  },
  direct: {
    title: '直接影響',
    description: 'Canon 明確記錄「由投票事件引發」的事件。',
    emptyText: 'Canon 沒有記錄任何事件明確由這次投票直接引發。',
  },
  downstream: {
    title: '後續衍生事件',
    description: '沿著 Canon 記錄的因果鏈,再往下一層以上的事件;每一條都附上實際的因果路徑。',
    emptyText: 'Canon 沒有記錄任何更後續的因果鏈。',
  },
  uncertain: {
    // Deliberately not 「間接影響」. These events are not claimed to be effects at all —
    // the only recorded fact is that the Director knew about the vote when it planned them.
    title: '尚無法確認的間接影響',
    description: '這些事件所屬的場景,導演在規劃時被告知了這次投票,但 Canon 沒有記錄任何因果關聯。它們不算是投票造成的結果。',
    emptyText: '沒有這一類事件。',
  },
};

function section(
  key: VoteConsequenceSection['key'],
  nodes: readonly VoteConsequenceNode[],
): VoteConsequenceSection {
  return { key, ...SECTION_COPY[key], items: nodes.map(itemFrom) };
}

/** Shown while a read is in flight. Never a claim about the world. */
export const LOADING_STATUS = '載入中…';

/** Shown once the reads have settled and there is genuinely nothing published for the day. */
export const UNAVAILABLE_STATUS = '尚未有投票後果資料。';

/**
 * Compose the panel's render model.
 *
 * `loading` is a SEPARATE input from `payload` being absent, and the distinction is the whole
 * point. The homepage cannot even name this model until the live projection tells it the world
 * day, so on every page load there is a window where the payload is legitimately missing and the
 * section knows nothing. Collapsing that into `payload === null` made the page assert
 * 「尚未有投票後果資料。」 — a factual claim about the world — for a moment on every single load,
 * before replacing it with the real answer. A loading state is not an empty result, and a view
 * whose whole purpose is to avoid overclaiming must not begin by overclaiming an absence.
 */
export function composeVoteConsequenceViewModel(input: {
  payload: VoteConsequencePayload | null | undefined;
  loading?: boolean;
}): VoteConsequenceViewModel {
  const payload = input.payload ?? null;
  const loading = input.loading ?? false;
  if (loading || payload === null) {
    return {
      available: false,
      loading,
      status: loading ? LOADING_STATUS : UNAVAILABLE_STATUS,
      causalEvidenceNote: null,
      sections: [],
      disclaimer: VOTE_CONSEQUENCE_DISCLAIMER,
    };
  }

  const hasTrigger = payload.trigger !== null;
  return {
    available: true,
    loading: false,
    status: hasTrigger
      ? `第 ${payload.targetWorldDay} 天的觀眾投票事件,以及可追溯的後續關聯。`
      : NO_TRIGGER_STATUS,
    // Only stated once there is a trigger to have caused something: on a day with no vote the
    // absence of causal edges is not a finding, it is arithmetic.
    causalEvidenceNote: hasTrigger && payload.explicitCausalEdgeCount === 0
      ? NO_CAUSAL_EDGE_NOTE
      : null,
    sections: [
      section('trigger', payload.trigger === null ? [] : [payload.trigger]),
      section('direct', payload.direct),
      section('downstream', payload.downstream),
      section('uncertain', payload.uncertain),
    ],
    disclaimer: VOTE_CONSEQUENCE_DISCLAIMER,
  };
}
