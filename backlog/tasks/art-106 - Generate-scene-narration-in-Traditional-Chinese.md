---
id: ART-106
title: Generate scene narration in Traditional Chinese
status: Done
assignee:
  - '@oliver'
created_date: '2026-08-04 14:45'
updated_date: '2026-08-04 14:50'
labels: []
dependencies: []
priority: high
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The whole-scene simulation prompt in convex/simulation/sceneSimulation.ts:184 (the sole real-LLM narration entrypoint, called by convex/simulation/worldDayLive.ts) has no output-language instruction, so the live LLM provider currently returns scene summaries, dialogue, and character memories in English. The PRD (backlog/docs/prd/ai-reality-town-prd-1.0/doc-1) specifies Recap lengths in Chinese-character counts (Quick 80-150, Standard 400-800, main content ~300 - see the FR-G003 section) and Section 17's 'no multi-language' non-goal means single-language-only, not English-by-default; Traditional Chinese is the implied target language throughout. Add an explicit output-language instruction (Traditional Chinese, zh-TW) to the system prompt(s) that reach a real provider: the whole-scene prompt in sceneSimulation.ts, and for consistency the dormant (zero-caller, confirmed via grep) proposeEvent prompt in convex/simulation/providers/openAICompatible.ts:96. Do not touch convex/simulation/providers/probes.ts (health-check probe only, not narration).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The system prompt passed to provider.structuredChat in sceneSimulation.ts explicitly instructs the model to write all narrative text (sceneSummary, keyActions, dialogueHighlights, memories, rumors, proposedEvents publicSummary, etc.) in Traditional Chinese
- [x] #2 The proposeEvent system prompt in openAICompatible.ts carries the same Traditional Chinese instruction for consistency, even though it currently has no caller
- [x] #3 Existing tests in convex/simulation/sceneSimulation.test.ts and related provider tests still pass, or are updated to reflect the new prompt content where they assert on exact prompt text
- [x] #4 npm run check passes
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add a Traditional Chinese output-language instruction to the system prompt in convex/simulation/sceneSimulation.ts:184 (the real narration entrypoint) and convex/simulation/providers/openAICompatible.ts:96 (proposeEvent, currently zero-caller but kept consistent). Do not touch providers/probes.ts. Check sceneSimulation.test.ts and any provider tests that assert exact system-prompt string content, update expectations to match. Verify npm run check passes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Real-provider smoke test (against the configured LLM at llm.shouri.app, temporary internalAction, removed after verification) confirms the Traditional Chinese instruction works end-to-end: sceneSummary/dialogueHighlights/keyActions/relationshipChanges/proposedEvents.publicSummary all returned in zh-TW, e.g. sceneSummary: '方越與沈凱在霧林廣場的清晨相遇，空氣中瀰漫著薄霧，氣氛寧靜祥和。' Field names/JSON structure stayed in English as instructed. Unrelated pre-existing bug discovered during this test (not caused by this change, out of scope): parseWholeSceneOutput in sceneSimulation.ts rejects the real provider's otherwise-valid JSON with SCENE_OUTPUT_INVALID 'unsupported schema version' - real-LLM scene parsing appears broken independent of language. Flagging to the user as a separate follow-up, not fixing here.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an explicit Traditional Chinese (zh-TW) output-language instruction to the two system prompts that reach a real LLM provider: the whole-scene narration prompt in sceneSimulation.ts (the sole live narration entrypoint) and the dormant proposeEvent prompt in openAICompatible.ts. Verified against the real configured provider (llm.shouri.app) via a temporary smoke test (removed after verification): scene summary, dialogue, actions, relationship changes, and proposed-event summaries all returned correctly in Traditional Chinese, with JSON structure/field names staying in English as instructed. npm run check passes (86 suites/1109 tests, typecheck/lint/build clean). Found and flagged (not fixed, out of this task's scope) a pre-existing bug: parseWholeSceneOutput rejects the real provider's valid JSON output with 'unsupported schema version', independent of language.
<!-- SECTION:FINAL_SUMMARY:END -->
