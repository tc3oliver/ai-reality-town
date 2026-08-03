import {
  WARMUP_MAX_DAYS,
  WARMUP_MIN_DAYS,
  WarmupError,
  canPublishWarmup,
  changePublicStartDay,
  confirmPublicStartDay,
  createWarmupMarkers,
  failWarmup,
  pauseWarmup,
  recordWarmupDay,
  rerunWarmup,
  resumeWarmup,
  setRecommendedNewcomerEntry,
  type WarmupMarkers,
} from './warmup';

function fresh(over: Partial<WarmupMarkers> = {}): WarmupMarkers {
  return createWarmupMarkers({ worldId: 'w1', actualStartDay: 1, targetDayCount: 30, ...over } as never);
}

describe('createWarmupMarkers', () => {
  it('starts a warmup in the running phase with distinct §10.3 markers (AC#8)', () => {
    const markers = fresh();
    expect(markers.phase).toBe('running');
    expect(markers.actualStartDay).toBe(1);
    expect(markers.publicBroadcastStartDay).toBeNull();
    expect(markers.recommendedNewcomerEntry).toBeNull();
    expect(markers.confirmedPublicStartDay).toBeNull();
  });
  it('rejects a target day count outside 30–60', () => {
    expect(() => createWarmupMarkers({ worldId: 'w1', actualStartDay: 1, targetDayCount: WARMUP_MIN_DAYS - 1 })).toThrow(WarmupError);
    expect(() => createWarmupMarkers({ worldId: 'w1', actualStartDay: 1, targetDayCount: WARMUP_MAX_DAYS + 1 })).toThrow(WarmupError);
  });
});

describe('pause/resume/rerun (AC#2)', () => {
  it('pauses and resumes a running warmup', () => {
    const markers = fresh();
    expect(pauseWarmup(markers).phase).toBe('paused');
    expect(resumeWarmup(pauseWarmup(markers)).phase).toBe('running');
  });
  it('reruns from a chosen day', () => {
    const markers = rerunWarmup({ ...fresh(), lastCompletedDay: 10, phase: 'paused' }, 8);
    expect(markers.phase).toBe('running');
    expect(markers.lastCompletedDay).toBe(7);
  });
  it('rejects pause from a non-running phase', () => {
    expect(() => pauseWarmup({ ...fresh(), phase: 'paused' })).toThrow(WarmupError);
  });
});

describe('recordWarmupDay + active arc requirement (AC#3)', () => {
  it('completes after the target day count and records the active-arc requirement', () => {
    let markers = fresh();
    for (let day = 1; day <= 30; day += 1) {
      markers = recordWarmupDay(markers, day, day === 5 ? 1 : 0);
    }
    expect(markers.phase).toBe('completed');
    expect(markers.activeArcRequirementMet).toBe(true);
    expect(markers.lastCompletedDay).toBe(30);
  });
  it('rejects out-of-order days', () => {
    expect(() => recordWarmupDay(fresh(), 5, 0)).toThrow(WarmupError);
  });
});

describe('isolation + publication guard (AC#1/#5)', () => {
  it('forbids publication while warmup is incomplete, paused, failed, or unconfirmed', () => {
    expect(canPublishWarmup(fresh())).toBe(false); // running
    expect(canPublishWarmup({ ...fresh(), phase: 'completed' })).toBe(false); // completed but unconfirmed
    expect(canPublishWarmup({ ...fresh(), phase: 'failed', failureCode: 'x' })).toBe(false);
  });
  it('permits publication only after completion + admin confirmation', () => {
    const markers = confirmPublicStartDay({ ...fresh(), phase: 'completed', activeArcRequirementMet: true }, 30);
    expect(canPublishWarmup(markers)).toBe(true);
  });
  it('a failed warmup never reaches a publishable state (AC#5)', () => {
    const failed = failWarmup(fresh(), 'WARMUP_OUTAGE');
    expect(failed.phase).toBe('failed');
    expect(canPublishWarmup(failed)).toBe(false);
  });
});

describe('launch episode recommendation + confirmation (AC#4)', () => {
  it('stores the system-recommended entry then lets an admin confirm', () => {
    let markers = setRecommendedNewcomerEntry(fresh(), { episodeNumber: 1, worldDay: 1 });
    // advance to completed with an active arc
    for (let day = 1; day <= 30; day += 1) markers = recordWarmupDay(markers, day, day === 3 ? 1 : 0);
    markers = confirmPublicStartDay(markers, 30);
    expect(markers.recommendedNewcomerEntry).toEqual({ episodeNumber: 1, worldDay: 1 });
    expect(markers.confirmedPublicStartDay).toBe(30);
    expect(markers.publicBroadcastStartDay).toBe(30);
  });
  it('refuses to confirm before the active-arc requirement is met (AC#3)', () => {
    expect(() => confirmPublicStartDay({ ...fresh(), phase: 'completed', activeArcRequirementMet: false }, 30)).toThrow(WarmupError);
  });
});

describe('public start day marker (AC#9 — §10.3)', () => {
  it('public broadcast may start after Day 1', () => {
    const markers = confirmPublicStartDay({ ...fresh(), phase: 'completed', activeArcRequirementMet: true, lastCompletedDay: 30 }, 15);
    expect(markers.publicBroadcastStartDay).toBe(15);
    expect(markers.publicBroadcastStartDay).toBeGreaterThan(1);
  });
  it('changing the confirmed public start edits the marker only (no canon rewrite)', () => {
    const confirmed = confirmPublicStartDay({ ...fresh(), phase: 'completed', activeArcRequirementMet: true, lastCompletedDay: 30 }, 30);
    const changed = changePublicStartDay(confirmed, 20);
    expect(changed.publicBroadcastStartDay).toBe(20);
    expect(changed.actualStartDay).toBe(1); // warmed canon start untouched
    expect(changed.lastCompletedDay).toBe(30); // warmed history untouched
  });
  it('rejects a public start before the actual start day', () => {
    expect(() => confirmPublicStartDay({ ...fresh(), phase: 'completed', activeArcRequirementMet: true }, 0)).toThrow(WarmupError);
  });
});
