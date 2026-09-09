/**
 * The `modelRef` of one character's FR-I005 viewer-knowledge read model (ART-169).
 *
 * Here, in `shared`, for the reason `relationshipGraphModelRef` is (`./relationshipGraphRef.ts`):
 * four places have to spell this string identically — the projection that publishes it, the
 * post-commit pipeline that names it, the character page that reads it, and the E2E fixture that
 * answers it — and no two of them may import each other. `src/e2e/fixtureConvexClient.ts` throws
 * on an unregistered query, so a hand-built template string that drifts fails loudly, but it
 * fails in the wrong file (ART-146).
 *
 * `modelKind` stays in `convex/publicRead/viewerKnowledgeProjection.ts`, beside the
 * `READ_MODEL_KINDS` registry it has to agree with.
 */
export function viewerKnowledgeModelRef(characterId: string): string {
  return `viewerKnowledge:${characterId}`;
}
