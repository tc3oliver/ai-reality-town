/**
 * The `modelRef` of the FR-I007 scoped relationship graph for one world day (ART-44).
 *
 * Here, in `shared`, for exactly the reason `voteConsequenceModelRef` is
 * (`./environmentVoteCatalog.ts`): several modules have to spell this string identically — the
 * projection that publishes it, the post-commit pipeline that names it, the graph page that reads
 * it, and the E2E fixture that answers it — and no two of them may import each other. A
 * hand-built template string in each is the ART-146 shape exactly: the fixture and the client
 * disagreed about a key, the query resolved to nothing, and the page failed somewhere that looked
 * unrelated. `src/e2e/fixtureConvexClient.ts` THROWS on an unregistered query, so that failure is
 * loud, but it is loud in the wrong file.
 *
 * `modelKind` deliberately stays in `convex/publicRead/relationshipGraphProjection.ts` beside
 * `READ_MODEL_KINDS`, which is the registry it has to agree with.
 *
 * ## Per world DAY, not per world
 *
 * The alternative was one world-scoped row, `relationshipGraph:<worldId>`, carrying enough history
 * for the client to re-window locally. Per-day wins on three counts and loses on one.
 *
 * **It keeps the guarantee where it is enforceable.** A world-scoped row has to carry every day's
 * candidates so the client can re-window, which means publishing more than thirty nodes and asking
 * the client to draw thirty of them. NFR-002 then becomes a property of the component again — the
 * exact thing §1 of `docs/scoped-relationship-graph.md` says the server-side build exists to
 * prevent. Per-day, the row a viewer receives IS the answer, and thirty is what was published.
 *
 * **A past day is immutable, so it should be a separate version chain.** No event on day 9 can
 * change what had happened by day 7. A world-scoped row's `contentHash` changes on every commit
 * forever, so its version history grows without bound and dedup never fires; per-day rows dedup
 * naturally, and a finished day's chain simply stops.
 *
 * **Date switching is then a change of target**, not a client-side filter over a payload that
 * would have to carry every day at once.
 *
 * ## The cost, stated
 *
 * Published ROW COUNT grows linearly with world age: one target per world day, plus that target's
 * own versions. In practice a day is rebuilt on each commit while it is current — five slots, so
 * single-digit versions — and then never again, so the steady state is roughly O(worldDays), not
 * O(commits). At one world day per real day that is ~365 targets a year for a single world, each a
 * payload bounded at thirty nodes: small beside `publishedReadModels`' per-commit `character`,
 * `arc` and `episode` traffic, and bounded by the SAME `TablesToVacuum` retention in
 * `convex/crons.ts` that already trims this table. `voteConsequence` (ART-46) made the same trade
 * for the same reason and is the worked precedent.
 *
 * The one genuine loss: a world that ran before ART-44 shipped has no row for its past days, and
 * none is backfilled. `docs/scoped-relationship-graph.md` §9 records that rather than leaving it
 * to be discovered.
 */
export function relationshipGraphModelRef(worldId: string, worldDay: number): string {
  return `relationshipGraph:${worldId}:${worldDay}`;
}
