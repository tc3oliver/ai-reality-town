/**
 * The consequence view model (FR-J002 / ART-46).
 *
 * The claims worth pinning here are about WORDING, because the view is where AC#2 is most
 * easily broken: the server can refuse to infer causality and a label that says 「投票造成的
 * 所有後果」 would put the overclaim back for free.
 */

import {
  composeVoteConsequenceViewModel,
  basisText,
  GENERIC_BASIS_TEXT,
  LOADING_STATUS,
  UNAVAILABLE_STATUS,
  NO_CAUSAL_EDGE_NOTE,
  NO_TRIGGER_STATUS,
  VOTE_CONSEQUENCE_DISCLAIMER,
  type VoteConsequenceNode,
  type VoteConsequencePayload,
} from './voteConsequenceModel';

function node(over: Partial<VoteConsequenceNode> = {}): VoteConsequenceNode {
  return {
    eventId: 'mistwood#event#2',
    sequenceNumber: 2,
    worldDay: 7,
    timeSlot: 'morning',
    eventType: 'conversation',
    publicSummary: '磨坊熄了燈。',
    publicationStatus: 'published',
    bucket: 'direct',
    depth: 1,
    path: ['mistwood#event#1', 'mistwood#event#2'],
    provenance: { basis: 'canon_caused_by', sourceEventIds: ['mistwood#event#1'] },
    ...over,
  };
}

function payload(over: Partial<VoteConsequencePayload> = {}): VoteConsequencePayload {
  return {
    worldId: 'mistwood',
    targetWorldDay: 7,
    trigger: node({
      eventId: 'mistwood#event#1', sequenceNumber: 1, bucket: 'trigger', depth: 0,
      publicSummary: '全鎮停電。', path: ['mistwood#event#1'],
      provenance: { basis: 'vote_idempotency_key', sourceEventIds: ['mistwood#event#1'] },
    }),
    direct: [],
    downstream: [],
    uncertain: [],
    explicitCausalEdgeCount: 0,
    ...over,
  };
}

const sectionOf = (vm: ReturnType<typeof composeVoteConsequenceViewModel>, key: string) => {
  const found = vm.sections.find((section) => section.key === key);
  expect(found).toBeDefined();
  return found!;
};

describe('AC#1 — all four buckets are rendered, each with its own label', () => {
  it('renders the four sections in order with distinct titles', () => {
    const vm = composeVoteConsequenceViewModel({ payload: payload() });
    expect(vm.sections.map((section) => section.key))
      .toEqual(['trigger', 'direct', 'downstream', 'uncertain']);
    expect(vm.sections.map((section) => section.title))
      .toEqual(['投票觸發事件', '直接影響', '後續衍生事件', '尚無法確認的間接影響']);
  });

  it('states the causal distance of a downstream event, and none for the trigger', () => {
    const vm = composeVoteConsequenceViewModel({
      payload: payload({
        direct: [node()],
        downstream: [node({ eventId: 'mistwood#event#3', bucket: 'downstream', depth: 2 })],
        explicitCausalEdgeCount: 2,
      }),
    });
    expect(sectionOf(vm, 'trigger').items[0].depthLabel).toBeNull();
    expect(sectionOf(vm, 'direct').items[0].depthLabel).toBe('因果距離 1 層');
    expect(sectionOf(vm, 'downstream').items[0].depthLabel).toBe('因果距離 2 層');
  });

  it('gives every empty bucket a sentence rather than a blank list', () => {
    const vm = composeVoteConsequenceViewModel({ payload: payload() });
    expect(vm.sections.every((section) => section.emptyText.length > 0)).toBe(true);
  });

  it('distinguishes "not loaded" from "no consequences"', () => {
    // While a read is in flight the section says so. It must NOT say 「尚未有投票後果資料。」,
    // which is a claim about the world and is made before anything has been looked at — on the
    // homepage that window opens on every single load, because the world day this model is
    // keyed on only arrives with the live projection.
    const inFlight = composeVoteConsequenceViewModel({ payload: undefined, loading: true });
    expect(inFlight.loading).toBe(true);
    expect(inFlight.status).toBe(LOADING_STATUS);
    expect(inFlight.status).not.toBe(UNAVAILABLE_STATUS);

    for (const value of [undefined, null] as const) {
      const vm = composeVoteConsequenceViewModel({ payload: value });
      expect(vm.available).toBe(false);
      expect(vm.loading).toBe(false);
      expect(vm.status).toBe(UNAVAILABLE_STATUS);
      expect(vm.sections).toEqual([]);
      // The disclaimer is present even here: it is a statement about the system, not about
      // this particular day's data.
      expect(vm.disclaimer).toBe(VOTE_CONSEQUENCE_DISCLAIMER);
    }
  });

  it('reports loading even when a stale payload is still in hand', () => {
    // Otherwise a day-change would keep rendering the PREVIOUS day's buckets under the new
    // day's heading, which is worse than saying nothing.
    const vm = composeVoteConsequenceViewModel({ payload: payload(), loading: true });
    expect(vm.status).toBe(LOADING_STATUS);
    expect(vm.sections).toEqual([]);
  });

  it('reports a day with no viewer vote as exactly that', () => {
    const vm = composeVoteConsequenceViewModel({ payload: payload({ trigger: null }) });
    expect(vm.available).toBe(true);
    expect(vm.status).toBe(NO_TRIGGER_STATUS);
    // Not a finding about causality — there was no vote to have caused anything.
    expect(vm.causalEvidenceNote).toBeNull();
  });
});

describe('AC#2 — the wording never claims the vote caused what followed', () => {
  it('says Canon recorded no causal link, rather than showing an empty list', () => {
    // The production case. 「沒有記錄到因果關聯」 is a statement about the evidence;
    // 「沒有造成影響」 would be a statement about the world, and is not supported.
    const vm = composeVoteConsequenceViewModel({
      payload: payload({ uncertain: [node({ bucket: 'uncertain', depth: null, path: [], provenance: { basis: 'director_plan_context', sourceEventIds: ['mistwood#event#1'] } })] }),
    });
    expect(vm.causalEvidenceNote).toBe(NO_CAUSAL_EDGE_NOTE);
    expect(vm.causalEvidenceNote).not.toContain('沒有造成');
  });

  it('drops the note once Canon does record an edge', () => {
    const vm = composeVoteConsequenceViewModel({
      payload: payload({ direct: [node()], explicitCausalEdgeCount: 1 }),
    });
    expect(vm.causalEvidenceNote).toBeNull();
  });

  it('does not call the uncertain bucket an effect, and says why', () => {
    const vm = composeVoteConsequenceViewModel({ payload: payload() });
    const uncertain = sectionOf(vm, 'uncertain');
    expect(uncertain.description).toContain('Canon 沒有記錄任何因果關聯');
    expect(uncertain.description).toContain('不算是投票造成的結果');
  });

  it('always renders the disclaimer, including when everything is causally linked', () => {
    const vm = composeVoteConsequenceViewModel({
      payload: payload({ direct: [node()], explicitCausalEdgeCount: 1 }),
    });
    expect(vm.disclaimer).toBe(VOTE_CONSEQUENCE_DISCLAIMER);
    expect(vm.disclaimer).toContain('並不等於由投票直接造成');
  });
});

describe('AC#3 — every row states the provenance it rests on', () => {
  it('words each basis as what it actually is', () => {
    expect(basisText('vote_idempotency_key')).toContain('投票識別碼');
    expect(basisText('canon_caused_by')).toContain('Canon 明確記錄的因果關聯');
    expect(basisText('director_plan_context')).toContain('不代表因果');
  });

  it('degrades a basis this build has not heard of to a generic sentence', () => {
    // A server that grows a new basis must not render the raw code at a viewer.
    expect(basisText('something_new')).toBe(GENERIC_BASIS_TEXT);
  });

  it('labels every rendered row', () => {
    const vm = composeVoteConsequenceViewModel({
      payload: payload({ direct: [node()], explicitCausalEdgeCount: 1 }),
    });
    const rows = vm.sections.flatMap((section) => section.items);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((item) => item.basisLabel.startsWith('依據:'))).toBe(true);
  });
});

describe('a withheld summary never renders as a blank row (FR-P004 / ART-132)', () => {
  it('states the refusal instead of the text', () => {
    const vm = composeVoteConsequenceViewModel({
      payload: payload({
        direct: [node({ publicSummary: null, publicationStatus: 'withheld' })],
        explicitCausalEdgeCount: 1,
      }),
    });
    expect(sectionOf(vm, 'direct').items[0].summary).toBe('(這段敘述目前不予公開)');
  });

  it('falls back to a stated absence when there is simply no summary', () => {
    const vm = composeVoteConsequenceViewModel({
      payload: payload({ direct: [node({ publicSummary: null })], explicitCausalEdgeCount: 1 }),
    });
    expect(sectionOf(vm, 'direct').items[0].summary).toBe('(無摘要)');
  });
});
