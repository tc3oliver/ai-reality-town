---
id: ART-62
title: Server-side authorization and release security audit
status: Done
assignee:
  - '@agent-art62'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 10:32'
labels:
  - prd-1.0
  - epic-q
milestone: m-0
dependencies:
  - ART-40
  - ART-48
  - ART-49
  - ART-51
  - ART-53
  - ART-56
  - ART-57
  - ART-72
  - ART-84
  - ART-85
  - ART-95
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-005, Public Test AC 20–23

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Audit every administrative/public boundary, secret/log handling, viewer input, license/attribution, Critical/High findings, and safeguards preventing production deployment.

Scope
Audit every administrative/public boundary, secret/log handling, viewer input, license/attribution, Critical/High findings, and safeguards preventing production deployment.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-40, ART-48, ART-49, ART-51, ART-53, ART-56, ART-57, ART-72, ART-84, ART-85, ART-95, ART-96

Schema Impact
No product domain schema; owns release checklist, audit findings, traceability, and verification evidence.

API Impact
Read-only audit/verification access to completed public and administrative boundaries.

Security Impact
Release remains blocked by missing evidence, unresolved Critical/High findings, or enabled production deployment.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Repeatable security checks and manual evidence cover all privileged routes and data classes.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every public API and administrative mutation route has server-side authorization evidence.
- [ ] #2 Public/private data, trace/log redaction, viewer input, publication, and emergency-control boundaries are audited.
- [ ] #3 No unresolved Critical or High security finding remains before public test.
- [ ] #4 License/attribution is retained and production deployment remains disabled.
- [ ] #5 Audit evidence identifies tested routes, roles, data classes, findings, and remediation.
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recon: map all Convex public queries/mutations/actions, all admin/ops mutations, all trace/log write paths, and every viewer-input entry point. Build a route x role x data-class inventory.
2. Public read boundary audit: read convex/publicRead/* (sanitizeForPublic + every rebuild*Projection), independently trace whether a forbidden/private field can reach a public projection. Attack angles: unsanitized passthrough, nested objects, spread operators, arrays of records, spoiler-mode leakage, unpublished/draft content, private memory/knowledge, LLM trace/prompt text, provider metadata.
3. Admin/ops boundary audit: read convex/operations/operatorAuthorization.ts and every operations/*Functions.ts + simulation/*Operations.ts. Verify EVERY privileged mutation is actually wrapped by the role gate (viewer<operator<admin). Independently assess the shared ops-token fallback (timing safety, argument logging, replay, role escalation) rather than trusting the prior self-assessment. Check for unauthenticated internal* vs public mutation exposure.
4. Secret/log handling audit: read convex/observability/trace.ts + traces.ts + observability/model.ts and convex/safety/*. Verify API keys/base URLs/auth headers/ops token cannot reach a trace record, console log, error message, or any public read path. Check provider client code (simulation/providers/*) for key leakage into thrown errors.
5. Viewer input audit: read convex/safety/viewerInput.ts and search for real call sites. If the classifier has zero production callers, record it as an explicit finding (unenforced control), not a pass.
6. Untrusted content -> provider/publication audit: verify LLM-proposed content cannot bypass pre/post-generation safety on its way to a published episode or back into a provider prompt (prompt injection surface).
7. License/attribution audit: package.json, LICENSE, ATTRIBUTION.md, docs/upstream.md, docs/open-source.md vs upstream AI Town; verify dependency licenses.
8. Production-deployment safeguard audit: look for an ACTUAL technical block (env guard, deploy config, CI gate) not just prose in README/vercel.json/fly/Dockerfile/scripts. If only prose exists, record the finding and recommend a scoped follow-up task rather than silently building a deploy blocker.
9. Write docs/security-audit-art-62.md: route/role/data-class inventory + every finding rated Critical/High/Medium/Low/Info with what-was-checked, what-was-found, exact file:line evidence, and fix-or-defer decision.
10. Fix only small/safe in-scope defects; record everything else as an explicit unresolved finding with a recommended follow-up task.
11. npm run check green; update PRD traceability + docs; HONEST AC/DoD checkboxes -- if any Critical/High finding is unresolved, AC#3 stays unchecked and release is reported NOT clear.
12. Commit (conventional prefix, no AI co-author trailer), merge origin/main, re-run npm run check, push, gh pr create, gh pr merge --auto, flip to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Audit executed (ART-62)

Adversarial source review of every client-reachable Convex route, the admin boundary, secret/log handling, viewer input, license/attribution, and deploy safeguards. Full report: docs/security-audit-art-62.md.

Method note: the primary technique was enumerating the ACTUAL client-reachable surface rather than trusting module docstrings. In Convex, query/mutation/action are anonymously reachable; internalQuery/internalMutation/internalAction are not. Several modules carried docstrings asserting a property the code did not have; those are recorded as findings rather than accepted.

### Findings: 2 Critical, 6 High, 7 Medium, 9 Low/Info

FIXED IN THIS TASK (6):
- C-1 (Critical) convex/canon/commit.ts:219 - validateAndCommitProposedEvent was a PUBLIC unauthenticated mutation appending to the append-only canonical event log. Zero auth in the file; proposedBy is caller-supplied so provenance was forgeable. Had ZERO callers repo-wide, so converting to internalMutation is regression-free.
- C-2 (Critical) CC-licensed art credits (OpenGameArt/George Bailey/hilau/ansimuz, itch.io/Mounir Tohami) were deleted by rebrand commit 7744d88 while the credited files still ship; ATTRIBUTION.md:24-28 and docs/upstream.md:127-128 then affirmatively relicensed 'all assets' as MIT, a grant a16z never held. Verified against upstream-baseline-20260802 tag. Fixed: added ASSETS-LICENSE.md restoring credits verbatim, corrected ATTRIBUTION.md/docs/upstream.md/README.md.
- H-6 (High) convex/simulation/workflow.ts:126 - runFoundationSimulation was a public unauthenticated mutation inserting rows and committing canon. Zero callers; converted to internalMutation.
- H-3 (High) convex/util/llm.ts:144,178 - console.log(body) logged the full prompt (character memories, private knowledge) and console.log(content) logged raw model output, on the LIVE agent path (agent/conversation.ts, agent/memory.ts). Replaced with bounded metadata. Note the API key was NOT leaking: AuthHeaders() is built separately from body.
- H-2 (High, partly) convex/testing.ts:85 - resume had NO guard while stop was gated on STOP_NOT_ALLOWED. Added the matching guard.

UNRESOLVED CRITICAL/HIGH - RELEASE IS NOT CLEAR:
- H-1 (High) NO convex/auth.config.ts exists, so ctx.auth.getUserIdentity() always returns null and the identity branch of resolveOperatorPrincipal (operatorAuthorization.ts:259-264) is DEAD CODE. The shared ops token passed as a mutation argument is therefore the SOLE working admin credential, not a fallback. Convex logs function arguments, so the live admin secret is likely written to the function log on every privileged call - defeating NFR-005 despite the audit-row builder and ART-57 both being careful about secrets. This is MORE severe than ART-48's own self-assessment. (constantTimeEquals itself is correct; the weakness is architectural.)
- H-4 (High) convex/safety/preGeneration.ts - evaluatePreGenerationSafety/callWithPreGenerationSafety have ZERO production callers (only mistwoodSeed.test.ts). No preGenerationFunctions.ts exists. Nothing screens content before it reaches a provider. postGeneration IS properly wired, which makes the gap easy to miss.
- H-5 (High) FR-K006 emergency stop does not halt the upstream AI Town engine. assertWorldAdmitsSimulation is enforced at only 2 sites (worldDayLiveFunctions.ts:237, opsConsoleFunctions.ts:174); the upstream engine keeps generating via agent/conversation.ts, and crons.ts:16 restarts dead worlds every 60s regardless of emergency-stop state.
- D-1 (High pending maintainer verification) vercel.json is tracked and unguarded. Whether a Vercel project link exists is NOT determinable from the repo (configured server-side). If linked, every merge to main auto-deploys a public site with no server-side authz.

### Controls independently VERIFIED SOUND (tried to break, could not)
- All 17 privileged ops/review routes call requireOperator/requireReviewer as their FIRST statement before any ctx.db read - checked line by line, not inferred. Uniform OPS_UNAUTHORIZED denial is real across all 6 branches of authorizeOperator.
- ART-57 trace pipeline: strict key allowlist + isSensitiveTraceKey screening + internalMutation write boundary + publicLlmTrace is a 5-field Pick. Could not find a route to get raw content or a credential into a trace.
- publicRead: no raw Doc<> is spread into any public payload anywhere in convex/publicRead/ (checked every spread operator); projection builders filter on canon visibility === public|canon and use explicit field maps. The defence-in-depth pattern DOES hold. Caveat recorded as M-2: sanitizeForPublic is a key-name DENYLIST but is documented as an 'allowlist' in 3 places.
- No secrets committed; .gitignore covers .env variants.
- No deploy pipeline exists: both CI workflows terminate at npm run build with read-only tokens; package.json has zero 'convex deploy'.

### Scope judgements
- Did NOT add a hard production-deploy technical block. ART-62's Out of Scope excludes production deployment, and the safeguard would mean editing .claude/ control-plane files. Recommended as a separate task instead (see report section 6).
- Did NOT wire preGeneration/viewerInput to call sites - those are functional changes with behavioural consequences (rejection handling, retry/trace interaction) that belong in feature tasks, not an audit.
- Per task-finalization guidance, follow-up tasks are RECOMMENDED in the report, not created without approval.

### Limitations (stated so evidence is not over-read)
No live deployment exercised - all findings are source review. The H-1 'token reaches the log' claim follows from Convex's documented argument-logging behaviour and was NOT observed in a real log. No network access, so asset license versions were inferred from source URLs. node_modules not installed, so dependency scan was lockfile-only (~88% of entries declare no license). The authorize->act->audit wrapper bodies remain typecheck-only with no end-to-end unauthorized-caller test.

Reconciled to Done: implementation merged via PR #131/#134 (verified on origin/main). Status hygiene sync.
<!-- SECTION:NOTES:END -->
