# OpenAI-compatible provider adapter

ART-72 implements PRD NFR-004 and the Milestone 2 real-provider boundary without a
vendor SDK. Business modules use the vendor-neutral ports in `simulation/provider.ts`;
HTTP request/response shapes exist only under `simulation/providers/`.

## Convex deployment configuration

Set real values only in the target Convex deployment environment:

```bash
npx convex env set LLM_API_URL https://provider.example/v1
npx convex env set LLM_MODEL your-chat-model
npx convex env set LLM_EMBEDDING_MODEL your-embedding-model
npx convex env set LLM_EMBEDDING_DIMENSION 1024
npx convex env set LLM_API_KEY your-key
```

`LLM_API_KEY` may be omitted only when
`LLM_ALLOW_UNAUTHENTICATED=true` is explicitly set. Optional
`LLM_CHAT_API_URL`/`LLM_EMBEDDING_API_URL` override derived endpoints. A base ending in
`/embeddings` (for example `https://llm.shouri.app/v1/embeddings`) is normalized back to
the shared `/v1` root before deriving the chat endpoint.

Never use `VITE_*` for credentials. Do not place live keys in `.env.example`, Backlog,
logs, traces, tests, browser code, or commits.

## Behavior

- Chat requests require structured JSON output and are normalized to an unknown domain
  value that existing runtime validators must accept before use.
- Embeddings are finite numeric vectors and must exactly match the configured dimension.
- HTTP 408/429/5xx, timeouts, and network failures have bounded retry; other failures
  return stable permanent codes.
- Trace metadata contains model, token counts, latency, and retry count, never headers,
  raw prompts, response bodies, or credentials.
- The server-only capability probe checks chat endpoint/model/structured-output support
  and embedding endpoint/model/dimension compatibility.

Offline verification uses mocked HTTP and requires no credentials:

```bash
npm test -- --runTestsByPath convex/simulation/providers/openAICompatible.test.ts
```
