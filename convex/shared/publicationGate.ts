/**
 * The automatic publication gate (ART-162) — one rule, read from one place.
 *
 * ## What the flag means
 *
 * `worldSchedules.publishEnabled` has existed since ART-18 and, until this module, gated nothing:
 * it was written by the scheduler, copied onto every reserved slot, and read by no production code
 * at all. A field named for a publication control that controls nothing is worse than an absent
 * one, because it reads as a safety switch.
 *
 * It now has exactly one meaning, and the asymmetry is the whole point:
 *
 *   **It can SUPPRESS publication. It can never FORCE it.**
 *
 * `false` freezes the public surface: simulation, Canon commit, Episode and Recap derivation and
 * the whole Safety/Editorial lifecycle carry on unchanged, publication stops at Ready, no new
 * Public Read Model version is written, and whatever is already live keeps serving.
 *
 * `true` grants nothing by itself. It only declines to interfere — content still has to pass
 * safety, still has to be walked through the publication lifecycle by an authorized operator, and
 * a Withheld record is still Withheld. There is deliberately no code path anywhere that reads this
 * flag and ADVANCES a status, so "publishEnabled bypassed the safety gate" is not a bug that can
 * be written without deleting this comment.
 *
 * ## Why it lives in `shared`
 *
 * Two boundaries enforce it — the read-model commit in `publicRead` and the publication transition
 * in `editorial` — and neither may depend on the other. Stating the rule twice would let them
 * disagree about what an unscheduled world does, and the disagreement would be invisible: one
 * surface would freeze while the other kept publishing.
 *
 * ## An unscheduled world publishes
 *
 * `worldSchedules` is written by the scheduler, so a world that has not been scheduled — a
 * fixture, an import, a warmup world — has expressed no opinion. Defaulting those to suppressed
 * would blank every read model in the offline gate and in every test fixture, which is a far worse
 * failure than the one being guarded against. Absent means "no opinion", and no opinion means
 * behave exactly as before this module existed.
 */

/** The stable code a refused publication transition carries. */
export const PUBLICATION_SUPPRESSED = 'PUBLICATION_SUPPRESSED';

/**
 * A world's schedule, as far as this gate is concerned.
 *
 * Deliberately the ROW rather than a database handle. `convex/shared` depends on nothing — not
 * even the generated data model — and taking a `db` here would have made this the first shared
 * module to import it. The lookup is one indexed line at each call site; what must not be
 * duplicated is the JUDGEMENT below, and that is what lives here.
 */
export type PublicationSchedule = { publishEnabled?: boolean } | null | undefined;

/**
 * Whether this world's automatic publication gate is open.
 *
 * Absent means "no opinion", and no opinion means publish. `worldSchedules` is written by the
 * scheduler, so a world that has not been scheduled — a fixture, an import, a warmup world — never
 * expressed one. Reading absent as suppressed would blank every read model in the offline gate and
 * in every test fixture, which is a far worse failure than the one being guarded against.
 */
export function isPublicationEnabled(schedule: PublicationSchedule): boolean {
  return schedule?.publishEnabled ?? true;
}
