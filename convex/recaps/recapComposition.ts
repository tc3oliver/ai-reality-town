/**
 * Deterministic composition of the Quick and Standard recaps (FR-G003, ART-164).
 *
 * `recapFormats.ts` validates that a Quick Recap is 80–150 中文字 and a Standard Recap 400–800,
 * and deliberately ships no builder for either. That gap is the actual work: hitting a closed
 * character band, from a real world day, without lying about what the text says.
 *
 * ## Whole units, never characters
 *
 * Everything here composes from SENTENCE UNITS — one complete zh-Hant sentence, each carrying the
 * accepted event it came from. A unit is taken or it is not; nothing is ever cut mid-sentence.
 *
 * That single rule is what makes the three failure modes the PRD cares about unreachable rather
 * than merely unlikely:
 *
 *  - **no reversed meaning** — you cannot truncate 「他沒有拿走帳本」 into 「他拿走帳本」 if you never
 *    cut inside a sentence;
 *  - **no half entity** — a character or location name is inside exactly one unit;
 *  - **no dangling provenance** — the artifact's `sourceEventIds` is assembled from the units that
 *    were actually included, so it cannot claim an event whose sentence was dropped.
 *
 * Character-level trimming would be the obvious way to hit a band exactly. It is also the way to
 * publish a sentence that says the opposite of what happened, so this module cannot land on an
 * exact count and does not try to.
 *
 * ## The band is a contract, so falling outside it is a failure
 *
 * A thin world day may not have 80 中文字 of honest public content; a busy one has far more than
 * 800. Padding the first with filler would be inventing content, and cutting the second silently
 * would be exactly the "truncation is never silent" rule this codebase already keeps. So:
 *
 *  - below the minimum with the pool exhausted → {@link RecapCompositionError} naming what WAS
 *    available, so an operator sees a thin day rather than a mysterious empty recap;
 *  - above the maximum → whole units are dropped from the tail and {@link RecapComposition}
 *    records how many and which events they carried.
 *
 * Pure module: no Convex, no clock, no randomness.
 */

import type { AcceptedEvent } from '../canon/model';
import type { DailyEpisode } from '../editorial/episode';
import { countChineseCharacters } from '../shared/publicText';
import {
  QUICK_RECAP_MAX, QUICK_RECAP_MIN, STANDARD_RECAP_MAX, STANDARD_RECAP_MIN,
} from './recapFormats';

/**
 * Bumped whenever composition changes what a recap SAYS.
 *
 * Stored on every artifact so a formatter change never leaves an older row unidentifiable: a
 * reader can tell "composed by v1" from "composed by v2" without guessing from the text, and a
 * regeneration can be told apart from a stale row.
 */
export const RECAP_FORMATTER_VERSION = 1;

/** One complete sentence plus the accepted event it is derived from. */
export type RecapUnit = {
  /** Priority order within a tier: higher is kept first. */
  weight: number;
  text: string;
  sourceEventId: string | null;
};

/** What composition did, recorded on the artifact so no drop is silent. */
export type RecapComposition = {
  formatterVersion: typeof RECAP_FORMATTER_VERSION;
  quickUnits: number;
  standardUnits: number;
  /** Units the Standard Recap could not fit inside its maximum. */
  omittedUnits: number;
  /** Accepted events carried ONLY by omitted units — content a reader will not see. */
  omittedSourceEventIds: string[];
};

export class RecapCompositionError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'RecapCompositionError';
  }
}

const sentence = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  return /[。！？]$/u.test(trimmed) ? trimmed : `${trimmed}。`;
};

/**
 * The ordered pool of sentences a day's recaps may draw from.
 *
 * Ordering is by weight and then by the order the episode itself lists things, which is accepted
 * order — so composition is a pure function of the episode and its events, and two runs over the
 * same day produce the same recap.
 *
 * The pool draws ONLY on already-public material: the episode's own copy (which passed the
 * Episode's secret gate) and the accepted events' `publicSummary`. Private state changes, private
 * facts and world secrets are never a source, which is why the spoiler gate in ART-164 step 2 has
 * something honest to check rather than something to repair.
 */
export function buildRecapUnits(
  episode: DailyEpisode,
  events: readonly AcceptedEvent[],
): RecapUnit[] {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const units: RecapUnit[] = [];
  const push = (weight: number, text: string, sourceEventId: string | null): void => {
    const composed = sentence(text);
    if (composed.length > 0) units.push({ weight, text: composed, sourceEventId });
  };

  // 100 — the day in one line. Always first, so even the thinnest recap says what happened.
  push(100, episode.headline, null);
  push(95, episode.oneLineSummary, null);

  // 80 — the scenes, in episode order, each tied to the event it narrates.
  for (const scene of episode.keyScenes) {
    push(80, `${scene.title}：${scene.summary}`, scene.sourceEventIds[0] ?? null);
  }

  // 70 — public relationship movement. Named separately from scenes because FR-G004 checks that a
  // major public relationship change was MENTIONED, and a recap that only summarised scenes could
  // pass that check by accident on one day and fail it on the next.
  for (const change of episode.relationshipChanges) {
    push(70, change.summary, change.sourceEventId);
  }

  // 60/55 — the questions the day opened and closed: the arc-facing half of the recap.
  for (const question of episode.newQuestions) push(60, `新的疑問：${question}`, null);
  for (const question of episode.resolvedQuestions) push(55, `已解答：${question}`, null);

  // 40 — every remaining accepted event's own public summary, for days whose episode copy is
  // short. Skipped when a scene already carries that event, so nothing is said twice.
  const covered = new Set(episode.keyScenes.flatMap((scene) => scene.sourceEventIds));
  for (const eventId of episode.sourceEventIds) {
    if (covered.has(eventId)) continue;
    const event = byId.get(eventId);
    const summary = event?.publicSummary?.trim();
    if (summary) push(40, summary, eventId);
  }

  return units.sort((left, right) => right.weight - left.weight);
}

/**
 * Take whole units until the next one would exceed `max`.
 *
 * Deliberately greedy in pool order rather than a best fit: a best fit would reorder the day's
 * sentences to pack the band, and a recap whose sentences are out of narrative order to hit a
 * character count is worse than one that stops early.
 */
function fill(units: readonly RecapUnit[], max: number): { taken: RecapUnit[]; text: string } {
  const taken: RecapUnit[] = [];
  let text = '';
  for (const unit of units) {
    const candidate = text.length === 0 ? unit.text : `${text}${unit.text}`;
    if (countChineseCharacters(candidate) > max) continue;
    text = candidate;
    taken.push(unit);
  }
  return { taken, text };
}

export type ComposedRecaps = {
  quickRecap: string;
  standardRecap: string;
  composition: RecapComposition;
  /** Accepted events the composed text actually accounts for. */
  sourceEventIds: string[];
};

/**
 * Compose the Quick and Standard recaps, or throw naming the band that could not be met.
 *
 * Both tiers draw from the same pool, so the Quick Recap is a strict prefix of what the Standard
 * Recap covers — a reader who reads only the short one is never told something the long one
 * contradicts.
 */
export function composeRecaps(
  episode: DailyEpisode,
  events: readonly AcceptedEvent[],
): ComposedRecaps {
  const units = buildRecapUnits(episode, events);
  const available = countChineseCharacters(units.map(({ text }) => text).join(''));

  if (available < QUICK_RECAP_MIN) {
    // Explicit refusal, with the measurement in it. The alternative — padding to 80 中文字 —
    // would be inventing narrative content to satisfy a length check.
    throw new RecapCompositionError(
      'RECAP_POOL_BELOW_MINIMUM',
      `world day has ${available} 中文字 of public content, below the ${QUICK_RECAP_MIN} the Quick Recap requires`,
      { available, required: QUICK_RECAP_MIN, units: units.length },
    );
  }

  const quick = fill(units, QUICK_RECAP_MAX);
  if (countChineseCharacters(quick.text) < QUICK_RECAP_MIN) {
    // The pool is large enough in total, but its individual sentences do not combine into the
    // band — one unit longer than QUICK_RECAP_MAX, for instance. Also a refusal: the fix is a
    // shorter headline, not a sliced sentence.
    throw new RecapCompositionError(
      'RECAP_QUICK_UNSATISFIABLE',
      `no whole-sentence combination lands in ${QUICK_RECAP_MIN}–${QUICK_RECAP_MAX} 中文字`,
      { composed: countChineseCharacters(quick.text), available },
    );
  }

  const standard = fill(units, STANDARD_RECAP_MAX);
  if (countChineseCharacters(standard.text) < STANDARD_RECAP_MIN) {
    throw new RecapCompositionError(
      'RECAP_STANDARD_BELOW_MINIMUM',
      `world day composes to ${countChineseCharacters(standard.text)} 中文字, below the ${STANDARD_RECAP_MIN} the Standard Recap requires`,
      { composed: countChineseCharacters(standard.text), available, units: units.length },
    );
  }

  const takenIds = new Set(standard.taken.flatMap((unit) => unit.sourceEventId ? [unit.sourceEventId] : []));
  const omitted = units.filter((unit) => !standard.taken.includes(unit));
  const omittedSourceEventIds = [...new Set(omitted.flatMap((unit) =>
    unit.sourceEventId && !takenIds.has(unit.sourceEventId) ? [unit.sourceEventId] : []))].sort();

  return {
    quickRecap: quick.text,
    standardRecap: standard.text,
    composition: {
      formatterVersion: RECAP_FORMATTER_VERSION,
      quickUnits: quick.taken.length,
      standardUnits: standard.taken.length,
      omittedUnits: omitted.length,
      omittedSourceEventIds,
    },
    // Provenance is the events the KEPT sentences came from, not the episode's whole source list:
    // claiming an event whose sentence was dropped is exactly the drift the gate looks for.
    sourceEventIds: [...takenIds].sort(),
  };
}
