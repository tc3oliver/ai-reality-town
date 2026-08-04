# Narrative quality review — mistwood, 30 world days (baseline)

Scored against **`docs/narrative-quality-rubric.md` version 1.0** (ART-92, PRD Section 19.5).

## 1. Identification

| Field | Value |
| --- | --- |
| Review date | 2026-08-04 |
| Rubric version | 1.0 |
| Packet scored | [`2026-08-04-mistwood-30-day-packet.md`](./2026-08-04-mistwood-30-day-packet.md) |
| Run digest | `26a787b48038b1c986759b66b639539d` |
| Seed | world `mistwood`, fixture `mistwood-production-seed-v1`, provider model `fake-whole-scene-v1`, world days 0–29, 5 time slots/day |
| Sample | 12 scenes and 6 episodes over world days 0, 6, 12, 17, 23, 29 |
| Evaluators | `@agent-art92` (single evaluator) |
| Evaluation type | **Periodic / baseline** — not the two-evaluator release gate of rubric §6 |
| Verdict | **FAIL** |

Regenerate the exact scored text with `npm run narrative:review-packet`; the packet is
byte-reproducible from the seed, so this record can be re-verified.

> **Superseded run (ART-101, 2026-08-04).** This review scored run digest
> `26a787b48038b1c986759b66b639539d`, which no longer reproduces: ART-101 fixed the FR-C002
> defect that left five of the twelve residents out of every scene, so the same seed now
> yields 449 accepted events over 32 distinct scene texts (92.9% exact duplication) instead
> of 450 over 12 (97.3%). The scores and the FAIL verdict below are kept verbatim as the
> record of what was reviewed on this date. They remain a valid **lower bound** for the
> no-cost tier — duplication improved but is still dominated by the fake author's template
> space — and re-scoring against a real provider is ART-72's job, not a re-run of this
> baseline.

**Why the verdict is expected, and why it is still recorded.** No real language model is
connected yet: every scene in this run is authored by ART-4's deterministic fake
whole-scene provider, whose template space is twelve texts (ART-60 already measured 97.3%
exact duplication). A low narrative score is therefore a property of the no-cost tier, not
a regression, and this run is the **baseline a real provider (ART-72) must beat**. Rubric
§9 anticipates exactly this. The safety and spoiler gates are the dimensions this run can
meaningfully answer today, and both pass.

## 2. Scores

| ID | Dimension | Threshold | Score | Verdict |
| --- | --- | --- | --- | --- |
| D1 | Character consistency | 3 | **0** | fail |
| D2 | Action plausibility against known information | 3 | **1** | fail |
| D3 | Event causality | 3 | **0** | fail |
| D4 | Arc progression | 3 | **1** | fail |
| D5 | Arc pacing (absence of stalling) | 3 | **0** | fail |
| D6 | Dialogue and scene variety | 3 | **0** | fail |
| D7 | Summary fidelity | 3 | **2** | fail (borderline) |
| D8 | Safety interception (hard gate) | 4 | **4** | pass |
| D9 | Spoiler discipline (hard gate) | 4 | **4** | pass |

**Verdict: FAIL** under rubric §5 — six dimensions score 0 or 1. Both hard gates pass.

No total is computed, by design.

### D1 Character consistency — 0

Every one of the twelve sampled scenes gives every participant the identical line:
`"We settle this here, before it grows."` The seven characters who appear (`fang-yue`,
`shen-kai`, `he-jun`, `zhao-ming`, `gao-wenrui`, `pei-lan`, `qiu-an`) are fully
interchangeable — permuting the names would leave the sample unchanged. This is the
rubric's stated score-0 condition. Evidence: S1, S2, S3, S4, S5, S6, S11, S12.

### D2 Action plausibility against known information — 1

Nothing is *implausible*, because nothing is specific. The key-action vocabulary is four
content-free phrases — `presses for detail`, `weighs the request`, `holds back one fact`,
`offers a careful trade` — and none of them names the fact held back, the request weighed
or the trade offered. No action can be checked against what a character knows, which is a
different failure from an action that contradicts it, and it is the dominant impression of
the sample. Evidence: S1 vs S3 vs S5 (same pair, same scene, rotating verb); S12.

### D3 Event causality — 0

No sampled scene refers to any earlier scene. World day 29 (S11) is textually the same
scene as world day 0 (S1), at the same location, with the same pair, over the same matter.
Twenty-nine world days of accumulated Canon leave no trace in the prose. Evidence: S1 vs
S11; repetition exhibit (three text groups of 39 scenes each).

### D4 Arc progression — 1

The arc ledger moves — 18 arcs, 15 resolved — but the reader-visible question set does not.
Episode 1 (day 0) opens exactly three questions; every other sampled episode — 7 (day 6),
13 (day 12), 18 (day 17), 24 (day 23) — opens and resolves none; episode 30 (day 29)
resolves the same three questions in the same words they were posed in 29 days earlier. A
reader sees one beat at the start and one at the end, with nothing in between. Evidence:
Episode 1 "New questions" vs Episode 30 "Resolved questions"; Episodes 7, 13, 18, 24 (all
empty).

### D5 Arc pacing (absence of stalling) — 0

Of the six sampled world days, four (6, 12, 17, 23) could be deleted with no loss to a
reader: they open nothing, resolve nothing and repeat the same three scene texts.
Extrapolated across the run this is 28 of 30 removable days. ART-31's automated stagnation
detector reports **zero** stagnant arcs on this same run, which is exactly the gap this
dimension exists to cover: the arcs advance on the ledger and stall on the page. Evidence:
Episodes 7, 13, 18 and 24 all record `_none_` under both "New questions" and "Resolved
questions".

### D6 Dialogue and scene variety — 0

450 scenes collapse onto 12 distinct texts (97.3% exact duplication), and every sampled
dialogue line is the same sentence. Judged for *near*-duplication as the rubric asks, the
run is worse than the exact-duplicate number suggests: the twelve "distinct" texts differ
only in which content-free key-action verb was selected, so the effective variety a reader
perceives is close to three (one per location pair). Evidence: repetition exhibit; S1–S12.

### D7 Summary fidelity — 2

The episodes are not *false* — every claim traces to a scene, and ART-35 reports zero
FR-G004 coverage findings — but the structure creates impressions the scenes do not
support. Three problems, none of which any automated check owns:

1. `oneLineSummary` is the headline concatenated with itself and is not one line. Evidence:
   Episodes 1, 7, 13, 30.
2. Each of the five `keyScenes` entries concatenates two or three *unrelated* scenes from
   different locations into one "Key scene N", so a reader is told these events belong
   together when they do not. Evidence: Episode 1 key scenes 1–5.
3. Each episode lists ~20 undifferentiated `Relationship changed between X and Y` lines
   covering only three character pairs, with no direction or magnitude. A reader
   reasonably infers twenty relationship developments where there are at most three.
   Evidence: Episode 1 and Episode 7 relationship-change lists.

Scored 2 rather than lower because nothing asserted is untrue, and rather than 3 because
(2) and (3) actively mislead about scale and grouping.

### D8 Safety interception — 4 (hard gate: PASS)

Read as a publication reviewer, **no false negative was found**: nothing in the twelve
sampled scenes or six episodes is content this reviewer would have withheld. The packet's
automated signals agree and are complete — 450/450 scenes classified, 30/30 episodes
classified, 0 scenes withheld, 0 events bypassing safety, single label `allow`, single
policy version. Both the rubric's conditions for a 4 are met.

**Recorded caveat (F-05), not a threshold failure.** This corpus contains no content
anywhere near a policy boundary — the most charged material in the run is a municipal
budget dispute. The run therefore proves the safety channel is *wired and always invoked*;
it does not exercise the classifier's ability to *intercept*. Interception power is tested
by ART-54/55 against known-unsafe fixtures, and this dimension should be re-scored against
a real provider (ART-72), whose output can actually stray.

### D9 Spoiler discipline — 4 (hard gate: PASS)

Read as a first-time viewer, the sampled public text reveals no secret and supports no
confident inference of one. The seeded secrets concern matters that never surface: the
public prose contains only stated town matters, participant names and undirected
relationship-change notices. No private fact is named, quoted or implied.

**Recorded caveat (F-05, same finding).** The spoiler surface is trivially small because
the episodes carry so little information; a 4 here is weak evidence about a real provider's
behaviour and must be re-scored once ART-72 lands.

## 3. Findings

Per rubric §7, every finding is recorded here. **No Canon was read for edit, and none was
edited**: accepted events are append-only, and this review has no mechanism to change a
committed scene.

| ID | Dimensions | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| F-01 | D1, D6 | Uniform character voice: every character in every sampled scene speaks the identical sentence; names are interchangeable. | S1–S12 | Expected under the fake provider; re-score under ART-72. |
| F-02 | D3, D5 | No cross-day causality or pacing: day 29 is textually the same scene as day 0; ~28 of 30 days are removable without reader loss. | S1 vs S11; Episodes 7, 13 | Expected under the fake provider; re-score under ART-72. |
| F-03 | D4 | Arc ledger advances (18 arcs, 15 resolved) while the reader-visible question set is opened on day 0 and closed unchanged on day 29. | Episode 1 vs Episode 30 | Expected under the fake provider; re-score under ART-72. |
| F-04 | D7 | **Episode assembly defect, provider-independent.** `oneLineSummary` is the headline duplicated; `keyScenes` concatenate unrelated scenes under one heading; ~20 undifferentiated relationship-change lines cover 3 pairs. | Episodes 1, 7, 13, 30 | **New.** Not covered by ART-35 (which checks citation coverage, not prose structure). Recommended as follow-up work — see §5. |
| F-05 | D8, D9 | Safety and spoiler gates pass, but the corpus contains no content near a policy boundary, so interception power is unexercised by this run. | Whole packet; safety signals | Re-score against ART-72 output. |
| F-06 | cross-cutting | Character starvation confirmed from a reader's seat: only 7 of 12 seeded characters ever appear; 5 never take part in a committed scene. | Packet signals; every sampled scene | **Confirms** the known ART-60 finding. Already owned by **ART-99**; no duplicate task. |

## 4. Disagreements

None recorded: this was a single-evaluator periodic evaluation, so rubric §6's
disagreement procedure did not apply. A release-gate evaluation under ART-72 must use two
independent evaluators.

## 5. Recommendations (not created as tasks)

Per the Backlog task-finalization guide, follow-up tasks are not created without approval.
Recommended:

1. Re-run this rubric against the ART-72 provider adapter as soon as it lands, and treat
   this record as the baseline to beat on D1–D7.
2. Address **F-04** in the episode assembler (ART-33 scope): it is a genuine editorial
   defect that a real provider will not fix, because it is in how episodes are *built*, not
   in how scenes are *written*.
3. Leave **F-06** to ART-99; this review only confirms it.
