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
- Trace metadata contains the requested route, the model the gateway said served the call, token
  counts, latency, retry count and the reported free-tier allowance — never headers, raw prompts,
  response bodies, or credentials.
- The server-only capability probe checks chat endpoint/model/structured-output support
  and embedding endpoint/model/dimension compatibility.

## Retryability and cause are different questions

`LLM_HTTP_RETRYABLE` covers 408, 429 and every 5xx, because all three are worth retrying. It does
**not** say the allowance ran out, and reading it that way meant a gateway returning 500 was
reported as an exhausted quota — sending an operator to look for a billing problem while the
gateway was simply down. `SimulationProviderError` therefore carries `rateLimited` alongside
`kind`, set only for a 429, and it defaults to `false`: rate limiting is a specific claim, and a
failure that has not made it is not making it by accident.

An exhausted route chain is the case where the two genuinely diverge. It is **permanent** — every
hop has already spent allowance, so retrying would spend the chain again for the same reason — and
still **rate-limited** when rate limits are what stopped it. That combination is what puts the
outage in `usageByRoute.rateLimited`, which is where an operator looks to find out that the key ran
out rather than that the gateway broke.

## The live wiring

`convex/simulation/providers/liveSceneAuthor.ts` is the only assembly point:

```
FreeRouteChainProvider( createLanguageModelProvider( config ) )
```

The safety gate is **inside** the chain, not around it, so it screens every hop rather than only
the first — and a prompt the pre-generation policy refuses is a request-level failure, so it costs
one refusal instead of the whole chain's allowance. Route order comes from `LLM_FREE_ROUTE_CHAIN`;
absent or empty means one route (`LLM_MODEL`) and no hops.

An explicit `request.model` — ART-59's over-budget downgrade, or ART-52's per-module override — is
tried **first**, with the configured routes still behind it as fallbacks. Before ART-159 the chain
overwrote `model` on every hop, so a downgrade was decided, recorded in the ledger, and then
discarded: the call ran on the configured route anyway. A budget control that is decided and then
ignored is worse than one that does not exist, because the ledger says it worked.

There is no paid/free filtering, and nothing guards against escalation to a paid tier. FREE_ONLY is
a fact about the configured **endpoint** — every route it exposes reports `owned_by: freellmapi`
and none carries a price — so it is enforced by there being one configured endpoint and no code
path that substitutes another, not by a flag on a route that could be set wrong.

Offline verification uses mocked HTTP and requires no credentials:

```bash
npm test -- --runTestsByPath convex/simulation/providers/openAICompatible.test.ts
npm test -- --runTestsByPath convex/simulation/providers/freeRouteChain.test.ts
# the live wiring end to end — real chain, real budget mutations, only `fetch` stubbed
npm test -- --runTestsByPath convex/simulation/providers/liveWorldDayWiring.test.ts
```
