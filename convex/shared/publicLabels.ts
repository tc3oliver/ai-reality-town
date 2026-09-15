/**
 * zh-Hant labels for the values a public surface would otherwise print raw (ART-183).
 *
 * The UI is zh-Hant with no i18n framework (CLAUDE.md §9), which works as long as every string a
 * viewer reads was WRITTEN for them. Three kinds of value are not: a `TimeSlot`, whose wire form
 * is an English identifier; a fact's `predicate`, which is a schema key; and a list of names,
 * whose separator differs between the two scripts. Each one reached the live pages — the home
 * page rendered 「第 3 天 / night」, the onboarding summary rendered
 * 「已知事實:currentArcPremise是…」 — so this module exists to give all three one answer.
 *
 * In `shared` because the callers are on both sides of the wire and in five modules. `shared`
 * has `mayDependOn: []` in `architecture/module-boundaries.json` and is listed by `simulation`,
 * `editorial`, `publicRead`, `operations`, `clientPublic` and `clientLive` — it is the only place
 * a label can live where the author that writes a string and the component that renders one can
 * reach the same table. The alternative, which is what the repo did before this task, is a
 * private map per module: `convex/simulation/rulesOnlyAuthor.ts` already held the correct
 * zh-Hant time-slot map, in a module no public surface is allowed to import.
 *
 * Pure: no clock, no randomness, no I/O, and — by the boundary above — no imports at all.
 */

/**
 * Time slots, in world order.
 *
 * Declared here rather than imported because `shared` may depend on nothing, and the union lives
 * in `convex/canon/eventTypes.ts`. That duplication is checked, not trusted:
 * `publicLabels.test.ts` imports `TIME_SLOTS` from canon and this list from here and asserts they
 * cover each other exactly, so adding a slot without a label fails a NAMED test rather than
 * printing an English identifier to a viewer.
 */
export const LABELLED_TIME_SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const;

export type LabelledTimeSlot = (typeof LABELLED_TIME_SLOTS)[number];

const TIME_SLOT_LABELS: Readonly<Record<LabelledTimeSlot, string>> = {
  morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜間',
};

/**
 * A time slot, said in Chinese.
 *
 * Total on purpose. An unrecognised slot yields the raw value rather than throwing, because this
 * is called on a read path: a world day that somehow carries an unknown slot should still render
 * a page. The unknown case is visible — it is the only way an English identifier can appear — and
 * the test above is what keeps it unreachable for the slots this codebase actually produces.
 */
export function timeSlotLabel(slot: string): string {
  return TIME_SLOT_LABELS[slot as LabelledTimeSlot] ?? slot;
}

/**
 * Fact predicates that are IDENTITY, not news.
 *
 * `name` and `age` arrive as `fact_created` state changes like any other fact — that is how
 * `characterSourceFrom` in `convex/publicRead/worldCharacterProjectionFunctions.ts` learns a
 * character's name at all. They are therefore indistinguishable from a fact at the point the
 * onboarding summary collects them, which is how 「已知事實:…name是Zhao Ming、age是41」 reached
 * the home page: the viewer was told, as news, that a person has a name.
 *
 * Kept as data rather than inlined in the one caller because the character projection and the
 * onboarding summary have to agree about which predicates are identity. They disagreed before
 * this task.
 */
export const IDENTITY_FACT_PREDICATES: readonly string[] = ['name', 'age'];

/**
 * A fact predicate, said in Chinese — or `null` when this module has never heard of it.
 *
 * `null` rather than the raw key is the whole point. A predicate is LLM-authored public text
 * (`onboardingSummaryFunctions.ts` says so where it collects them), so the vocabulary is OPEN and
 * no registry can ever be complete. A registry that fell back to the key would therefore keep
 * printing camelCase to viewers for every predicate the model invents next — which is exactly
 * what `currentArcPremise是` was.
 *
 * The caller's rule for `null` is stated at the call site: render the VALUE alone. That is safe
 * because the value is itself public prose written for a reader, while the predicate is a key
 * written for a database.
 */
export function factPredicateLabel(predicate: string): string | null {
  return FACT_PREDICATE_LABELS[predicate] ?? null;
}

const FACT_PREDICATE_LABELS: Readonly<Record<string, string>> = {
  name: '姓名',
  age: '年齡',
  occupation: '職業',
  lastKnownLocation: '最後已知位置',
  lastRoutineSlot: '最近例行時段',
  weather: '天氣',
  power: '電力',
  road_access: '道路通行',
  visitors: '訪客',
  festival: '節慶',
  factory: '工廠',
  press_desk: '媒體',
};

/** Join names the way Chinese does. A comma-space list reads as English even when the names do not. */
export function formatNameList(names: readonly string[]): string {
  return names.filter((name) => name.trim().length > 0).join('、');
}
