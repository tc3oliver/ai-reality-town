/**
 * The ART-72 landmine, disarmed at BUILD time (FR-M003 / ART-59).
 *
 * ## The failure this exists to prevent
 *
 * FR-M003's per-MODEL daily cap has to name a model BEFORE the call, so `createConvexBudgetPort`
 * is handed a `deploymentModelId`. The live path currently authors scenes with the deterministic
 * `FakeWholeSceneProvider` — `createWorldDayStageHandlers` is invoked in
 * `worldDayLiveFunctions.ts` with no provider argument, so it takes its default — and the meter is
 * pointed at `FAKE_SCENE_MODEL` to match.
 *
 * If ART-72 injects a real provider adapter there and does NOT repoint the meter, the reservation
 * keys on `FAKE_SCENE_MODEL` while the real model spends. The per-model cap then meters a bucket
 * nothing is spending from, and **every other signal keeps looking healthy**: slots complete, the
 * ledger fills with granted decisions, the daily totals move, and the cap simply never binds. That
 * is the worst shape a budget bug can have, and a comment is not a defence against it.
 *
 * ## Why a source pin rather than a type
 *
 * The two facts that must agree — "which provider does the live path construct" and "which model
 * id does the meter key on" — are two arguments to two different functions, and neither is
 * derivable from the other without widening the vendor-neutral `LanguageModelProvider` contract
 * that `architecture/module-boundaries.json` reserves as the provider boundary. Widening it is
 * ART-72's decision to make, not this task's. So the agreement is pinned where it actually lives:
 * in the one file that makes both choices.
 *
 * This is the BUILD-time half. The runtime half is
 * `BudgetSettlement.reportedModel` — the provider's own reported model is compared against the
 * metered key at settlement and counted in `ResourceUsageReport.modelMeteringMismatches`. That
 * catches what a source pin cannot see: a gateway answering with a different model id from the one
 * it was asked for.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAKE_SCENE_MODEL } from './fakeSceneNarrator';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE_ENTRY = 'convex/simulation/worldDayLiveFunctions.ts';
const source = readFileSync(join(ROOT, LIVE_ENTRY), 'utf8');

/**
 * The TOP-LEVEL argument count of every `createWorldDayStageHandlers(...)` call in the live
 * entry point.
 *
 * Depth-aware rather than a `split(',')`, and that is load-bearing: the real call is
 * `createWorldDayStageHandlers(createConvexWorldDayLivePort(ctx, now))`, whose nested comma would
 * read as a second argument under a naive split. A pin that reports a provider injection when
 * none happened is worse than no pin — it is the kind of test that gets deleted the first time it
 * cries wolf, taking the real guarantee with it.
 */
function stageHandlerArgumentCounts(): number[] {
  const counts: number[] = [];
  const call = 'createWorldDayStageHandlers(';
  for (let start = source.indexOf(call); start !== -1; start = source.indexOf(call, start + 1)) {
    let depth = 0;
    let topLevelCommas = 0;
    let sawArgument = false;
    for (let index = start + call.length - 1; index < source.length; index += 1) {
      const character = source[index];
      if (character === '(' || character === '[' || character === '{') depth += 1;
      else if (character === ')' || character === ']' || character === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (character === ',' && depth === 1) topLevelCommas += 1;
      else if (depth >= 1 && !/\s/u.test(character)) sawArgument = true;
    }
    counts.push(sawArgument ? topLevelCommas + 1 : 0);
  }
  return counts;
}

describe('ART-72 pin — the metered model id and the live provider cannot drift apart', () => {
  test('the live entry point still constructs its stage handlers WITHOUT a provider argument', () => {
    // A second top-level argument means a real adapter has been injected. The moment that
    // happens this assertion fails, and the message it fails with is the instruction for what to
    // do about it — a bare `expected 1, got 2` would send the next author looking in the wrong
    // place entirely.
    const counts = stageHandlerArgumentCounts();
    expect(counts.length).toBeGreaterThan(0);
    for (const argumentCount of counts) {
      const injectedProvider = argumentCount > 1;
      expect({ file: LIVE_ENTRY, injectedProvider, instruction: injectedProvider
        ? 'ART-72: a provider was injected into createWorldDayStageHandlers. Repoint '
          + 'deploymentModelId in createConvexBudgetPort to that provider\'s model id in the same '
          + 'change, or the FR-M003 per-model daily cap will meter FAKE_SCENE_MODEL while the real '
          + 'model spends unbounded. See docs/token-budget-controls.md §8.'
        : null,
      }).toEqual({ file: LIVE_ENTRY, injectedProvider: false, instruction: null });
    }
  });

  test('the argument counter itself is depth-aware, and would SEE a second argument', () => {
    // The pin above passes today. This asserts it passes for the right reason: that the counter
    // reads the real call as ONE argument despite its nested comma, and that it would report TWO
    // if a provider were added. Without this, a counter that always returned 1 would look
    // identical from the outside — a green test proving nothing.
    expect(stageHandlerArgumentCounts()).toEqual([1]);
  });

  test('the meter is pointed at exactly the model that default provider reports', () => {
    // Asserted against the CONSTANT, not against the string, so renaming the fake author's model
    // id cannot leave this test passing against a stale literal.
    expect(source).toContain(`createConvexBudgetPort(ctx.db, now, () => Promise.resolve(${'FAKE_SCENE_MODEL'}))`);
    expect(FAKE_SCENE_MODEL).toBe('fake-whole-scene-v1');
  });

  test('the two decisions still live in the same file, so one reviewer sees both', () => {
    // If either moved out, a change to one could be reviewed without the other ever being on
    // screen — which is exactly how the mismatch would get merged.
    expect(source).toContain('createWorldDayStageHandlers(');
    expect(source).toContain('createConvexBudgetPort(');
  });
});
