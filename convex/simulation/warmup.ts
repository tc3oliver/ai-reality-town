/**
 * Private world warmup workflow (FR-A004, PRD §10.3).
 *
 * Manages the warmup lifecycle + the three distinct §10.3 markers (actual start
 * day, public broadcast start day, recommended newcomer entry point) for an
 * unpublished world. Warmup content is NEVER published: the public read model is
 * only reachable after the warmup completes AND an administrator confirms the
 * public start day (AC#1/#5). Pause/resume/rerun are pure state transitions
 * (AC#2). Confirming or changing the public start day edits the marker only — it
 * never rewrites warmed Canon history (AC#9).
 *
 * Pure module — no Convex imports, no clock, no randomness, no Canon mutation.
 */

export const WARMUP_SCHEMA_VERSION = 1;
export const WARMUP_MIN_DAYS = 30;
export const WARMUP_MAX_DAYS = 60;

export type WarmupPhase = 'running' | 'paused' | 'completed' | 'failed';

export type NewcomerEntry = { episodeNumber: number; worldDay: number };

export type WarmupMarkers = {
  schemaVersion: typeof WARMUP_SCHEMA_VERSION;
  worldId: string;
  /** §10.3: the actual start day of this world (Day 1+). */
  actualStartDay: number;
  /** §10.3: the target number of warmup days (30–60). */
  targetDayCount: number;
  /** §10.3: the public broadcast start day — null until confirmed. */
  publicBroadcastStartDay: number | null;
  /** §10.3: the system-recommended newcomer entry point (AC#4). */
  recommendedNewcomerEntry: NewcomerEntry | null;
  /** The administrator-confirmed public start day (AC#4). */
  confirmedPublicStartDay: number | null;
  phase: WarmupPhase;
  /** Highest fully warmed world day so far. */
  lastCompletedDay: number;
  /** True once at least one Active Story Arc exists (AC#3). */
  activeArcRequirementMet: boolean;
  failureCode?: string;
};

export class WarmupError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'WarmupError';
  }
}

function assertValidDayCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < WARMUP_MIN_DAYS || count > WARMUP_MAX_DAYS) {
    throw new WarmupError('WARMUP_DAY_RANGE', `targetDayCount must be an integer from ${WARMUP_MIN_DAYS} to ${WARMUP_MAX_DAYS}`);
  }
}

/** Create fresh warmup markers in the `running` phase (AC#2 start). */
export function createWarmupMarkers(input: { worldId: string; actualStartDay: number; targetDayCount: number }): WarmupMarkers {
  if (input.worldId.trim().length === 0) throw new WarmupError('WARMUP_INVALID', 'worldId must be non-empty');
  if (!Number.isSafeInteger(input.actualStartDay) || input.actualStartDay < 1) {
    throw new WarmupError('WARMUP_INVALID', 'actualStartDay must be a positive integer');
  }
  assertValidDayCount(input.targetDayCount);
  return {
    schemaVersion: WARMUP_SCHEMA_VERSION, worldId: input.worldId, actualStartDay: input.actualStartDay,
    targetDayCount: input.targetDayCount, publicBroadcastStartDay: null, recommendedNewcomerEntry: null,
    confirmedPublicStartDay: null, phase: 'running', lastCompletedDay: input.actualStartDay - 1,
    activeArcRequirementMet: false,
  };
}

function assertPhase(markers: WarmupMarkers, allowed: WarmupPhase[]): void {
  if (!allowed.includes(markers.phase)) {
    throw new WarmupError('WARMUP_PHASE_INVALID', `operation not allowed in phase '${markers.phase}'`);
  }
}

/** Pause a running warmup (AC#2). */
export function pauseWarmup(markers: WarmupMarkers): WarmupMarkers {
  assertPhase(markers, ['running']);
  return { ...markers, phase: 'paused' };
}

/** Resume a paused warmup (AC#2). */
export function resumeWarmup(markers: WarmupMarkers): WarmupMarkers {
  assertPhase(markers, ['paused']);
  return { ...markers, phase: 'running' };
}

/**
 * Rerun the warmup from a given day (AC#2). The warmup returns to `running` and
 * completion is recomputed from the new day; previously warmed days remain part
 * of Canon history (never rewritten).
 */
export function rerunWarmup(markers: WarmupMarkers, fromDay: number): WarmupMarkers {
  if (!Number.isSafeInteger(fromDay) || fromDay < markers.actualStartDay) {
    throw new WarmupError('WARMUP_INVALID', 'rerun day must be on or after the actual start day');
  }
  assertPhase(markers, ['paused', 'failed', 'completed']);
  return { ...markers, phase: 'running', lastCompletedDay: fromDay - 1, failureCode: undefined };
}

/**
 * Record the completion of a warmed world day (AC#3). Advances
 * `lastCompletedDay`; marks the active-arc requirement met when one is seen; and
 * transitions to `completed` once the target day count is reached.
 */
export function recordWarmupDay(markers: WarmupMarkers, day: number, activeArcCount: number): WarmupMarkers {
  assertPhase(markers, ['running']);
  if (!Number.isSafeInteger(day) || day !== markers.lastCompletedDay + 1) {
    throw new WarmupError('WARMUP_DAY_OUT_OF_ORDER', 'warmup days must advance contiguously');
  }
  const next: WarmupMarkers = {
    ...markers,
    lastCompletedDay: day,
    activeArcRequirementMet: markers.activeArcRequirementMet || activeArcCount > 0,
  };
  if (next.lastCompletedDay >= markers.actualStartDay + markers.targetDayCount - 1) {
    next.phase = 'completed';
  }
  return next;
}

/** Mark the warmup failed (AC#5). Failure never publishes or pollutes public data. */
export function failWarmup(markers: WarmupMarkers, code: string): WarmupMarkers {
  assertPhase(markers, ['running', 'paused']);
  if (code.trim().length === 0) throw new WarmupError('WARMUP_INVALID', 'failure code is required');
  return { ...markers, phase: 'failed', failureCode: code };
}

/** System-recommended newcomer entry point (AC#4 system side). */
export function setRecommendedNewcomerEntry(markers: WarmupMarkers, entry: NewcomerEntry): WarmupMarkers {
  if (!Number.isSafeInteger(entry.episodeNumber) || entry.episodeNumber < 1
      || !Number.isSafeInteger(entry.worldDay) || entry.worldDay < markers.actualStartDay) {
    throw new WarmupError('WARMUP_INVALID', 'recommended entry must be a valid episode on or after the actual start day');
  }
  return { ...markers, recommendedNewcomerEntry: { ...entry } };
}

/**
 * Administrator confirms the public start day (AC#4). Sets both the confirmed
 * day and the public broadcast start day. Public broadcast may start after Day 1
 * (AC#9). This edits the marker ONLY — warmed Canon history is never rewritten.
 */
export function confirmPublicStartDay(markers: WarmupMarkers, day: number): WarmupMarkers {
  assertPhase(markers, ['completed']);
  if (!Number.isSafeInteger(day) || day < markers.actualStartDay) {
    throw new WarmupError('WARMUP_PUBLIC_START_INVALID', 'public start day must be on or after the actual start day');
  }
  if (!markers.activeArcRequirementMet) {
    throw new WarmupError('WARMUP_NO_ACTIVE_ARC', 'public start requires at least one Active Story Arc (AC#3)');
  }
  return { ...markers, confirmedPublicStartDay: day, publicBroadcastStartDay: day };
}

/**
 * Change the confirmed public start day after launch (AC#9). Edits the marker
 * only; never rewrites Canon history.
 */
export function changePublicStartDay(markers: WarmupMarkers, day: number): WarmupMarkers {
  if (markers.confirmedPublicStartDay === null) {
    throw new WarmupError('WARMUP_PUBLIC_START_INVALID', 'no confirmed public start day to change');
  }
  if (!Number.isSafeInteger(day) || day < markers.actualStartDay) {
    throw new WarmupError('WARMUP_PUBLIC_START_INVALID', 'public start day must be on or after the actual start day');
  }
  return { ...markers, confirmedPublicStartDay: day, publicBroadcastStartDay: day };
}

/**
 * Publication guard (AC#1/#5). Warmup content may reach the public read model
 * ONLY after the warmup completed AND an administrator confirmed the public
 * start day. Until then, warmup days remain invisible to public reads.
 */
export function canPublishWarmup(markers: WarmupMarkers): boolean {
  return markers.phase === 'completed' && markers.confirmedPublicStartDay !== null;
}
