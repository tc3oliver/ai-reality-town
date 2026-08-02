# Secret-safe LLM tracing

Every product model-call adapter must record one versioned LLM trace through the
observability boundary. Version 1 requires world ID/day, run ID, trace ID, model and
prompt **version**, input/output token counts, latency, retry count, validation result,
and final status. `sceneId` and `arcId` are absent only when that context does not exist;
`characterIds` is always present and uses an empty list for calls without character
context.

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
