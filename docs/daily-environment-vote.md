# Daily Environment Vote — Design Note (ART-45)

- **Requirement IDs:** FR-J001 (PRD 1.0 §12 Epic J, §5.1 G11, UX-005, §19.1, RISK-002)
- **Related:** FR-L003 / ART-56 (viewer-input classifier), FR-D004 / ART-15 (Canon validation),
  FR-O009 / ART-128 (public read-only guarantee)
- **Status:** implemented (PR #204)

## 1. What ships

A viewer can vote, once per device per day, for one of 3–4 sanctioned environment events. When
the round closes, exactly one candidate wins and is injected as a **Proposed** World Event that
faces the ordinary structural and Canon validation. Winning changes the weather, the power or the
road — never a character, an action or an ending.

| Piece | File |
|---|---|
| The seven acceptable candidates, as data | `convex/shared/environmentVoteCatalog.ts` |
| Candidate safety/Canon checks, rate limit, cutoff, winner | `convex/viewer/environmentVote.ts` |
| Convex wiring: one anonymous read, one viewer write, one cron | `convex/viewer/environmentVoteFunctions.ts` |
| Tables (`environmentVoteRounds` / `Ballots` / `Interventions`) | `convex/viewer/schema.ts` |
| Winner → Proposed World Event, and the Canon commit | `convex/simulation/worldDayLive.ts`, `convex/simulation/worldDayLiveFunctions.ts` |
| Ballot render model, device token, the one write hook | `src/components/vote/` |
| Boundary policy for the write gate | `architecture/module-boundaries.json`, `scripts/architecture/check-boundaries.mjs` |

## 2. The decision this task turned on

**Every other public surface in this product is read-only, and that is machine-enforced.** Before
ART-45, `scripts/architecture/check-boundaries.mjs` rejected *any* public mutation that was not
operator-gated, `readOnlyClientBoundary` forbade `useMutation` anywhere under `src`, and
`convex/publicRead/publicReadOnlyGuarantee.test.ts` asserted that the shipped bundle named exactly
one Convex function and that it was a query.

FR-J001 requires a viewer write. So one of the two had to give.

### What the PRDs actually say

They are more precise than the enforcement prose was:

- PRD 2.0 §22.16 — 「公開**觀看**不執行任何成功 Mutation」 (public **viewing** performs no
  successful mutation).
- FR-O009 — 「`/live` 未登入也只能執行 read query」. Scoped to `/live`.
- RISK2-002 — 「公開**觀看**意外啟動模擬」.
- PRD 1.0 §5.1 G11, FR-J001, and §16.1's 投票參與率 ≥ 10% metric — which is unachievable if an
  anonymous viewer may never write.
- PRD 2.0 §13 — ART-45 is 「Carry Forward；保留既有優先級」. PRD 2.0 does not retract Epic J.

Read together, the guarantee is about **viewing**. ART-128 implemented it as a repository-wide
ban because at the time there was no intended viewer write, and a blanket ban was the strongest
available proxy. FR-J001 is the case the proxy was never able to express.

### The decision

**The guarantee is now proven per surface rather than repository-wide, and the enforcement around
the one exception is stricter than what it replaced.**

Concretely:

- `publicFunctionSurface` gains a third gate, `viewer`. `anonymous` still means **read only** —
  `validatePolicy` rejects an anonymous mutation exactly as before.
- A `viewer` gate is not sufficient on its own. The function must ALSO appear in the new
  `viewerWriteBoundary.allowed`. Opening a viewer write costs two declarations in two places.
- `viewerWriteBoundary` additionally requires that a viewer write **lives under `convex/viewer`**,
  that there is **at most one** (`maxViewerMutations: 1`), that it is **never an action**, that
  the module **names the safety classifier and the rate limiter**, and that it **names no
  Canon-write symbol**.
- On the client, `readOnlyClientBoundary` still forbids `useMutation` in every file under `src`.
  Exactly one exemption exists, for one file and one symbol — and a new rule makes it impossible
  to grant such an exemption anywhere except `src/components/vote`. `/live`, the world renderer,
  every public page and the app shell are covered by the same check they always were.

### The alternative that was rejected

**Ship the domain server-side with no intake, and leave the homepage saying 「投票尚未開放」.**

It would have kept the blanket ban intact and produced a green build. It was rejected because
every acceptance criterion would then have been settled by code with no production caller — the
exact defect `docs/prd-1.0-closure-matrix.md` already records against FR-L003, whose classifier
has been "latent" since ART-56 precisely because ART-45 was deferred. A second latent layer
stacked on the first is not a delivered requirement.

A second alternative — free-text vote submission passed through `classifyViewerInput` — was
rejected for a different reason. The classifier is a filter over an unbounded input space; a
catalog is a bounded one. Where a closed set of choices satisfies the requirement, the closed set
is the stronger control, and the classifier is kept as defence in depth over the catalog itself.

### What this changes about the release gate

PRD 2.0 §22.16 and §18.1's 「Public Viewer 成功 Mutation | 0」 must now be read as the *viewing*
metrics they are titled as. `e2e/dynamicView.spec.ts` continues to assert zero writes from `/live`
through two independent mechanisms, and `readOnlyWorldSurface.test.ts` now proves per-surface
that nothing outside `src/components/vote` can name a write API. **ART-138 should record the
number as "zero from viewing; one deliberate ballot exists" rather than "zero anywhere",** which
is a change to how the gate is reported and is called out here so it is not discovered during the
gate run.

## 3. How a vote cannot become a world fact

The chain is deliberately broken in the middle.

```
viewer → submitEnvironmentVote → environmentVoteBallots (a catalog id + a device digest)
       → tickEnvironmentVoteRounds → environmentVoteInterventions (a catalog id + a target day)
       ──────────────── the viewer module ends here ────────────────
       → simulation reads the queue rows → buildViewerVoteProposal() builds the event
                                            from repository source
       → validateEventStructure → validateCanon → commitProposedEvent
```

Four independent facts make "a viewer cannot author a world fact" structural rather than
aspirational:

1. **A viewer submits an id, never text.** The sentence that reaches Canon is written in
   `environmentVoteCatalog.ts` and was reviewed like any other source file.
2. **`viewer` may not depend on `canon`.** Enforced by the module graph, so the ballot has no
   import path to the commit pipeline, and `viewerWriteBoundary.forbiddenSymbols` catches the
   other spelling where it grows its own writer.
3. **`simulation` may not depend on `viewer`.** The queue's contract is the table; each side owns
   one end. The world never consults a ballot while it plans.
4. **`proposedBy` is `system`.** The world proposes; the vote only chose which sanctioned option.

## 4. Abuse resistance

`deviceKey` is a random token the browser mints and stores; it is **not** a fingerprint and not an
identity. Clearing site data produces a new one. That is stated rather than papered over, and it
is why the token is not the only control:

| Control | Value | Why |
|---|---|---|
| Accepted votes per device per round | 1 | FR-J001 AC#2 |
| Submissions per device per round, refused ones included | 5 | A caller probing with junk ids pays what a voter pays, so the endpoint is not a free oracle |
| Submissions per round, total | 100,000 | One row per (round, device), so key rotation buys rows out of a fixed budget |
| Candidate space | closed | The worst a forged submission achieves is a vote for something already sanctioned |
| Untrusted text | classified | `classifyViewerInput` runs **before** the id is compared, so a payload never reaches a path that could log it |

An exhausted device writes **nothing at all** — past the budget the surface stops being a way to
create rows. Refusals carry a stable code and never echo the submission.

An IP-derived key was rejected: a shared NAT disenfranchises a building, a rotating residential
proxy defeats it anyway, and it would add a personal-data field §15 minimisation would then have
to carry. The device digest stored in `environmentVoteBallots` is a 64-bit non-cryptographic
fingerprint — 64 bits for **correctness**, not secrecy, because a 32-bit digest collides across a
full round with near-certainty and a collision silently refuses an honest viewer.

## 5. Acceptance criteria evidence

| AC | Claim | Evidence |
|---|---|---|
| #1 | 候選事件通過安全與 Canon 檢查 | `environmentVote.test.ts` → *every catalog entry passes the FR-L003 viewer-input policy*; *a candidate carrying a prompt injection is refused before it can be offered*; *a candidate that names a character outcome is refused as non-environmental*; the cron refuses to open a round whose slate fails |
| #2 | 每個裝置每日投票次數受限 | `environmentVote.test.ts` → *a second vote from the same device is refused*; *refused attempts consume the budget*; *an exhausted device is refused before its submission is even looked at*; *a malformed device key is refused rather than trusted*; `voteDeviceKey.test.ts` → *the client pattern is byte-identical to the server one* |
| #3 | 投票截止後只有一項勝出 | `environmentVote.test.ts` → *the leader wins, and exactly one candidate is returned*; *a tie is broken deterministically by ballot order*; *a round nobody voted in elects nobody*; *a ballot for something not on this slate is ignored* |
| #4 | 勝出事件作為 Proposed World Event 注入 | `environmentVoteInjection.test.ts` → *committing it through the real pipeline changes the world environment*; *re-running the same closed round commits one event, not two*; *the accepted event is attributable to the vote without a side table* |
| #5 | 勝出不代表指定後續結果 | `environmentVoteInjection.test.ts` → *a winning event is still refused when it violates an immutable world rule*; *the proposal names no character*; `environmentVote.test.ts` → *no catalog entry can express an outcome*; `environmentVoteModel.test.ts` pins the ballot's own UX-005 disclaimer |
| #6 | Tests cover rejection and failure paths | Every refusal branch above, plus `check-boundaries.test.mjs` → the seven viewer-write-gate tests, and `publicReadOnlyGuarantee.test.ts` → *the declared viewer write is exactly one bounded ballot* |
| #7 | PRD traceability | `docs/prd-1.0-closure-matrix.md`, `docs/prd-2.0-requirement-matrix.md`, this note |

## 6. Non-goals

- **FR-J002 vote-consequence tracking (ART-46).** The attribution this task lays down — the
  `vote:` idempotency-key prefix that survives into accepted Canon, and the recorded
  `appliedEventId` — is what ART-46 will read. Presenting causality is its job, not this one's.
- **Analytics for `vote_viewed` / `vote_submitted` (§17, FR-Q007 / ART-47).** Not emitted here;
  §18.1's participation metric stays 「未量測」 until ART-47 lands.
- **Authenticated voting.** FR-J001 says 「每個裝置」, and ART-71 owns authenticated viewers.
- **Operator control over a round.** No console command opens, closes or overrides a ballot. The
  cron and the cutoff decide, and a hand-picked winner is exactly what a stated tie-break rule is
  there to prevent.
