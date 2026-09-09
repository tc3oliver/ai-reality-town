---
id: ART-175
title: Stop publishing behaviour rules and fear on the public character surface
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 19:33'
updated_date: '2026-09-09 19:45'
labels:
  - prd-1.0
  - epic-i
dependencies: []
priority: high
ordinal: 174000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the ART-138 audit sweep for published payload fields no surface renders, then confirmed against the running deployment.

`CHARACTER_ALLOWED_FIELDS` (`convex/publicRead/worldCharacterProjection.ts`) is documented as "PRD §13.2 MINUS private fields", and it treats only `privateProfile`, `privateGoal`, `knowledge` and `memory` as private. §13.2 is the whole Character data model, not a public list. The public list is FR-I005, and it is exhaustive — 姓名與圖像, 年齡與職業, 公開背景, 目前狀態, 公開目標, 主要關係, 最近重大事件, 所屬 Arc, 觀眾已知秘密, 角色不知道但觀眾知道的資訊.

Two allowlisted fields are on neither list and are rendered by nothing:

- **`behaviorRules`** — model-steering instructions. The seeded value is `["Act only on known or reasonably inferred information.", "Protect the private goal unless pressure makes disclosure credible."]`. The second rule is prompt material AND tells any reader the character has a private goal they are concealing. FR-I005 forbids Prompt outright.
- **`fear`** (恐懼) — a character vulnerability, seeded beside `privateGoal` in `mistwoodSeed.ts`, and absent from FR-I005 public content.

Confirmed live with a bounded query: **all twelve current `character:<id>` read models carry `behaviorRules`**, with that text, served anonymously by `getPublishedReadModel`. `sanitizeForPublic` cannot help — its key patterns do not match either name — so the projection allowlist is the only guard, which is why narrowing it is the fix rather than adding a filter downstream.

Nothing renders either field: `behaviorRules` appears nowhere under `src/`, and `fear` is declared in `characterRoute.ts`s payload type and never mapped into the view model. Removing them costs no surface.

Out of scope: `personality` and `values`, which are also outside FR-I005s list but ARE rendered under 「特質」. Narrowing those is a product decision about what the page shows, not a privacy defect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The published character read model carries neither behaviour rules nor fear, and the projection refuses to read them from its source at all
- [ ] #2 A fault injection proves it: re-adding either field to the allowlist turns a named test red
- [ ] #3 The existing character page and character card render exactly what they rendered before
- [ ] #4 The reasoning is recorded where the allowlist is defined, so the next reader knows §13.2 is the data model and FR-I005 is the public list
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## How it was found, and how it was confirmed

Found by an ART-138 audit sweep for published payload fields that no `src/` module names — the same class of sweep that found ART-151's unrendered `currentLocationId`. Fifteen fields came back; thirteen were provenance or infrastructure. Two were not.

Confirmed against the running deployment rather than argued from the source: a bounded query over `publishedReadModels` showed **all twelve current `character:<id>` models carrying `behaviorRules`**, with the value `"Act only on known or reasonably inferred information., Protect the private goal unless pressure makes disclosure credible."` — served to anonymous clients by `getPublishedReadModel`.

## Why the allowlist had them

Its own docblock said "PRD §13.2 MINUS private fields". §13.2 is the whole Character record, public and private together, so subtracting the four obviously-private fields leaves everything nobody stopped to think about. FR-I005 is the public list and it is exhaustive. That framing is now corrected where the constant is defined, because the framing IS the defect — the two fields were a consequence of it.

## The line I did not cross

`personality` and `values` are also outside FR-I005's enumeration and are KEPT, because the page renders them under 「特質」. Removing them is a product decision about what the page shows; removing a field that is prompt material and is rendered by nothing is a privacy fix. Folding the two together would have made the change unreviewable, and the test says so in as many words.

## Evidence

Two injections, each turning three named tests red: re-adding `behaviorRules` to the allowlist and the payload, and re-adding `fear`. Both compile — a type error would have been `Tests: 0 total` and no evidence at all.

`npm run check` exit 0 — 4373 passed, 31 skipped, 251 suites. Four pinned lists had to move with it (`worldCharacterProjection.test.ts`, `rumorPublicBoundary.test.ts`'s exhaustive key set, the live-map card fixtures, and the E2E fixture's own header), which is the allowlist doing its job.
<!-- SECTION:NOTES:END -->
