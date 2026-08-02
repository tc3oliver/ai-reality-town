# Post-generation safety classification

ART-55 implements PRD FR-L002 for generated scenes and public artifacts.

Every candidate receives one versioned label: `allow`, `allow_with_warning`, `withhold`,
or `human_review_required`. High-risk content is withheld, personal-data or real-person
ambiguity requires review, and non-graphic sensitive material may publish with a warning.
Block/review reason codes are stable and queryable through internal operations APIs; raw
unsafe text is not persisted in the safety record.

Publication fails closed: only allow labels invoke the publication callback. A classifier
failure becomes `human_review_required` and cannot publish. The safety module imports no
Canon commit or reducer boundary, so classification failure cannot modify accepted history.

A sanitized public summary may remove excessive detail only when it retains the identical
ordered Accepted Event/core Fact ID list. This proves fidelity without requiring unsafe
wording to remain public.

Focused verification:

```bash
npm test -- --runTestsByPath convex/safety/postGeneration.test.ts
```
