# Episode-derived share formats (FR-G005)

Four pieces of outreach copy derived from one accepted Daily Episode: **地方新聞**, **社群短文**,
**分享卡文案**, and **明日預告**.

Owning task: ART-36. Requirement: PRD 1.0 §Epic G, FR-G005 (`backlog/docs/prd/ai-reality-town-prd-1.0/doc-1`).

---

## 1. What this is, and what it is not

It is a **reframing** of content that has already been accepted, assembled and gated. Every
character of substance is quoted from a `DailyEpisode` that was built solely from Accepted Events
(FR-G001), checked for secret leakage by `validateDailyEpisode`, and classified by the ART-52
post-generation gate. The only words this feature contributes are the four zh-Hant labels and the
connective punctuation between them.

It is **not** a generator. No provider is called, no text is invented, and nothing it produces can
become Canon.

| File | Role |
|---|---|
| `convex/editorial/derived/shareFormats.ts` | The pure derivation, validation and release gate. No Convex imports, no clock, no randomness. |
| `convex/editorial/shareFormatFunctions.ts` | Convex wiring: reads the Episode and the day's accepted events, applies the gate, records the result. |
| `convex/operations/postCommitLive.ts` | Calls it from post-commit stage 19 (`publication`), after the Episode's own publication record exists. |

---

## 2. AC#1 — derived content produces no new Canon

Enforced by the **build**, not by review.

`architecture/module-boundaries.json` declares a module `derivedContent` whose only root is
`convex/editorial/derived`, and lists it in `canonWriteBoundary.forbiddenModules`. Two consequences:

1. `npm run check:architecture` **fails** if any file under that root so much as *names* a Convex
   write registration, a `ctx.db` write call, the accepted-event table, or a commit entry point.
2. `derivedContent.mayDependOn` is `["safety", "shared"]`. It may not depend on `canon` at all, so
   it cannot import the accepted-event model, let alone a writer.

The module's input type (`ShareSourceEpisode`) is declared structurally rather than by importing
`DailyEpisode`, which is what keeps rule 2 satisfiable: a `DailyEpisode` matches it by shape, so the
wiring passes one through with no adapter, and the derivation still cannot name a symbol from the
module that persists episodes. Every field of that type is `readonly`, arrays included, so editing
the Episode a share format reads is a compile error.

Two tests are companions to the build guarantee, and they fail for different reasons:

- `shareFormats.boundary.test.ts` — *"keeps the build-time guarantee wired up in policy"* fails if
  `derivedContent` is removed from the policy list. Without it, deleting one line of JSON would turn
  the enforcement off while `check:architecture` kept printing "valid".
- `shareFormats.test.ts` — *"leaves the accepted-event log byte-identical across a full
  derive-and-gate cycle"* runs the whole pipeline against a real `InMemoryCanonStore` and compares
  the log byte for byte. The boundary catches a **name**; this catches an **effect**.

---

## 3. AC#2 — derived content marks its source Episode

Every `EpisodeShareFormats` carries a required `sourceEpisode`:

```
{ worldId, worldDay, episodeNumber, contentRef: "episode:<worldId>:<worldDay>", sourceEventIds }
```

`contentRef` is the same string the FR-K004 publication lifecycle uses for the Episode, so an
operator holding a share format can find the Episode's publication record without a second
identifier scheme. `sourceEventIds` follows the repo's existing provenance idiom
(`RecapFormats.sourceEventIds`, `DailyEpisode.sourceEventIds`).

Each of the four formats **also** carries its own `sourceEventIds`:

- **地方新聞** quotes key scenes individually, so it carries exactly the events of the scenes that
  fit — and its headline line carries none, because the Episode builder does not record which event
  produced `headline` and attributing it to one would be a guess.
- The other three are built from the Episode envelope (`headline`, `oneLineSummary`,
  `nextEpisodeTease`, `newQuestions`), which the Episode builder derived from its whole ordered
  source set, so they carry the full list.

### The provenance check is not a tautology

`validateEpisodeShareFormats(formats, acceptedSourceEventIds, expectedEpisode)` must be given the
accepted set **read from the accepted-event log**, not taken off the Episode object the copy was
derived from. The wiring reads it by the `by_world_and_day` index for exactly this reason.

This is the failure ART-46 shipped and this file exists not to repeat, so it is pinned by a test
that would pass if the check were vacuous: `shareFormatFunctions.test.ts` — *"refuses copy whose
provenance the accepted-event log does not support"* — makes the stored Episode and the log
**disagree** and expects a refusal.

### Nothing is dropped silently

Length caps are per format (地方新聞 220, 社群短文 140, 分享卡文案 60, 明日預告 80 characters).
Anything a cap removed is reported in `omissions`, naming the format, the reason
(`length_cap` / `scene_not_covered`), the character count dropped, and **which accepted events**
are therefore absent.

Caps are counted in characters rather than 中文字, unlike FR-G003's recap bands. Those bands govern
text the pipeline *writes*; these govern text it *quotes*, and an Episode's `publicSummary` is
whatever the provider produced — a CJK-only count would let a 900-character Latin summary through a
"150 中文字" cap and overflow the card it was sized for.

The validator enforces the reporting: every accepted event the Episode cited must be either quoted
in 地方新聞 or named in an omission. Stated as coverage rather than by looking for a trailing
ellipsis, because a provider's summary can legitimately end in one and a rule that read that as
evidence of cutting would fail generation over punctuation.

---

## 4. AC#3 — inappropriate content is not published externally, automatically

### What "external" means here

**This deployment has no external publication transport.** There is no social API client, no
outbound webhook, and `publicFunctionSurface.forbiddenRegistrations` bans `httpAction` repo-wide, so
nothing can receive a push either. `docs/prd-1.0-closure-matrix.md` records the same finding against
PRD §6's non-goal ("Auto-posting unreviewed content to external social — Absent").

AC#3 is therefore **not** implemented as "we checked before sending", because there is nothing to
send with, and a test asserting that an empty set was never transmitted would prove nothing. It is
implemented as a **refusal at the publication-candidate boundary**, in three layers:

**1. The decision type has no released variant.** `decideShareRelease` returns
`blocked | manual_release_required` and nothing else. The best outcome available is copy an
administrator may take, by hand, after reading it. Adding an external transport later takes an edit
to that union — which is the point.

**2. The lifecycle refuses the automated actor.** Derived copy rides the FR-K004 publication
lifecycle as a first-class content kind, `episode_share`. The pipeline creates its record as the
`system` actor, and `publish` is administrator-only, so the pipeline that generates the copy throws
`PUBLICATION_UNAUTHORIZED` if it ever tries to publish it. Asserted against the shipped
`transitionPublication`, not against a restatement of its rules.

**3. Nothing on the pipeline can transmit.** `shareFormats.boundary.test.ts` sweeps every shipped
file that knows what a share format is — derived from the source tree, not listed, and asserted
non-empty so the sweep is not vacuous — plus the wiring's transitive import closure, for `fetch(`,
`httpAction`, `XMLHttpRequest`, `ConvexHttpClient`, `ctx.scheduler` and `runAction`. `ctx.scheduler`
is on that list because a deferred call is still a call.

### What blocks

The safety verdict is the **existing** one. `deriveGatedShareFormats` runs the ART-52
`classifyPostGeneration` classifier over the derived text and resolves it against any operator
override through FR-P004's `resolveEffectiveSafetyLabel`. This feature forms no opinion of its own
about whether text is safe; a second, disagreeing opinion is the failure mode a derived-content gate
is most likely to have.

| Reason code | Meaning |
|---|---|
| `SHARE_SOURCE_EPISODE_NOT_READY` | The Episode is `withheld`, `failed`, or not yet gated. Reframing withheld content as 地方新聞 would republish it under a different heading. |
| `SHARE_SAFETY_WITHHELD` | The effective label on the derived copy is `withhold` or `human_review_required`. |

The derived copy is classified under its **own** source id (`episode_share:<world>:<day>`), separate
from the Episode's, so an operator can withhold the share copy without touching the Episode's
classification — and vice versa. A `blocked` row deliberately stores **no** copy: refused text is
not kept where a later reader could mistake a row's existence for permission to use it.

---

## 5. Where it runs

Post-commit stage 19 (`publication`), immediately after the Episode's own publication record is
created — derived content is an output of an Episode that already passed the gate, never an input to
one. It is called **unconditionally**, including for a withheld day: the generator re-reads the
Episode row and refuses a non-`ready` one itself, so running it records the *refusal* where an
operator can see it. Skipping the call would leave the day silently absent from the derived table,
which reads identically to "not generated yet".

Idempotent per world day, matching how `generateAcceptedEventEpisode` deduplicates.

### Read budget

Four index-scoped reads, none of which grows with the world's history:

| Read | Index | Bound |
|---|---|---|
| Prior share row (dedup) | `episodeShareFormats.by_world_and_day` | One row |
| The source Episode | `dailyEpisodes.by_world_and_day` | One row |
| The day's accepted events | `canonEvents.by_world_and_day` | One world day — the same bound the Episode builder takes |
| Operator overrides for this copy | `safetyStatusOverrides.by_world_source_and_created` | One source id, bounded by human effort |

---

## 6. Known limits

- **地方新聞 can omit a scene entirely.** On a busy day with long summaries, the 220-character cap
  admits the headline and little else. The omission report names every event that did not fit, so
  the shortfall is visible rather than silent — but the copy is genuinely partial, and a reviewer
  should read `omissions` before using it.
- **The copy is operator-only.** No public read surface serves it. `getEpisodeShareFormats` is an
  `internalQuery`; adding a public one would trip the exhaustive `publicFunctionRef` pin in
  `convex/publicRead/publicReadOnlyGuarantee.test.ts` and is deliberately out of scope for FR-G005,
  which asks that the formats be *generated* and *not auto-published*.
- **Regeneration is not wired.** `regeneratePublication` accepts an `episode_share` record like any
  other, but nothing calls it for share content: a day's copy is derived once. Re-deriving after an
  Episode is corrected would be a follow-up.
