/**
 * Recap projection boundary (Phase 0 placeholder).
 *
 * The recaps layer will produce periodic summaries ("previously on…") of the world for
 * onboarding and orientation. Like the story layer, it is a READ model over canon and
 * never writes canon state. Phase 0 only declares the boundary.
 */

import type { EventId } from '../shared/ids';

export type RecapProjection = {
  worldId: string;
  /** Sequence number up to which this recap was generated. */
  upToSequenceNumber: number;
  asOfWorldDay: number;
  highlights: RecapHighlight[];
};

export type RecapHighlight = {
  summary: string;
  sourceEventIds: EventId[];
};
