---
id: ART-169
title: Publish viewer-known secrets and dramatic-irony facts on the character page
status: To Do
assignee: []
created_date: '2026-09-09 11:44'
labels:
  - prd-1.0
  - epic-i
dependencies: []
priority: medium
ordinal: 169000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FR-I005's last two public fields have no published source anywhere in the deployment, which is why ART-43 AC#1 could not be checked and why ART-151 delivered eight of ten fields rather than ten.

觀眾已知秘密: a secret becomes viewer-known when the event that reveals it is published. The knowledge ledger knows which secrets exist and convex/publicRead knows which events are published, but nothing joins them and no read model carries a secret's revealed status. The failure mode is publishing an UNREVEALED secret, which FR-I005's 不得公開 list forbids explicitly, so the projection must prove the revealing event is published before it names the secret.

角色不知道但觀眾知道的資訊: dramatic irony is the difference between what a viewer can see published and what a given character's knowledge ledger holds. Both halves exist; nothing computes the difference and it has never been published in any form.

See docs/public-character-page.md §4 for the assessment ART-151 recorded. Blocks ART-43 AC#1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A published read model carries, per character, the secrets a viewer already knows, each traceable to the published event that revealed it
- [ ] #2 A published read model carries, per character, the facts the viewer can see and the character's knowledge ledger does not hold
- [ ] #3 A fault injection proves an unrevealed secret cannot reach either payload: removing the published-event check turns a named test red
- [ ] #4 The character page renders both fields, and ART-43 AC#1 is then checked with evidence
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
