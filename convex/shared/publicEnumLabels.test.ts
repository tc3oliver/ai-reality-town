/**
 * Every enum a public surface prints is printed in Chinese (ART-188).
 *
 * ART-183 did this for `TimeSlot` and left a cross-check against canon in
 * `publicNarrativePresentation.test.ts`. Three values were not covered, and each needs a DIFFERENT
 * guarantee because each has a different kind of vocabulary:
 *
 * - `EventType` is a CLOSED canon union, so the check can be exhaustive in both directions and the
 *   label function is total in practice, not merely by fallback. This is the strongest form.
 * - `relationshipType` is `v.string()` in Canon. It cannot be exhaustive, so the check is that the
 *   types the published graph actually offers all resolve, and that ONE table serves both the
 *   graph page and the character page.
 * - `locationType` is also `v.string()` and is authored freely in the seed. Its label function
 *   returns `null` for an unknown value and the caller omits the line — the `factPredicateLabel`
 *   rule, for the same reason: a registry that fell back to the raw value would keep printing
 *   English schema words for every type a future world invents.
 *
 * The last block scans the SEED rather than a hand-written list, so a location type added to
 * Mistwood without a label fails here rather than silently disappearing from the page.
 */

import { EVENT_TYPES, TIME_SLOTS } from '../canon/eventTypes';
import { mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import {
  LABELLED_EVENT_TYPES,
  eventTypeLabel,
  locationTypeLabel,
  relationshipTypeLabel,
  timeSlotLabel,
} from './publicLabels';

describe('event types', () => {
  it('covers the canon vocabulary exactly, in both directions', () => {
    /**
     * `shared` may depend on nothing, so `LABELLED_EVENT_TYPES` is a hand-copy of canon's
     * `EVENT_TYPES`. This is what makes the copy safe: adding an event type to canon without a
     * label fails HERE, by name, instead of printing `relationship_change` onto the timeline.
     */
    expect([...LABELLED_EVENT_TYPES].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('renders every one in Chinese, with no Latin left', () => {
    for (const eventType of EVENT_TYPES) {
      expect(eventTypeLabel(eventType)).not.toMatch(/[A-Za-z_]/u);
    }
  });

  it('labels the three remediation types too, because a viewer sees them like any other', () => {
    // They arrive on the timeline as ordinary entries; the append-only log's vocabulary is not
    // the viewer's.
    expect(eventTypeLabel('correction')).toBe('更正');
    expect(eventTypeLabel('retcon')).toBe('改寫');
    expect(eventTypeLabel('compensation')).toBe('補償');
  });

  it('returns an unknown type unchanged rather than blank', () => {
    expect(eventTypeLabel('teleportation')).toBe('teleportation');
  });
});

describe('relationship types', () => {
  /** Exactly the set `convex/publicRead/relationshipGraphProjection.ts` publishes. */
  const PUBLISHED = ['trust', 'affection', 'resentment', 'fear', 'dependency', 'familiarity', 'neutral'];

  it('labels every type the published graph can carry', () => {
    for (const type of PUBLISHED) {
      expect(relationshipTypeLabel(type)).not.toBe(type);
      expect(relationshipTypeLabel(type)).not.toMatch(/[A-Za-z]/u);
    }
  });

  it('is ONE table, so the graph page and the character page cannot disagree', () => {
    /**
     * The defect: `RELATIONSHIP_TYPE_LABELS` lived in `relationshipGraphRoute.ts` and was used by
     * the graph alone, while `CharacterPage.tsx` rendered the same edge's type raw. Both now call
     * this function, so there is no second table to drift from.
     */
    expect(relationshipTypeLabel('trust')).toBe('信任');
  });

  it('returns an unknown type unchanged rather than blank', () => {
    // Canon declares this `v.string()`, so an unrecognised value is reachable. A relationship type
    // is a short deliberate word rather than a schema key, so showing it is acceptable.
    expect(relationshipTypeLabel('rivalry')).toBe('rivalry');
  });
});

describe('location types', () => {
  const seeded = [...new Set(mistwoodWorldConfiguration.locations.map((location) => location.type))];

  it('names some types to scan, so this block cannot pass by testing nothing', () => {
    expect(seeded.length).toBeGreaterThan(4);
  });

  it('labels every type the Mistwood seed actually authors', () => {
    const unlabelled = seeded.filter((type) => locationTypeLabel(type) === null);
    expect(unlabelled).toEqual([]);
  });

  it('renders each of them in Chinese', () => {
    for (const type of seeded) {
      expect(locationTypeLabel(type)).not.toMatch(/[A-Za-z]/u);
    }
  });

  it('returns null — not the raw value — for a type it has never heard of', () => {
    /**
     * The whole difference from the two above. `locationType` is `v.string()` and authored freely,
     * so no registry can be complete; falling back to the value would print `warehouse` to a
     * viewer. `null` is the caller's cue to omit the line, which costs nothing because the place's
     * name and description sit right beside it.
     */
    expect(locationTypeLabel('warehouse')).toBeNull();
  });
});

describe('the four vocabularies together', () => {
  it('leaves no English identifier reachable on a labelled path', () => {
    const rendered = [
      ...TIME_SLOTS.map(timeSlotLabel),
      ...EVENT_TYPES.map(eventTypeLabel),
      ...['trust', 'fear', 'neutral'].map(relationshipTypeLabel),
      ...mistwoodWorldConfiguration.locations
        .map((location) => locationTypeLabel(location.type))
        .filter((label): label is string => label !== null),
    ];
    // Positive half first: a bug that rendered nothing would pass the loop below trivially.
    expect(rendered.length).toBeGreaterThan(TIME_SLOTS.length + EVENT_TYPES.length);
    for (const label of rendered) expect(label).not.toMatch(/[A-Za-z]/u);
  });
});
