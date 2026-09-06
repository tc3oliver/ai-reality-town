---
id: ART-156
title: >-
  Pre-generation safety policy screens English phrases against a Traditional
  Chinese world
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 02:40'
updated_date: '2026-09-06 03:19'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-62 re-audit finding H-4 (Still Open, partial fix). ART-103 gave `assertPreGenerationSafe` real callers, so the gate is no longer dead code, but what it screens does not match what the system generates. `convex/safety/preGeneration.ts:61-83` is sixteen English phrase regexes (for example `/\bexplicit sexual content\b/u`) and `normalizeForSafety` lowercases with `toLocaleLowerCase("en-US")`, while `convex/llm/openAICompatible.ts:110` instructs the model to write in Traditional Chinese. Word-boundary `\b` does not fire between CJK characters, so the two paths that are nominally covered are covered in name only. Three further gaps found in the same pass: `embed()` has no gate at all and ships character memories and private knowledge straight to the provider; the gate sits in the adapter rather than in the port, so a second adapter inherits nothing; and `jsonSchema.description`, `tools[].function.description` and `body.user` reach the provider unscreened. The coverage test uses `readFileSync` plus `toContain`, which passes for code that is never executed. See docs/security-audit-art-62.md section 0.2 for the full egress inventory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The policy screens the language the system actually generates, demonstrated by a test whose inputs are Traditional Chinese rather than English
- [x] #2 Every provider egress path listed in the audit inventory — including embed() and the free-text fields on the request body — either passes through the gate or has a recorded, argued reason not to
- [x] #3 The gate is enforced at the provider port rather than in one adapter, so a new adapter cannot silently bypass it
- [x] #4 Coverage is proved by executing the gated paths, not by asserting on file text
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Establish that the gate cannot fire, not merely that it is called: `\b` never occurs between two Han characters, and every prompt instructs the model to write Traditional Chinese.
2. Split the rules into EN and ZH sets. Write the Chinese patterns WITHOUT `\b`, with narrower proximity windows because Chinese is denser per character. Screen both sets against every field rather than guessing a language — mixed script is the normal case here.
3. Gate `embed()`, the path that ships character memories and private knowledge verbatim.
4. Screen the assembled request body at the adapter transport, walking the structure rather than naming fields, so the three side channels the audit listed and anything added later are covered together.
5. Exempt `PRE_GENERATION_PROVIDER_CONSTRAINT` by exact identity — it names what it prohibits and would otherwise block every request — and test that a near-copy is not exempted.
6. Replace file-text coverage with execution: drive the real adapter against a fetch spy and assert no network call happened.
7. Fault-inject removal of the Chinese rules and require the language tests to turn red.

AC#3 (enforce at the PORT, not one adapter) is deliberately left for a follow-up; see notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented 2026-09-06

`RULES` is now `[...EN_RULES, ...ZH_RULES]`, screened together against every field. One list rather than a per-language guess: mixed script is the normal case (an English system instruction wrapping a Chinese narrative prompt), and a "detect the language, then pick a rule set" design would have reopened the gap.

Two things about the finding worth correcting rather than repeating: `toLocaleLowerCase("en-US")` was named in the audit but is a NO-OP for Han characters — it was never the cause. The cause was `\b`, which cannot occur between two Han characters, so every rule was structurally unable to match Chinese. Fixing the lowercase instead would have left the defect in place. Separately, NFKC folding turned out to be load-bearing for the identification-number rule, because a full-width number is the same personal datum as a half-width one.

`embed()` is gated. It was ungated and it is not the lesser exposure — it ships character memories and private knowledge verbatim, where `structuredChat` at least sends an assembled prompt.

The three side channels are covered by walking the assembled request body at `request()`, the only line in the adapter that reaches the network, rather than by naming fields. A list of three field names would have closed exactly the three the audit happened to find. One exemption, matched by EXACT IDENTITY against the frozen constant: `PRE_GENERATION_PROVIDER_CONSTRAINT` names the things it prohibits, so screening it would have made the gate refuse every request in the system the moment the body scan was introduced. A test asserts a near-copy is not exempted.

### AC#3 NOT met, and not claimed

The gate is at the adapters transport chokepoint, not at the provider port. A new METHOD on this adapter cannot bypass it; a new ADAPTER CLASS would have its own transport and inherit nothing. Enforcing at the port needs a wrapper applied at construction, and the only construction site today (`providers/actions.ts`) is the capability probe — so where production generation actually obtains its provider was not traced in this pass, and a wrapper placed without that answer would be decoration. Left open rather than checked.

### Verification

- New suite `convex/safety/preGenerationLanguage.test.ts`: 25 tests, all executing the gate. The previous coverage used `readFileSync` + `toContain`, which passes for code that never runs and — worse here — for a call whose rules cannot match.
- The adapter tests drive the real class against a `fetch` spy and assert **no network call occurred**, which is the only thing that actually matters.
- Both directions: eight prohibited samples blocked with the right category, four ordinary Mistwood sentences allowed. A gate that blocks everything would stall the world silently rather than visibly.
- FAULT INJECTION: removing `ZH_RULES` turns 18 of 25 red.
- `npm run check` green: 205 suites, 3328 passed, 6 skipped.

### Scope of the claim

This is a deterministic keyword gate on text THIS SYSTEM assembles from its own world state — not a classifier, and it does not claim to resist a human trying to evade it. Viewer-supplied text has its own control (`safety/viewerInput.ts`) and generated output has a post-generation classifier. Recording that boundary matters: "keyword-based" is a fair criticism of a control that must resist evasion and an irrelevant one for a control that need not.

## AC#3 completed 2026-09-06

Traced the question the earlier pass left open: `OpenAICompatibleProvider` is constructed in exactly ONE place, `providers/actions.ts`, and that place is the capability probe. Production simulation paths (`worldDayLive.ts`, `workflow.ts`) bind Fake providers today. So the port-level gate is future-proofing rather than a live hole — which is worth saying plainly instead of implying it closed an active exposure.

`providers/safeProvider.ts` adds `withPreGenerationSafety` (wraps any `LanguageModelProvider`) and `createLanguageModelProvider` (the only sanctioned way to obtain one). A wrapper rather than a base class or an interface rule: an interface vanishes at runtime and can compel an adapter to HAVE a method, never to do anything before that method`s first statement. A decorator applied at construction makes "the provider you were handed is gated" a property of the value.

The criterion is worded about a provider nobody has written yet, so it is tested against a HAND-ROLLED ungated adapter: the wrapper stops prohibited text and the inner adapter records that it never received it. Plus the reverse (ordinary text passes through unchanged), plus an assertion that the returned value exposes ONLY the port surface — a value still carrying the concrete adapter`s methods would let a caller reach around the gate.

The adapter`s own transport gate is kept, not replaced. The two sit at different altitudes and neither subsumes the other: the port sees the caller`s semantic input, `request()` sees the assembled body where the schema/tool/user side channels live.

One detail that would have been silent if wrong: the wrapper methods are `async`. A plain function that throws before returning a promise is a different contract from the adapter it stands in for, and every caller`s `.catch` would break at exactly the moment the gate fires. Caught by the tests, not by reading.

Verification: `npm run check` green, 206 suites / 3334 passed / 6 skipped (was 205/3328 before this slice — delta is exactly the 6 new tests).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The pre-generation safety gate now screens the language this system actually generates, covers every provider egress path, and is enforced at the port.

The defect was not the one the audit named. `toLocaleLowerCase("en-US")` is a no-op for Han characters and was never the cause; the cause was `\b`, which cannot occur between two Han characters, so all sixteen rules were structurally unable to match the Traditional Chinese every prompt instructs the model to produce. The gate ran on every request, matched nothing it could match, and returned allow. Fixing the lowercase would have left that in place.

Added a Chinese rule set written without `\b`; gated `embed()`, the path that ships character memories and private knowledge verbatim; and replaced field-by-field screening with a walk over the assembled request body, so the three side channels the audit found and anything added later are covered together. One exemption, by exact identity against the frozen constant: the safety instruction names what it prohibits, so screening it would have made the gate refuse every request in the system.

AC#3 is met by a construction-time wrapper (`safeProvider.ts`) plus a source scan pinning the single construction site. Traced first: the real adapter is built in exactly one place, the capability probe, and production paths bind Fake providers — so this is future-proofing, not a live hole, and is described as such.

Verified by execution, not by file text. The previous coverage used `readFileSync` + `toContain`, which passes for code that never runs and, worse here, for a call whose rules cannot match. The adapter tests drive the real class against a fetch spy and assert no network call occurred; AC#3 is tested against a hand-rolled ungated adapter. Fault injection: removing the Chinese rules turns 18 of 25 red. `npm run check` green at 206 suites / 3334 passed / 6 skipped.
<!-- SECTION:FINAL_SUMMARY:END -->
