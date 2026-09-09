/**
 * FR-I005's last two public fields: 觀眾已知秘密 and 角色不知道但觀眾知道的資訊 (ART-169).
 *
 * Pure module — no Convex, no clock, no randomness, no I/O. The Convex wiring
 * ({@link ./viewerKnowledgeProjectionFunctions.ts}) does the reading; every rule about what a
 * viewer may be told lives here, where it can be broken on purpose and watched to fail.
 *
 * ## There is no second secret store, and that is the whole design
 *
 * A `worldSecrets` row is SEED data: `{ secretId, content, initialKnowerCharacterIds }`, written
 * once by `importWorld` and never touched again. No event creates a secret, no state change
 * reveals one, and nothing anywhere carries a "revealed" flag. So "the viewer knows this secret"
 * cannot be read — it has to be DERIVED, and it is derived by joining three things that already
 * exist:
 *
 *   Canon's public facts  ×  the editorial publication lifecycle  ×  the safety gate
 *
 * A secret is viewer-known exactly when some accepted event created a PUBLIC Canon fact that
 * quotes the secret's content, that event was cited by an Episode whose current publication
 * record is `published`, and that event's Scene is not currently withheld. Each of the three is
 * an existing answer owned by an existing module; this file is the join, not a fourth opinion.
 *
 * The rule for "a fact quotes this secret" is `quotesSecret` in `convex/shared/secretText.ts` —
 * the same primitive `convex/quality/continuity.ts` scans leaks with. Two copies of that rule
 * would eventually disagree about which strings count, and the disagreement would be invisible:
 * the leak detector would clear a publication that this projection had already published.
 *
 * ## `ready` is not `published`, and the difference is the point
 *
 * The publication lifecycle has seven statuses and only ONE of them releases content to a viewer.
 * `generated`, `validated`, `safety_review` and `ready` are all states in which an Episode exists
 * and no viewer has been shown it; `withheld` and `superseded` are states in which one was shown
 * something and is not any more. Treating `ready` as good enough is the single most likely way
 * this file could leak an unrevealed secret, because `ready` is where the automated pipeline
 * STOPS — FR-K004 reserves `publish` for an administrator — so it is the status almost every
 * Episode in a running world is sitting in. {@link VIEWER_VISIBLE_PUBLICATION_STATUSES} is
 * therefore a one-element list rather than an inline `=== 'published'`, so that widening it is a
 * deliberate edit to a named constant with a test on it.
 *
 * The consequence is stated rather than hidden: until an administrator publishes an Episode,
 * every payload this builds is empty. That is the correct behaviour for the rule FR-I005's
 * 不得公開 list demands, and the reachability of the administrator's own action is a separate
 * concern from whether this join is right.
 *
 * ## Dramatic irony is a difference, computed in one direction only
 *
 * 角色不知道但觀眾知道的資訊 = the facts a viewer can see published MINUS the facts this
 * character's knowledge ledger holds. Nothing here writes to the ledger, and nothing here reads
 * `projection.rumors` or any private fact at all — so "a private rumor belief leaked into the
 * public payload" is not a case that is checked and rejected, it is a case that has no code path.
 * That is deliberate: a check can be removed, a missing dependency cannot.
 */

import { quotesSecret } from '../shared/secretText';

export const VIEWER_KNOWLEDGE_SCHEMA_VERSION = 1;

/** The published read-model kind. Registered in `./readModel.ts`, `./schema.ts`, `./readModelFunctions.ts`. */
export const VIEWER_KNOWLEDGE_MODEL_KIND = 'viewerKnowledge' as const;

/**
 * The publication statuses under which a viewer has actually been shown the content.
 *
 * ONE entry, on purpose. See this module's header: `ready` is where the automated pipeline stops,
 * so admitting it would make every Episode in every running world count as released.
 */
export const VIEWER_VISIBLE_PUBLICATION_STATUSES: readonly string[] = ['published'];

/**
 * Canon fact visibilities that reach a public read model.
 *
 * `canon` is admitted for dramatic irony because `publicFactsFrom` and `characterSourceFrom`
 * (`./worldCharacterProjectionFunctions.ts`) both publish it — a viewer can already see those
 * facts, so calling them invisible here would report irony that is not ironic.
 *
 * It is NOT admitted as a secret reveal (see {@link SECRET_REVEALING_VISIBILITY}). The asymmetry
 * is deliberate and one-directional: admitting less makes a secret less likely to be called
 * viewer-known, which is the safe direction for the one field FR-I005 forbids getting wrong.
 */
export const PUBLIC_FACT_VISIBILITIES: readonly string[] = ['public', 'canon'];

/** The only visibility that counts as revealing a secret — `continuity`'s rule, unchanged. */
export const SECRET_REVEALING_VISIBILITY = 'public';

/** Most secrets one character's page will name. Beyond this the count is published, not the row. */
export const MAX_VIEWER_KNOWN_SECRETS = 20;

/** Most dramatic-irony facts one character's page will name. */
export const MAX_DRAMATIC_IRONY_FACTS = 24;

/** A world secret as this projection reads one. `content` is a needle on the way in. */
export type SecretInput = {
  secretId: string;
  content: string;
  /** Characters the secret belongs to — `initialKnowerCharacterIds` in the world config. */
  holderCharacterIds: readonly string[];
};

/** A Canon fact as this projection reads one, straight off `WorldProjection.facts`. */
export type ProjectedFactInput = {
  factId: string;
  subjectType: string;
  subjectId: string;
  predicate: string;
  value: string | number | boolean;
  visibility: string;
  validFromEventId: string;
  /** Non-null once Canon has closed the fact out. A closed fact is not current. */
  validUntilEventId: string | null;
};

/**
 * One accepted event that an Episode cited, with the publication record that cited it.
 *
 * `publicationStatus` is carried rather than pre-filtered so the status rule is applied HERE,
 * where it can be broken on purpose. A caller that handed this function only the already-published
 * events would make {@link VIEWER_VISIBLE_PUBLICATION_STATUSES} unfalsifiable.
 */
export type CitedEventInput = {
  eventId: string;
  worldDay: number;
  /** `episode:<worldId>:<worldDay>`. */
  publicationRef: string;
  publicationStatus: string;
  /** The Scene that produced the event, or `null` for seed / system / pre-ART-132 events. */
  sceneId: string | null;
};

export type ViewerKnownSecret = {
  secretId: string;
  /** The secret itself. Only ever copied from a secret that passed every gate above. */
  content: string;
  /** The accepted event whose public fact said it out loud. */
  revealingEventId: string;
  revealedOnWorldDay: number;
  /** The publication record that released the revealing event. */
  publicationRef: string;
};

export type DramaticIronyFact = {
  factId: string;
  subjectType: string;
  subjectId: string;
  predicate: string;
  value: string | number | boolean;
  revealingEventId: string;
  revealedOnWorldDay: number;
  publicationRef: string;
};

export type ViewerKnowledgeProjection = {
  schemaVersion: typeof VIEWER_KNOWLEDGE_SCHEMA_VERSION;
  worldId: string;
  characterId: string;
  viewerKnownSecrets: ViewerKnownSecret[];
  dramaticIronyFacts: DramaticIronyFact[];
  /**
   * What the caps left out. Truncation is never silent (CLAUDE.md §9): a page that shows twenty
   * of thirty secrets and says nothing has told the viewer something false about the other ten.
   */
  omittedSecretCount: number;
  omittedIronyFactCount: number;
  /**
   * Rows dropped because their own text quoted a secret nothing published (AC#3).
   *
   * Not the same as an omission and not the same as an error. The reachable case is a `canon`-
   * visibility fact: {@link PUBLIC_FACT_VISIBILITIES} admits it as dramatic irony because a
   * viewer can already see it, while {@link SECRET_REVEALING_VISIBILITY} does not admit it as a
   * reveal — so such a fact can be publishable in itself and still be the only thing in the world
   * saying a secret out loud. Dropping the row is the fail-closed answer; counting it is what
   * stops the drop from being silent.
   */
  redactedRowCount: number;
  /**
   * How far back the build could see, published rather than assumed.
   *
   * The wiring reads a BOUNDED window of the newest published world days, so an old published day
   * can fall out of range. `consideredWorldDays` is how many published days were in range and
   * `oldestConsideredWorldDay` is the earliest of them, so a viewer-known secret that is absent
   * because it was revealed before the window can be told apart from one that was never revealed.
   */
  consideredWorldDays: number;
  oldestConsideredWorldDay: number | null;
};

export class ViewerKnowledgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ViewerKnowledgeError';
  }
}

/**
 * The cited events a viewer has actually been shown: published, and not withheld.
 *
 * Both halves are required and neither implies the other. A `published` Episode can cite an event
 * whose Scene an operator withheld afterwards — publication and the safety gate are independent
 * lifecycles by design (FR-K004), and a retroactive withhold does not walk the publication record
 * backwards. An event with no Scene provenance is NOT withheld, which is ART-132's stated
 * convention: silence from the classifier means "never in scope", not "refused".
 */
export function viewerVisibleEvents(
  cited: readonly CitedEventInput[],
  withheldSceneIds: ReadonlySet<string>,
): Map<string, CitedEventInput> {
  const visible = new Map<string, CitedEventInput>();
  for (const event of cited) {
    if (!VIEWER_VISIBLE_PUBLICATION_STATUSES.includes(event.publicationStatus)) continue;
    if (event.sceneId !== null && withheldSceneIds.has(event.sceneId)) continue;
    // First citation wins: an event cited by two Episodes was released by the earlier one, and
    // the map is only ever asked "was this released, and by what".
    if (!visible.has(event.eventId)) visible.set(event.eventId, event);
  }
  return visible;
}

/** A fact that is on the public surface right now — public/canon visibility, not closed out. */
function isCurrentPublicFact(fact: ProjectedFactInput): boolean {
  return PUBLIC_FACT_VISIBILITIES.includes(fact.visibility) && fact.validUntilEventId === null;
}

/**
 * Every secret in the world that a viewer-visible event has revealed, whoever holds it.
 *
 * World-scoped rather than per character, because the guard that keeps unrevealed secret TEXT out
 * of a payload ({@link unrevealedSecretsInPayload}) has to ask about every secret, not just this
 * character's: an irony fact about Character A can legitimately quote Character B's already-
 * published secret, and refusing that would be wrong while refusing an unrevealed one is right.
 *
 * The revealing fact must be CURRENT. A correction that closes the fact out leaves Canon no
 * longer asserting it, and republishing the secret from a closed fact would be this projection
 * asserting something its source has withdrawn. Conservative in the safe direction, and
 * deterministic under correction / supersession, which is what FR-I005 needs.
 */
export function revealedSecrets(
  secrets: readonly SecretInput[],
  facts: readonly ProjectedFactInput[],
  visibleEvents: ReadonlyMap<string, CitedEventInput>,
): Map<string, { secret: SecretInput; event: CitedEventInput; fact: ProjectedFactInput }> {
  const revealed = new Map<string, { secret: SecretInput; event: CitedEventInput; fact: ProjectedFactInput }>();
  for (const secret of secrets) {
    for (const fact of facts) {
      if (fact.visibility !== SECRET_REVEALING_VISIBILITY) continue;
      if (fact.validUntilEventId !== null) continue;
      if (!quotesSecret(fact.value, secret.content)) continue;
      const event = visibleEvents.get(fact.validFromEventId);
      if (event === undefined) continue;
      // `facts` is the reducer's append-only log, so the first match is the earliest reveal.
      revealed.set(secret.secretId, { secret, event, fact });
      break;
    }
  }
  return revealed;
}

/**
 * Drop every row whose own text quotes a secret nothing published (AC#3).
 *
 * Generic over the row type and driven by the row's JSON form rather than by a named field,
 * because the thing being protected against is a secret arriving through a field this function
 * was not written to look at. A per-field check would have to be extended every time a row grows
 * a string, and the extension is exactly what would be forgotten.
 */
export function redactUnrevealedSecrets<Row>(
  rows: readonly Row[],
  unrevealed: readonly SecretInput[],
): { kept: Row[]; redacted: number } {
  if (unrevealed.length === 0) return { kept: [...rows], redacted: 0 };
  const kept = rows.filter((row) => {
    const text = JSON.stringify(row);
    return !unrevealed.some((secret) => quotesSecret(text, secret.content));
  });
  return { kept, redacted: rows.length - kept.length };
}

/**
 * Which secrets appear, in the clear, in an already-built payload without having been revealed.
 *
 * The BACKSTOP, not the enforcement. {@link redactUnrevealedSecrets} is what actually keeps an
 * unrevealed secret out, row by row, and it covers every row in both lists — so against today's
 * payload shape this function cannot find anything, and saying otherwise would be the kind of
 * claim this repository has shipped before and had to correct.
 *
 * It is here for the payload shape that does not exist yet. The rows are not the only place text
 * can live: the next field added to {@link ViewerKnowledgeProjection} — a headline, a scope
 * sentence, a quoted excerpt — is outside the row filter by construction, and this is the check
 * that would catch it on the day it is added rather than after it ships. It reads the FINISHED
 * payload as text and asks about every secret the world holds, so it is independent of how the
 * payload was assembled; `viewerKnowledgeProjection.test.ts` drives it directly, because the
 * builder cannot currently produce a payload that trips it.
 */
export function unrevealedSecretsInPayload(
  payload: ViewerKnowledgeProjection,
  secrets: readonly SecretInput[],
  revealedSecretIds: ReadonlySet<string>,
): string[] {
  const text = JSON.stringify(payload);
  return secrets
    .filter((secret) => !revealedSecretIds.has(secret.secretId) && quotesSecret(text, secret.content))
    .map((secret) => secret.secretId);
}

/**
 * Build one character's viewer-knowledge projection (AC#1/#2).
 *
 * `characterKnownFactIds` is the character's OWN knowledge ledger, reduced to the fact ids it
 * cites. It arrives as a plain list of ids rather than as ledger records for a reason worth
 * stating: the ledger carries belief values, confidences, rumor stances and truth statuses, and
 * none of that may reach a public payload. Narrowing the input to ids means the private half is
 * not available to leak, rather than available and skipped.
 */
export function buildViewerKnowledgeProjection(input: {
  worldId: string;
  characterId: string;
  secrets: readonly SecretInput[];
  facts: readonly ProjectedFactInput[];
  citedEvents: readonly CitedEventInput[];
  withheldSceneIds: ReadonlySet<string>;
  characterKnownFactIds: ReadonlySet<string>;
}): { projection: ViewerKnowledgeProjection; revealedSecretIds: Set<string> } {
  if (input.worldId.trim().length === 0) {
    throw new ViewerKnowledgeError('VIEWER_KNOWLEDGE_INVALID', 'worldId must be non-empty');
  }
  if (input.characterId.trim().length === 0) {
    throw new ViewerKnowledgeError('VIEWER_KNOWLEDGE_INVALID', 'characterId must be non-empty');
  }

  const visible = viewerVisibleEvents(input.citedEvents, input.withheldSceneIds);
  const revealed = revealedSecrets(input.secrets, input.facts, visible);

  const consideredDays = [...new Set([...visible.values()].map((event) => event.worldDay))];
  const oldestConsideredWorldDay = consideredDays.length === 0 ? null : Math.min(...consideredDays);

  const secretRows: ViewerKnownSecret[] = [...revealed.values()]
    .filter(({ secret }) => secret.holderCharacterIds.includes(input.characterId))
    .map(({ secret, event }) => ({
      secretId: secret.secretId,
      content: secret.content,
      revealingEventId: event.eventId,
      revealedOnWorldDay: event.worldDay,
      publicationRef: event.publicationRef,
    }))
    // Newest reveal first, with the id as a total tie-break so two reveals on one day cannot
    // reorder between rebuilds and defeat the read model's content-hash dedup.
    .sort((left, right) => right.revealedOnWorldDay - left.revealedOnWorldDay
      || left.secretId.localeCompare(right.secretId));

  const ironyRows: DramaticIronyFact[] = input.facts
    .filter((fact) => isCurrentPublicFact(fact)
      && visible.has(fact.validFromEventId)
      && !input.characterKnownFactIds.has(fact.factId))
    .map((fact) => {
      // Non-null by the filter above; `visible.get` is re-read rather than threaded through so
      // the filter stays readable as a list of independent conditions.
      const event = visible.get(fact.validFromEventId) as CitedEventInput;
      return {
        factId: fact.factId,
        subjectType: fact.subjectType,
        subjectId: fact.subjectId,
        predicate: fact.predicate,
        value: fact.value,
        revealingEventId: event.eventId,
        revealedOnWorldDay: event.worldDay,
        publicationRef: event.publicationRef,
      };
    })
    .sort((left, right) => right.revealedOnWorldDay - left.revealedOnWorldDay
      || left.factId.localeCompare(right.factId));

  const revealedSecretIds = new Set(revealed.keys());
  const unrevealed = input.secrets.filter((secret) => !revealedSecretIds.has(secret.secretId));
  // Redaction runs BEFORE the caps, so a dropped row does not consume one of the slots a
  // publishable row could have had.
  const safeSecrets = redactUnrevealedSecrets(secretRows, unrevealed);
  const safeIrony = redactUnrevealedSecrets(ironyRows, unrevealed);

  const projection: ViewerKnowledgeProjection = {
    schemaVersion: VIEWER_KNOWLEDGE_SCHEMA_VERSION,
    worldId: input.worldId,
    characterId: input.characterId,
    viewerKnownSecrets: safeSecrets.kept.slice(0, MAX_VIEWER_KNOWN_SECRETS),
    dramaticIronyFacts: safeIrony.kept.slice(0, MAX_DRAMATIC_IRONY_FACTS),
    omittedSecretCount: Math.max(0, safeSecrets.kept.length - MAX_VIEWER_KNOWN_SECRETS),
    omittedIronyFactCount: Math.max(0, safeIrony.kept.length - MAX_DRAMATIC_IRONY_FACTS),
    redactedRowCount: safeSecrets.redacted + safeIrony.redacted,
    consideredWorldDays: consideredDays.length,
    oldestConsideredWorldDay,
  };

  const leaked = unrevealedSecretsInPayload(projection, input.secrets, revealedSecretIds);
  if (leaked.length > 0) {
    throw new ViewerKnowledgeError(
      'VIEWER_KNOWLEDGE_UNREVEALED_SECRET',
      `payload quotes ${leaked.length} unrevealed secret(s): ${leaked.join(', ')}`,
    );
  }

  return { projection, revealedSecretIds };
}
