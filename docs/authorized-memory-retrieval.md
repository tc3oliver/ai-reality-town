# Authorized memory retrieval

Character cognition uses `retrieveCharacterMemories`, an internal-only query. It first
authorizes the character against the requested memory owner, then deterministically ranks
that character's Accepted-Event-derived memories. Ranking combines query-token overlap,
importance, world-time recency, emotional magnitude, and whether the source event belongs
to the supplied active-arc context.

The caller must request 1–12 memories. The response contains only that bounded selection,
its immutable event provenance, and per-factor scores for traceability; it never constructs
or returns a prompt or the full memory history. Ties use the stable memory ID. No model or
embedding service is required, so the same projection and request replay identically.
