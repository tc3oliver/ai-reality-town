/**
 * FR-F006 Arc Heat Score (ART-32).
 *
 * The cases are grouped by the acceptance criterion they settle rather than by function, because
 * two of the three criteria are about the score being INSPECTABLE rather than about its value:
 *
 *   AC#1 「Score 計算可追蹤」 — the score is a pure function of stated inputs, every component
 *         carries its own evidence, and the same inputs produce the same digest.
 *   AC#2 「首頁排序不得完全由 LLM 自由決定」 — the ordering is a total, deterministic comparator
 *         over a number the pipeline computed, not a ranking the model returned.
 *   AC#3 「管理者可查看分數構成」 — every one of the six signals is reported separately, including
 *         the ones that could not be measured, with the reason.
 */

import { selectHomepageArc, type ArcPortfolioEntry } from './portfolio';
import {
  ARC_CLIMAX_PROXIMITY,
  ARC_FRESHNESS_WINDOW_DAYS,
  ARC_HEAT_COMPONENTS,
  ARC_HEAT_DEFINITION_VERSION,
  ARC_HEAT_WEIGHTS,
  ARC_INTERACTION_SATURATION,
  compareArcsByHeat,
  computeArcHeat,
  initialArcHeat,
  type ArcHeatInput,
} from './heat';

const base: ArcHeatInput = {
  worldId: 'mistwood',
  arcId: 'arc:mill',
  status: 'active',
  currentWorldDay: 10,
  lastProgressWorldDay: 10,
  eventImportance: 0.5,
  sourceEventId: 'mistwood#event#42',
  coreCharacterIds: ['pei-lan', 'wu-zhen'],
  eventParticipantIds: ['pei-lan'],
  unresolvedQuestionCount: 1,
  viewerInteractionCount: 5,
};

const heat = (over: Partial<ArcHeatInput> = {}) => computeArcHeat({ ...base, ...over });
const componentOf = (input: Partial<ArcHeatInput>, key: string) =>
  heat(input).components.find((component) => component.key === key);

describe('AC#1 — the score is traceable', () => {
  it('reports every one of FR-F006 six signals, in the order the requirement lists them', () => {
    expect(heat().components.map((component) => component.key)).toEqual([...ARC_HEAT_COMPONENTS]);
    expect(ARC_HEAT_COMPONENTS).toHaveLength(6);
  });

  it('weights sum to one, so the composite is a mean rather than an arbitrary scale', () => {
    const total = Object.values(ARC_HEAT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });

  it('is a pure function: the same inputs produce the same score and the same digest', () => {
    const first = heat();
    const second = heat();
    expect(second.score).toBe(first.score);
    expect(second.digest).toBe(first.digest);
    expect(second).toEqual(first);
  });

  it('changes the digest when any component changes, so a stored breakdown can be re-checked', () => {
    expect(heat({ eventImportance: 0.9 }).digest).not.toBe(heat().digest);
    expect(heat({ status: 'climax' }).digest).not.toBe(heat().digest);
  });

  it('carries the source event on the component that read it', () => {
    expect(componentOf({}, 'recent_importance')?.evidence)
      .toMatchObject({ sourceEventId: 'mistwood#event#42' });
  });

  it('carries only ids, counts and world days as evidence — never narrative text', () => {
    for (const component of heat().components) {
      for (const value of Object.values(component.evidence)) {
        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) {
          if (typeof entry !== 'string') continue;
          // Every string in evidence is an identifier or a status token. A summary, a question or
          // a scene would be publishable content reaching an operator surface by the side door.
          expect(entry).toMatch(/^[a-z0-9:#_-]+$/i);
        }
      }
    }
  });

  it('stamps the definition version, so a stored score says which rules produced it', () => {
    expect(heat().definitionVersion).toBe(ARC_HEAT_DEFINITION_VERSION);
  });
});

describe('the six signals each move the score, and only in the direction they should', () => {
  it('rises with the importance of the event that advanced the arc', () => {
    expect(heat({ eventImportance: 0.9 }).score).toBeGreaterThan(heat({ eventImportance: 0.1 }).score);
  });

  it('rises with unresolved tension', () => {
    expect(heat({ unresolvedQuestionCount: 3 }).score).toBeGreaterThan(heat({ unresolvedQuestionCount: 0 }).score);
  });

  it('rises when more of the arc own core cast is in the event', () => {
    const all = heat({ eventParticipantIds: ['pei-lan', 'wu-zhen'] });
    const none = heat({ eventParticipantIds: ['he-jun'] });
    expect(all.score).toBeGreaterThan(none.score);
    // Measured as a SHARE of the arc's own cast, so a two-character arc and a six-character arc
    // are comparable.
    expect(componentOf({ eventParticipantIds: ['pei-lan', 'wu-zhen'] }, 'core_attention')?.value).toBe(1);
  });

  it('rises with viewer interaction, and saturates rather than growing without bound', () => {
    expect(heat({ viewerInteractionCount: 10 }).score).toBeGreaterThan(heat({ viewerInteractionCount: 0 }).score);
    expect(componentOf({ viewerInteractionCount: ARC_INTERACTION_SATURATION * 5 }, 'viewer_interaction')?.value)
      .toBe(1);
  });

  it('falls as the arc goes untouched, and reaches zero at the freshness window', () => {
    const fresh = heat({ lastProgressWorldDay: 10, currentWorldDay: 10 });
    const stale = heat({ lastProgressWorldDay: 10, currentWorldDay: 10 + ARC_FRESHNESS_WINDOW_DAYS });
    expect(stale.score).toBeLessThan(fresh.score);
    expect(componentOf({ lastProgressWorldDay: 10, currentWorldDay: 10 + ARC_FRESHNESS_WINDOW_DAYS }, 'freshness')?.value)
      .toBe(0);
    // Past the window it stays at zero rather than going negative and dragging the composite down.
    expect(componentOf({ lastProgressWorldDay: 0, currentWorldDay: 100 }, 'freshness')?.value).toBe(0);
  });

  it('peaks at the climax and drops to zero once the arc has resolved', () => {
    expect(heat({ status: 'climax' }).score).toBeGreaterThan(heat({ status: 'emerging' }).score);
    expect(ARC_CLIMAX_PROXIMITY.climax).toBe(1);
    // 「是否接近高潮」 asks how much is still coming. A resolved arc has none of it left, so it
    // must not hold the homepage against arcs that are still moving.
    expect(ARC_CLIMAX_PROXIMITY.resolved).toBe(0);
    expect(ARC_CLIMAX_PROXIMITY.archived).toBe(0);
    expect(heat({ status: 'resolved' }).score).toBeLessThan(heat({ status: 'resolving' }).score);
  });

  it('is not the old score: importance alone no longer decides it', () => {
    // Before ART-32 this was `Math.round(importance * 100)`, so these two would both be 80.
    const climax = heat({ eventImportance: 0.8, status: 'climax', unresolvedQuestionCount: 3 });
    const emerging = heat({ eventImportance: 0.8, status: 'emerging', unresolvedQuestionCount: 0 });
    expect(climax.score).not.toBe(emerging.score);
    expect(climax.score).not.toBe(80);
  });
});

describe('AC#3 — a signal that could not be measured is reported, not counted as zero', () => {
  it('reports viewer interaction as unmeasured when no rollup was supplied', () => {
    const component = componentOf({ viewerInteractionCount: null }, 'viewer_interaction');
    expect(component?.status).toBe('no_observations');
    expect(component?.value).toBeNull();
    expect(component?.unmeasuredReason).toBeTruthy();
  });

  it('renormalises, so an unobservable signal does not depress every arc equally', () => {
    // Zero interactions and no rollup are different states. Scored as zero they would order arcs
    // identically while meaning opposite things, and only one is something to act on.
    const unmeasured = heat({ viewerInteractionCount: null });
    const zero = heat({ viewerInteractionCount: 0 });
    expect(unmeasured.score).toBeGreaterThan(zero.score);
    expect(unmeasured.measuredWeight).toBeCloseTo(1 - ARC_HEAT_WEIGHTS.viewer_interaction, 6);
    expect(zero.measuredWeight).toBe(1);
  });

  it('reports core attention as unmeasured when the arc declares no core characters', () => {
    const component = componentOf({ coreCharacterIds: [] }, 'core_attention');
    expect(component?.status).toBe('no_observations');
    expect(component?.value).toBeNull();
    // A share of an empty cast has no value; scoring it 0 would rank the arc below one whose core
    // cast simply was not in this scene.
    expect(component?.unmeasuredReason).toMatch(/denominator/);
  });

  it('keeps every score inside the range the projection validator already enforces', () => {
    const extremes: Array<Partial<ArcHeatInput>> = [
      { eventImportance: 5, unresolvedQuestionCount: 99, viewerInteractionCount: 10_000, status: 'climax' },
      { eventImportance: -3, unresolvedQuestionCount: 0, viewerInteractionCount: 0, status: 'archived', currentWorldDay: 900 },
      { eventImportance: Number.NaN, viewerInteractionCount: null, coreCharacterIds: [] },
    ];
    for (const over of extremes) {
      const score = heat(over).score;
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('AC#2 — the homepage ordering is decided by rules, not by a model', () => {
  it('orders by heat and breaks every tie deterministically', () => {
    const arcs = [
      { arcId: 'arc:c', heatScore: 40 },
      { arcId: 'arc:a', heatScore: 90 },
      { arcId: 'arc:b', heatScore: 40 },
    ];
    expect([...arcs].sort(compareArcsByHeat).map((arc) => arc.arcId)).toEqual(['arc:a', 'arc:b', 'arc:c']);
    // Shuffled input, same output: the order is a property of the arcs rather than of the query
    // that happened to return them.
    expect([...arcs].reverse().sort(compareArcsByHeat).map((arc) => arc.arcId)).toEqual(['arc:a', 'arc:b', 'arc:c']);
  });
});

/**
 * The wiring, not the arithmetic: FR-F006 is only delivered if the score the pipeline STORES is
 * this one. `postCommitLive.test.ts` covers `nextArcProjectionFields`'s field output; these two
 * cases cover the two ends the field output does not touch — the counter the 觀眾互動 signal reads,
 * and the fact that the projection's `heatScore` is the composite rather than the old
 * `round(importance * 100)`.
 */
describe('the signal the deployment has to observe (ART-32)', () => {
  type Row = Record<string, unknown> & { _id: string };

  function fakeDb() {
    const rows: Row[] = [];
    let counter = 0;
    return {
      rows,
      insert(table: string, doc: Record<string, unknown>) {
        rows.push({ ...doc, _id: `${table}:${(counter += 1)}` });
        return Promise.resolve(rows[rows.length - 1]._id);
      },
      patch(id: string, patch: Record<string, unknown>) {
        const row = rows.find((candidate) => candidate._id === id);
        if (!row) throw new Error('no such row');
        Object.assign(row, patch);
        return Promise.resolve();
      },
      query() {
        return {
          withIndex(_index: string, build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) {
            const constraints: [string, unknown][] = [];
            const builder = { eq: (field: string, value: unknown) => { constraints.push([field, value]); return builder; } };
            build(builder);
            return {
              unique: () => Promise.resolve(
                rows.find((row) => constraints.every(([field, value]) => row[field] === value)) ?? null),
            };
          },
        };
      },
    };
  }

  const bump = async (db: ReturnType<typeof fakeDb>, eventName: string, payload: Record<string, unknown>) => {
    const { bumpArcInteraction } = await import('../analytics/ingestFunctions');
    await bumpArcInteraction(
      { db: db as never }, 'mistwood', { eventName, payload }, 1_000);
  };

  it('counts each arc interaction once, and accumulates across events', async () => {
    const db = fakeDb();
    await bump(db, 'story_arc_viewed', { worldId: 'mistwood', arcId: 'arc:mill' });
    await bump(db, 'live_arc_opened', { worldId: 'mistwood', arcId: 'arc:mill' });
    await bump(db, 'story_arc_followed', { worldId: 'mistwood', arcId: 'arc:mill', followed: false });
    expect(db.rows).toHaveLength(1);
    // Un-following counts: interaction is attention, and a rollup that ignored the negative
    // direction would report an arc people are abandoning as one nobody has an opinion about.
    expect(db.rows[0]).toMatchObject({ arcId: 'arc:mill', interactions: 3 });
  });

  it('counts nothing for an event that names no arc', async () => {
    const db = fakeDb();
    await bump(db, 'episode_viewed', { worldId: 'mistwood', worldDay: 4 });
    await bump(db, 'story_arc_viewed', { worldId: 'mistwood' });
    expect(db.rows).toEqual([]);
  });

  it('keeps arcs apart', async () => {
    const db = fakeDb();
    await bump(db, 'story_arc_viewed', { worldId: 'mistwood', arcId: 'arc:mill' });
    await bump(db, 'story_arc_viewed', { worldId: 'mistwood', arcId: 'arc:truce' });
    expect(db.rows.map((row) => row.interactions)).toEqual([1, 1]);
  });
});


/**
 * The score is the composite EVERYWHERE it is written (ART-170).
 *
 * ART-32 replaced the `Math.round(importance * 100)` stand-in in the update path and left it at the
 * three places an arc is created, so a new arc carried the pre-ART-32 score until its first
 * revision — two scoring rules under one field name, and the one a brand-new arc got was the old one.
 */
describe('an arc is created at the same composite it is updated at', () => {
  const creation = {
    worldId: 'mistwood', arcId: 'arc:new', status: 'emerging' as const, worldDay: 4,
    eventImportance: 0.8, sourceEventId: 'mistwood#event#9',
    coreCharacterIds: ['pei-lan', 'wu-zhen'], eventParticipantIds: ['pei-lan'],
    unresolvedQuestionCount: 1,
  };

  it('is not the old stand-in', () => {
    // `Math.round(0.8 * 100)` is 80. An emerging arc with one open question and no viewer rollup is
    // not at 80, and the whole point of ART-32 is that it should not be.
    expect(initialArcHeat(creation).score).not.toBe(80);
  });

  it('reports the same six components the update path reports', () => {
    expect(initialArcHeat(creation).components.map((component) => component.key))
      .toEqual([...ARC_HEAT_COMPONENTS]);
  });

  it('is maximally fresh, because it just happened', () => {
    const freshness = initialArcHeat(creation).components
      .find((component) => component.key === 'freshness');
    expect(freshness?.value).toBe(1);
    expect(freshness?.evidence).toMatchObject({ daysSinceProgress: 0 });
  });

  it('consults no viewer rollup, and says so rather than scoring zero', () => {
    const interaction = initialArcHeat(creation).components
      .find((component) => component.key === 'viewer_interaction');
    expect(interaction?.status).toBe('no_observations');
    expect(interaction?.value).toBeNull();
  });

  it('agrees with computeArcHeat given the same facts', () => {
    // The creation helper is a way of stating a new arc's facts, not a second scoring rule.
    expect(initialArcHeat(creation).score).toBe(computeArcHeat({
      ...creation, currentWorldDay: creation.worldDay, lastProgressWorldDay: creation.worldDay,
      viewerInteractionCount: null,
    }).score);
  });
});

/**
 * The heat ordering has one definition, and both surfaces obey it (ART-170).
 *
 * ART-32 exported `compareArcsByHeat` as that definition and wired nothing to it, while
 * `candidateArcs` wrote the identical comparator out inline. This asserts the property that matters
 * — the two surfaces cannot disagree about which of two arcs is hotter — rather than asserting that
 * a particular function is called, which a refactor could satisfy while breaking the agreement.
 */
describe('the homepage selector and the comparator cannot disagree', () => {
  const entry = (arcId: string, heatScore: number): ArcPortfolioEntry => ({
    projection: {
      schemaVersion: 1, worldId: 'mistwood', arcId, title: arcId, premise: 'p',
      currentQuestion: 'q', status: 'active', coreCharacterIds: ['pei-lan'],
      incitingEventId: 'mistwood#event#0', latestTurningPointEventId: null, essentialFactIds: [],
      unresolvedQuestions: ['q'], resolvedQuestions: [], recommendedEntryEventId: null,
      heatScore, lastProgressTime: { worldDay: 1, timeSlot: 'morning', sourceEventId: 'mistwood#event#0' },
      revision: 0,
    },
    tier: 'major', priority: 50, published: true, sourceEventIds: ['mistwood#event#0'],
  });

  it('picks the arc the comparator ranks first, ties included', () => {
    const hotter = entry('arc:b', 90);
    const cooler = entry('arc:a', 40);
    expect(selectHomepageArc([cooler, hotter])?.arcId).toBe('arc:b');
    expect([cooler, hotter].map((candidate) => ({
      arcId: candidate.projection.arcId, heatScore: candidate.projection.heatScore,
    })).sort(compareArcsByHeat)[0].arcId).toBe('arc:b');

    // A tie falls to the arc id, in both places, so the same two arcs order the same way.
    const tiedA = entry('arc:a', 70);
    const tiedB = entry('arc:b', 70);
    expect(selectHomepageArc([tiedB, tiedA])?.arcId).toBe('arc:a');
  });
});
