/**
 * The world days an administrator's publication decision has taken off the surface (ART-176).
 *
 * ## Why this is its own module
 *
 * ART-171 made the FR-K004 administrator withhold reachable. ART-174 taught the Episode INDEX to
 * honour it. This is the third surface that needs the same answer — the onboarding summary — and a
 * third hand-rolled copy of "read the non-servable statuses, filter to current, parse the content
 * reference" is how the three would come to disagree about what `withheld` means. The repository
 * has had that exact shape twice already: `REPLAY_PUBLISHED_RECORD_STATUSES` was a second copy of
 * the servable status list, and `heatScore` had two computation rules.
 *
 * So the join has one definition, here, and the surfaces call it.
 *
 * ## The read is bounded from the RECORD side, deliberately
 *
 * One indexed sweep per non-servable status, not a lookup per candidate day. Every caller is on
 * the per-event post-commit path, and the number of days a caller considers grows with the world
 * while the number of WITHHELD days does not. Reading from the record side keeps the cost tied to
 * the thing that stays small (CLAUDE.md §9).
 *
 * ## Absence is not refusal
 *
 * A day with no publication record at all is NOT withheld. Episodes that predate FR-K004 have
 * none, and the pipeline creates the record after generating the Episode — so reading silence as a
 * withhold would blank the public surface for every world older than the lifecycle.
 */

import type { GenericQueryCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import {
  PUBLICATION_STATUSES,
  isViewerServablePublicationStatus,
} from '../editorial/publicationLifecycle';
import { episodeContentRefOf } from './visualReplay';

type Db = GenericQueryCtx<DataModel>['db'];

/**
 * The publication statuses that take content OFF the surface.
 *
 * Derived from {@link isViewerServablePublicationStatus} rather than listed, so a status added to
 * the lifecycle lands on the non-servable side by default. Listing them would put a new status on
 * the SERVABLE side by being forgotten, which is the wrong direction to fail in.
 */
export const NON_SERVABLE_PUBLICATION_STATUSES = PUBLICATION_STATUSES
  .filter((status) => !isViewerServablePublicationStatus(status));

/**
 * The world day an `episode:<worldId>:<worldDay>` content reference addresses, or `null`.
 *
 * Matched against the reference THIS world would mint rather than by splitting on colons: a world
 * id may contain one, and `episode_share` rides the same lifecycle — a share record must not be
 * read as an Episode.
 */
export function worldDayOfEpisodeContentRef(worldId: string, contentRef: string): number | null {
  const prefix = episodeContentRefOf(worldId, 0).slice(0, -1);
  if (!contentRef.startsWith(prefix)) return null;
  const worldDay = Number(contentRef.slice(prefix.length));
  return Number.isSafeInteger(worldDay) && worldDay >= 0 ? worldDay : null;
}

/** Every world day whose CURRENT Episode publication record is not viewer-servable. */
export async function readWithheldPublicationWorldDays(db: Db, worldId: string): Promise<Set<number>> {
  const groups = await Promise.all(NON_SERVABLE_PUBLICATION_STATUSES.map((status) => db
    .query('publicationRecords')
    .withIndex('by_world_and_status', (q) => q.eq('worldId', worldId).eq('status', status))
    .collect()));
  const days = new Set<number>();
  for (const row of groups.flat()) {
    // `isCurrent` is the whole point: a superseded record for a day that was later republished
    // must not withhold it. The status sweep finds both; only the live one decides.
    if (!row.isCurrent) continue;
    const worldDay = worldDayOfEpisodeContentRef(worldId, row.contentRef);
    if (worldDay !== null) days.add(worldDay);
  }
  return days;
}
