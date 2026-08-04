# Viewer input safety classification

ART-56 implements PRD FR-L003 and the NFR-005 rule that viewer input is untrusted. It is the
third safety layer alongside `docs/pre-generation-safety.md` (FR-L001, provider inputs) and
`docs/post-generation-safety.md` (FR-L002, generated output).

`convex/safety/viewerInput.ts` is the reusable classification layer for any untrusted viewer
surface. It is deliberately built ahead of the daily environmental voting feature (ART-45), so
no viewer surface can ship without a gate to call. It performs no database access, no provider
call, and imports nothing from Canon, so a safety failure can never change accepted history.

## Policy version 1

Every submission receives one versioned label, `accept` or `reject`, plus stable ordered reason
codes. Prohibited categories:

| Code | Rejects |
| --- | --- |
| `PROMPT_INJECTION` | Instruction overrides, role-tag and delimiter injection, system/developer prompt extraction, guardrail-disable and jailbreak requests |
| `REAL_PERSON_REFERENCE` | Named public figures, real-office holders, private individuals ("my neighbour"), social-profile links, "based on a real person" |
| `PERSONAL_DATA` | Email addresses, phone numbers, street addresses, national/social-security/passport identifiers, IP addresses, payment identifiers |
| `UNSAFE_VIOLENCE_OR_SEXUAL_CONTENT` | Sexual content involving minors, explicit sexual content, graphic gore and torture, real-world kill/weapon instruction, self-harm encouragement, dehumanization |
| `SYSTEM_COMMAND` | Shell commands and chaining, SQL injection, JSON/schema escape, internal Convex API and function names, script/URI payloads, path traversal |
| `DIRECT_OUTCOME_CONTROL` | Attempts to dictate a canon outcome ("make X die", "the ending must be…", "append a canon event") rather than express a bounded preference |

Structural codes `INPUT_EMPTY`, `INPUT_TOO_LONG`, and `DISALLOWED_CHARACTERS` reject unusable or
control-character-bearing submissions before content ever matters.

A bounded preference stays usable: "I vote for the harvest festival", "I would prefer more rainy
days", and "I hope Dara and Nils talk things through" are all accepted.

## Normalization and decoding

Keyword rules alone are trivially evaded, so each submission is matched against several derived
views: NFKC normalization, invisible-character stripping (zero-width, soft hyphen, bidirectional
overrides), Cyrillic and Greek homoglyph folding, lowercasing, whitespace collapse, separator
collapse, and leet folding. The same rules are then re-applied to payloads recovered from
percent-encoding, HTML numeric entities, backslash-u escapes, and base64 or base64url runs.

Both a punctuation-preserving view and a separator-collapsed view are scanned: the first is
required for shell, SQL, JSON, and path detection, the second defeats `i.g.n.o.r.e` style word
obfuscation. Scanning work is bounded by a fixed view budget and payloads are decoded one level
only.

## Containment

`acceptViewerInput(submission, consume)` is the fail-closed gate. Rejected input throws
`ViewerInputSafetyError` and the consumer is provably never invoked, so rejected text cannot
reach a prompt, a command, Canon, or a downstream log. The classification record and the error
message carry only the policy version, label, reason codes, stable reasons, normalized length,
and an FNV-1a fingerprint — never the submitted text. Accepted text is forwarded only alongside
`VIEWER_INPUT_SUBMISSION_CONSTRAINT`, which frames it as untrusted data rather than instruction.

As with the other two layers, the deterministic rules are a minimum local control, not a claim
that keyword matching classifies every paraphrase. Provider policy and post-generation
classification remain mandatory defense layers. Additions must preserve stable codes, avoid
logging matched source text, and test both prohibited and allowed boundaries.

Focused verification:

```bash
npm test -- --runTestsByPath convex/safety/viewerInput.test.ts
```
