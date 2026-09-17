# Diagnosing a failed authoring attempt

What a live world-day slot records when it could not author a scene, and how to read it (ART-195).

## The failure this exists because of

A live slot on `colorless-deer-917`, the acceptance/staging deployment, stopped the Mistwood world
and left exactly this behind:

```
slot     authoringErrorCode: SCENE_SIMULATION_FAILED   authoredScenes: 0
trace    errorCode: SCENE_ATTEMPT_FAILED               validationResult: not_run
```

Both are constants. The second was not a diagnosis at all: `SCENE_ATTEMPT_FAILED` was what
`stableAttemptCode` returned when the thrown error carried no `code` property — which is every raw
`Error`, every `TypeError`, and `PreGenerationSafetyError`, whose category lives on
`.rejection.code`. The first came from `simulateWholeScene`'s fallback throw, which discarded
`lastError` entirely.

So four faults needing four different responses — the gateway is down, the key was refused, a Convex
mutation inside the budget gate failed, the prompt was blocked by policy — were all recorded
identically, and answering "which one" required deploying new code to a world that had already
stopped.

## What is recorded now

Every failed authoring attempt writes two rows, keyed identically on
`${simulationRunId}:attempt:${n}`:

| Table | Carries | Contract |
| --- | --- | --- |
| `llmTraces` | `errorCode`, the outcome, the model, retry counts | A bounded upper-case machine code and **no free text**. Unchanged. |
| `authoringFailures` | `code`, `errorName`, `message`, `stage`, `causeName`, `causeCode`, `causeMessage`, `retryable` | Sanitized text is permitted, and this is the only table where it is. |

They are separate on purpose. `normalizeLlmTraceDraft` exists to guarantee a trace record carries no
prompt, no response and no credential, and widening it to hold a message would have removed that
guarantee for every reader of the table rather than only for this one writer.

The action also returns the detail, so a manual run prints the cause without a second query:

```bash
# ACCEPTANCE (colorless-deer-917) — npx convex run targets the dev slot
npx convex run simulation/providers/liveWorldDayActions:runLiveWorldDaySlotWithProvider '{"worldId":"mistwood"}'
```

```jsonc
{
  "slots": [{
    "authoringErrorCode": "LLM_HTTP_REJECTED",
    "authoringFailure": {
      "code": "LLM_HTTP_REJECTED",
      "errorName": "SimulationProviderError",
      "message": "provider rejected the request with HTTP 401",
      "stage": "provider_transport",
      "causeName": null, "causeCode": null, "causeMessage": null,
      "retryable": false
    }
  }]
}
```

## Reading the fields

**`stage`** is the field to route on. It is derived from the error's own identity, not from where
the exception was caught — `authorSlotScenes` catches a transport failure, a budget refusal and a
schema rejection at the same `catch`, so the catch site cannot tell them apart.

| stage | What broke | Where to look |
| --- | --- | --- |
| `configuration` | The deployment has no usable provider configuration | `npx convex env list` |
| `pre_generation_safety` | The policy refused the prompt before any network call | `convex/safety/preGeneration.ts`; the category is in the message |
| `provider_transport` | The call did not produce an answer — status, timeout, network | The gateway, the key, the allowance |
| `provider_response` | The call SUCCEEDED and the answer was the wrong shape | The model and the request schema |
| `route_chain` | Every configured free route was unavailable | `LLM_FREE_ROUTE_CHAIN`, the key's allowance |
| `budget` | FR-M003 refused the reservation | `docs/token-budget-controls.md` |
| `output_validation` | The answer parsed and the scene schema refused it | `docs/whole-scene-simulation.md` |
| `unknown` | The error identified itself in no usable way | `errorName` and `message` are all there is |

`unknown` is a real member of the vocabulary and not a defect to paper over. An exception whose
origin cannot be established from its own identity is the case this whole mechanism exists for, and
assigning it a confident stage would be the original problem wearing a new field.

**`retryable`** is not a description of the failure — it is the predicate `simulateWholeScene`
applies. A row saying `retryable: true` beside an attempt that was not retried is not expressible,
because the same call decides both.

**`causeMessage`** is where a network failure keeps its real reason. `fetch failed` names nothing;
`getaddrinfo ENOTFOUND gw.example` names the fault.

**`code`** is derived from the error's class when the error carried none —
`TypeError` becomes `PROVIDER_EXCEPTION_TYPE_ERROR`. A class name is a code-side constant, never
model text, so it is safe to promote into a field whose contract is that it carries none. A name
that does not reduce to a bounded code yields `PROVIDER_EXCEPTION_UNCLASSIFIED`.

## Why a message field is admissible here at all

Because the guarantee is preserved by construction rather than by the field not existing. Two
redaction passes, neither of which subsumes the other:

1. **By shape**, in `convex/shared/failureDetail.ts`, which never sees a credential and so cannot
   match one by value: bearer tokens, credential-shaped query parameters, and any opaque run of 24
   or more token characters. The bound is chosen against what must SURVIVE — `agnes-2.5-flash` and
   `deepseek-v4-pro` are shorter, an API key is longer.
2. **By value**, in `convex/simulation/providers/`, which is the composition root and the one place
   holding the configured `LLM_API_KEY`. A credential that looks like nothing in particular is
   invisible to pass 1 and exact to pass 2.

Then: the result is bounded to 300 characters and truncation **publishes what it removed**, and a
non-string `message` yields the empty string rather than being serialised — the object most likely
to be hanging off a provider error is the request or response payload.

No request body, no prompt, no provider response, and no arbitrary object is ever stringified.

## Evidence

- `convex/shared/failureDetail.test.ts` — the classifier and both redaction passes, driven directly.
- `convex/simulation/authoringFailureDiagnosis.test.ts` — the same properties through the REAL
  adapter over a stubbed transport, so what is asserted is a property of the shipped code: a plain
  `Error`, a non-Error throw, HTTP 401/500/429, a malformed completion, an abort, and each already
  typed error keeping its own semantics.

Six fault injections were run against those suites, each failing the named test it should:
restoring the old fallback throw, restoring the old `.code`-only rule, dropping the bearer
redaction, dropping the exact-value pass, stringifying a non-string message, and dropping the
truncation marker.

## See also

- `docs/llm-tracing.md` — the `llmTraces` contract this deliberately does not widen.
- `docs/world-quality-metrics.md` — how the same attempt rows feed §16.2's structured-output rate.
- `docs/model-outage-degradation.md` — what the FR-M004 ladder does with a run of these.
- `docs/deployment-environments.md` — which deployment a reading came from.
