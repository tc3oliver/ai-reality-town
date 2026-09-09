---
id: ART-153
title: Regenerate convex/_generated/api.d.ts and keep it from going stale
status: Done
assignee: []
created_date: '2026-08-29 05:42'
updated_date: '2026-09-09 14:30'
labels: []
dependencies: []
priority: medium
type: chore
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
convex/_generated/api.d.ts was last generated on 2026-08-10 and is missing every module added since, including publicRead/conversationState (ART-123) and publicRead/voteConsequenceProjection (ART-46). Nothing currently breaks because the architecture gate does not read it and internalFunctionRef resolves by string path, but the file is checked in and is now actively misleading to anyone who trusts it, and any future code that does use the generated api object will silently miss those modules. Regenerate it and add a check so a PR that adds a Convex module without regenerating fails rather than merging.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The generated API types include every Convex module present in the tree
- [x] #2 CI fails when the checked-in generated types do not match what regeneration would produce
- [x] #3 The check does not require a Convex deployment or network access to run
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
1. Measure the real drift rather than trusting the task text.
2. Establish whether `convex codegen` can run offline — it cannot; it downloads deployment state and uploads functions, which AC#3 forbids.
3. Reimplement the CLI's entryPoints() skip rules narrowly, from its own source, and pin each rule so a wrong copy fails legibly.
4. Share one definition between the writer (--write) and the checker, so regeneration and verification cannot disagree.
5. Fault-inject against the real file; strengthen the checker wherever an injection does not bite.
6. Wire check:generated-api + test:generated-api into the gate; document the regeneration command in CLAUDE.md §7.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
convex/_generated/api.d.ts was generated 2026-08-10, was missing 37 modules and still declared one that had been deleted. Nothing broke, which is the problem: the architecture gate does not read it and every reference resolves by string path, so it is a checked-in file with no consumer that would fail when wrong. AC#3 forbids a check needing a deployment, and npx convex codegen needs one — it downloads deployment state and uploads functions — so the module enumeration is reimplemented from the CLI's own entryPoints(), narrowly, with each skip rule pinned. Two of those rules explained nearly every apparent anomaly: schema.ts is skipped at ANY depth, and a basename with more than one dot is skipped, which excludes every *.test.ts and auth.config.ts. TWO INJECTIONS DID NOT BITE and the checker was wrong: the file states its module list twice and only the imports were parsed, so a stale fullApi entry and a reordered fullApi block both passed. It now reads both halves and requires them to agree with the tree and each other. Verified: 6 injections turning the check red, one deliberate negative (adding a *.test.ts must NOT require regeneration), 18 node:test cases; npm run check exit 0 (4273 passed, 248 suites); npm run e2e 114 passed. The check earned its keep inside its own PR, refusing the branch by name when merging main brought ART-71's new module in. PR #262.
<!-- SECTION:FINAL_SUMMARY:END -->
