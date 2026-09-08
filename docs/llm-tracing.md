# Secret-safe LLM tracing

Every product model-call adapter must record one versioned LLM trace through the
observability boundary. Version 1 requires world ID/day, run ID, trace ID, model and
prompt **version**, retry count, validation result, and final status. `sceneId` and `arcId`
are absent only when that context does not exist; `characterIds` is always present and uses
an empty list for calls without character context. The input/output token counts, the
latency and the failure `errorCode` are **optional**, and absent means the writer did not
observe it — see "Why the token and latency fields are ABSENT on these rows" below.

Trace records contain accounting and correlation metadata only. Raw or complete prompts,
messages, model responses, API keys, authorization headers, secrets, and request/response
bodies are rejected by the runtime contract and cannot be inserted by the internal
Convex mutation. Prompt version identifiers are allowed; prompt content is not.

The full trace query is an `internalQuery` for server-side operations paths. The public
query returns only schema version, trace/world correlation, world day, and final status;
it omits model, prompt-version, token, scene, arc, character, validation, retry, and
latency metadata. Future operations UI work must add authenticated server-side
authorization before forwarding internal results.

Trace IDs are idempotent. Re-recording identical metadata is deduplicated; reusing a
trace ID for different call metadata fails with `CONFLICTING_LLM_TRACE`, preventing
double accounting or correlation ambiguity. Trace records are observability data and
have no Canon mutation capability.

## Until ART-90 this table had no writer

Everything above was true and unreachable. `recordTrace` in `convex/observability/traces.ts`
was a registered `internalMutation` with **zero production callers** — the table, its
whitelist normaliser, its redaction and its public projection were all built and tested,
and nothing in the deployment ever called any of it.

The consequences were not visible as failures, which is why they lasted:

- `validationResult` and `finalStatus` were **structurally absent from every world**. No row
  existed to carry them, so nothing could read a validation outcome out of a trace, and
  §16.2's JSON 結構成功率 had no evidence to be computed from at all.
- Two consumers read an always-empty table and reported what they found. The trace count in
  `convex/operations/dynamicViewMetricsFunctions.ts` was always zero, and the FR-K002
  proposal review's **Model Trace** in `convex/operations/proposalReviewStore.ts` — which
  correlates by scene and then falls back to run — always found nothing. Neither threw.
  An empty correlation looks exactly like a call that was never traced.

**ART-90 is the writer.** `recordAuthoringAttempt` in
`convex/simulation/qualityEvidenceFunctions.ts` writes one row per **whole-scene authoring
attempt**, called from the `onAttempt` hook the live path passes into `simulateWholeScene`.
It writes through this table rather than through a new one because this table already *is*
the per-call record FR-M001 defines: trace id, world, day, run, scene, model, prompt
version, retry count, validation result and final status, behind a normaliser that throws on
any field resembling raw model input or credential material.

### What an authoring-attempt row means

| Attempt outcome | `validationResult` | `finalStatus` |
| --- | --- | --- |
| `parsed` — the provider answered and the schema accepted the answer | `passed` | `succeeded` |
| `output_rejected` — the provider answered and runtime schema validation refused it | `rejected` | `failed` |
| `provider_failed` — no answer to validate: a timeout, a refused credential, an exhausted route chain, a budget refusal | `not_run` | `failed` |

`not_run` is the load-bearing value. An attempt that never received a response did not fail
validation, and §16.2's structured-output rate must not count a timeout as a model that
cannot follow a schema. The rate's denominator is therefore `passed + rejected`, not every
trace, and the `not_run` rows are published as the excluded count with their reason. See
[`world-quality-metrics.md`](./world-quality-metrics.md) §6.3.

`traceId` is `${simulationRunId}:attempt:${n}`, derived from `(worldId, worldDay, timeSlot)`
by way of the scene, so a retried slot re-derives the same ids. The write is
insert-if-absent, and a slot run three times contributes one row per attempt rather than
three.

### Why the token and latency fields are ABSENT on these rows

`inputTokens`, `outputTokens` and `latencyMs` are **omitted** from every authoring-attempt
row. Both the fake and the live adapter report usage on the **settled** call, which the
attempt recorder does not observe: it is handed the attempt's outcome, not the provider's
usage report. ART-59's budget ledger is the accounting of record for tokens and cost, it
books the provider's own reported usage per attempt, and a second per-attempt number written
here would be a second place for the same fact to be wrong. This row does not restate it.

**ART-90 wrote literal `0` in all three, and ART-166 removed them.** The section this
replaces argued exactly the reasoning above and then asked the reader to read three zeros as
"not measured" — which nothing downstream does. The rate metrics ignore these fields, but the
FR-K002 **Model Trace** panel renders them, and it had shown `null` for every proposal before
ART-90 gave the table a writer; afterwards it showed a call that really happened as 0 tokens
and 0 ms. A zero is a measurement, and a wrong measurement is worse than an admitted absence.

The three fields are therefore **optional** in `llmTraceDraftValidator` and in `LlmTraceDraft`.
Absent means unobserved, at every layer: `normalizeLlmTraceDraft` does not default them, and
no reader may either. A trace written by a future adapter that *does* observe settled usage
carries the real numbers, and a measured `0` is still stored as a measurement.

### The code a failed attempt failed with

`errorCode` is optional and holds the stable code the attempt failed with —
`SCENE_OUTPUT_PROVENANCE_MISMATCH`, `LLM_HTTP_RETRYABLE`, `LLM_FREE_ROUTES_EXHAUSTED`. It is
what fills the `structuredOutputReasons` and `providerFailureReasons` dimensions of
`getOperationalQualityMetrics`.

**ART-90 declared the argument and discarded it**: the table had no column, so the read
substituted one constant per dimension and every refusal looked alike. ART-166 added the
column and the read. The field is normalised by `ERROR_CODE_PATTERN` — upper case, digits and
underscores, at most 64 characters — deliberately narrower than the id pattern the other
fields use, because a pattern admitting lower case or punctuation would admit a provider's
error message, and this record's whole contract is that it carries no model text.

`recordAuthoringAttempt` now builds its row through `normalizeLlmTraceDraft` rather than
inserting it directly. The paragraph above about the normaliser had been true of `recordTrace`
and false of the only writer this deployment runs, from ART-90 until ART-166.
