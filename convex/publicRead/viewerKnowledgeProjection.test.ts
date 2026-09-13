/**
 * FR-I005's last two public fields, and the privacy boundary they sit on (ART-169).
 *
 * The failure this suite exists to prevent is one-directional: publishing a secret the viewer has
 * not earned. Everything below is written so that WIDENING a rule fails — treating `ready` as
 * released, dropping the withhold check, reading the ledger for secrets, letting a superseded
 * fact through. Narrowing a rule makes the page say less than it could, which is a product
 * regression rather than a privacy one, and is covered by the positive cases at the top.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PUBLICATION_STATUSES } from '../editorial/publicationLifecycle';
import {
  MAX_DRAMATIC_IRONY_FACTS,
  MAX_VIEWER_KNOWN_SECRETS,
  PUBLIC_FACT_VISIBILITIES,
  SECRET_REVEALING_VISIBILITY,
  VIEWER_KNOWLEDGE_MODEL_KIND,
  VIEWER_VISIBLE_PUBLICATION_STATUSES,
  buildViewerKnowledgeProjection,
  redactUnrevealedSecrets,
  revealedSecrets,
  unrevealedSecretsInPayload,
  viewerVisibleEvents,
  type CitedEventInput,
  type ProjectedFactInput,
  type SecretInput,
  type ViewerKnowledgeProjection,
} from './viewerKnowledgeProjection';
import { READ_MODEL_KINDS, RETIRED_READ_MODEL_KINDS } from './readModel';

const WORLD_ID = 'mistwood';
const CHARACTER_ID = 'zhao-ming';
const OTHER_CHARACTER_ID = 'qiu-an';
const SCENE_ID = 'mistwood:5:evening:grouping:scene:1';

const SECRET_CONTENT = 'Zhao Ming found payments to a dormant station account.';
const OTHER_SECRET_CONTENT = 'Qiu An preserved an index card naming a missing archive box.';

const SECRETS: SecretInput[] = [
  { secretId: 'secret-zhaoming-payments', content: SECRET_CONTENT, holderCharacterIds: [CHARACTER_ID] },
  { secretId: 'secret-qiu-index', content: OTHER_SECRET_CONTENT, holderCharacterIds: [OTHER_CHARACTER_ID] },
];

function fact(over: Partial<ProjectedFactInput> = {}): ProjectedFactInput {
  return {
    factId: 'e1:fact:0',
    subjectType: 'character',
    subjectId: CHARACTER_ID,
    predicate: 'ledgerFinding',
    value: SECRET_CONTENT,
    visibility: 'public',
    validFromEventId: 'e1',
    validUntilEventId: null,
    ...over,
  };
}

function cited(over: Partial<CitedEventInput> = {}): CitedEventInput {
  return {
    eventId: 'e1',
    worldDay: 5,
    publicationRef: `episode:${WORLD_ID}:5`,
    publicationStatus: 'published',
    sceneId: null,
    ...over,
  };
}

function build(over: {
  secrets?: SecretInput[];
  facts?: ProjectedFactInput[];
  citedEvents?: CitedEventInput[];
  withheldSceneIds?: Set<string>;
  characterKnownFactIds?: Set<string>;
  characterId?: string;
} = {}): ViewerKnowledgeProjection {
  return buildViewerKnowledgeProjection({
    worldId: WORLD_ID,
    characterId: over.characterId ?? CHARACTER_ID,
    secrets: over.secrets ?? SECRETS,
    facts: over.facts ?? [fact()],
    citedEvents: over.citedEvents ?? [cited()],
    withheldSceneIds: over.withheldSceneIds ?? new Set<string>(),
    characterKnownFactIds: over.characterKnownFactIds ?? new Set<string>(),
  }).projection;
}

// ---------------------------------------------------------------------------
// 觀眾已知秘密 — the positive case, then every way it must NOT happen
// ---------------------------------------------------------------------------

describe('viewer-known secrets', () => {
  it('reports a secret a PUBLISHED event said out loud, traceable to that event', () => {
    const payload = build();
    expect(payload.viewerKnownSecrets).toEqual([{
      secretId: 'secret-zhaoming-payments',
      content: SECRET_CONTENT,
      revealingEventId: 'e1',
      revealedOnWorldDay: 5,
      publicationRef: `episode:${WORLD_ID}:5`,
    }]);
  });

  it('names only the secrets this character holds', () => {
    // The other character's secret was revealed by the same event, and is still not on THIS page.
    const payload = build({
      facts: [
        fact(),
        fact({ factId: 'e1:fact:1', subjectId: OTHER_CHARACTER_ID, value: OTHER_SECRET_CONTENT }),
      ],
    });
    expect(payload.viewerKnownSecrets.map(({ secretId }) => secretId))
      .toEqual(['secret-zhaoming-payments']);
    expect(JSON.stringify(payload.viewerKnownSecrets)).not.toContain(OTHER_SECRET_CONTENT);
    // It DOES appear under dramatic irony, and that is the right answer rather than a leak: the
    // same published event said it out loud, so it is public information this character has not
    // been told. 「觀眾已知秘密」 is about whose secret it is; 「角色不知道的事」 is about who knows
    // it. Suppressing it here would mean the page could not report the most ironic fact in the
    // world it is describing.
    expect(payload.dramaticIronyFacts.map(({ factId }) => factId)).toContain('e1:fact:1');
  });

  it.each(PUBLICATION_STATUSES.filter((status) => status !== 'published'))(
    'refuses to release a secret at publication status "%s"',
    (status) => {
      const payload = build({ citedEvents: [cited({ publicationStatus: status })] });
      expect(payload.viewerKnownSecrets).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
    },
  );

  it('refuses `ready` in particular, which is where the automated pipeline stops', () => {
    // Called out separately from the loop above because this is the status almost every Episode
    // in a running world is sitting in: FR-K004 reserves `publish` for an administrator, so if
    // `ready` were treated as released, essentially every secret in the world would be public.
    expect(VIEWER_VISIBLE_PUBLICATION_STATUSES).toEqual(['published']);
    expect(build({ citedEvents: [cited({ publicationStatus: 'ready' })] }).viewerKnownSecrets)
      .toEqual([]);
  });

  it('refuses an event with no publication record at all', () => {
    expect(build({ citedEvents: [] }).viewerKnownSecrets).toEqual([]);
    expect(build({ citedEvents: [cited({ publicationStatus: 'absent' })] }).viewerKnownSecrets)
      .toEqual([]);
  });

  it('refuses a revealing event whose Scene an operator has withheld', () => {
    const payload = build({
      citedEvents: [cited({ sceneId: SCENE_ID })],
      withheldSceneIds: new Set([SCENE_ID]),
    });
    expect(payload.viewerKnownSecrets).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('does NOT withhold an event with no Scene provenance', () => {
    // ART-132's convention: silence from the classifier means "never in scope", not "refused".
    // Seed and system events carry no `sceneId` and must still be able to release content.
    const payload = build({
      citedEvents: [cited({ sceneId: null })],
      withheldSceneIds: new Set([SCENE_ID]),
    });
    expect(payload.viewerKnownSecrets).toHaveLength(1);
  });

  it('refuses a PRIVATE fact that quotes the secret, however it was published', () => {
    const payload = build({ facts: [fact({ visibility: 'private' })] });
    expect(payload.viewerKnownSecrets).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('refuses a revealing fact Canon has since closed out', () => {
    // A correction that supersedes the fact leaves Canon no longer asserting it. Republishing the
    // secret from a closed fact would be this projection asserting what its source withdrew.
    const payload = build({ facts: [fact({ validUntilEventId: 'e9' })] });
    expect(payload.viewerKnownSecrets).toEqual([]);
  });

  it('never reads the knowledge ledger to decide a secret is public', () => {
    // The ledger knowing a secret exists is not the viewer knowing it. The strongest form of this
    // is structural — the builder has no ledger input for secrets at all — so what is asserted
    // here is the consequence: a character whose ledger cites the revealing fact still gets
    // nothing when the publication gate says no.
    const payload = build({
      citedEvents: [cited({ publicationStatus: 'ready' })],
      characterKnownFactIds: new Set(['e1:fact:0']),
    });
    expect(payload.viewerKnownSecrets).toEqual([]);
  });

  it('takes the EARLIEST publishing reveal when several events quote the same secret', () => {
    const payload = build({
      facts: [
        fact({ factId: 'e1:fact:0', validFromEventId: 'e1' }),
        fact({ factId: 'e2:fact:0', validFromEventId: 'e2' }),
      ],
      citedEvents: [
        cited({ eventId: 'e1', worldDay: 5 }),
        cited({ eventId: 'e2', worldDay: 6, publicationRef: `episode:${WORLD_ID}:6` }),
      ],
    });
    expect(payload.viewerKnownSecrets[0]).toMatchObject({ revealingEventId: 'e1', revealedOnWorldDay: 5 });
  });
});

// ---------------------------------------------------------------------------
// 角色不知道但觀眾知道的資訊
// ---------------------------------------------------------------------------

const PUBLIC_FACT = fact({
  factId: 'e2:fact:0',
  subjectType: 'world',
  subjectId: WORLD_ID,
  predicate: 'hearingScheduled',
  value: 'day nine, morning',
  validFromEventId: 'e2',
});

const E2 = cited({ eventId: 'e2', worldDay: 6, publicationRef: `episode:${WORLD_ID}:6` });

describe('dramatic irony', () => {
  it('reports a published public fact the character does not hold', () => {
    const payload = build({ facts: [PUBLIC_FACT], citedEvents: [E2] });
    expect(payload.dramaticIronyFacts).toEqual([{
      factId: 'e2:fact:0',
      subjectType: 'world',
      subjectId: WORLD_ID,
      predicate: 'hearingScheduled',
      value: 'day nine, morning',
      revealingEventId: 'e2',
      revealedOnWorldDay: 6,
      publicationRef: `episode:${WORLD_ID}:6`,
    }]);
  });

  it('drops the fact the moment the character learns it', () => {
    const payload = build({
      facts: [PUBLIC_FACT],
      citedEvents: [E2],
      characterKnownFactIds: new Set(['e2:fact:0']),
    });
    expect(payload.dramaticIronyFacts).toEqual([]);
  });

  it('never reports a private fact', () => {
    const payload = build({
      facts: [{ ...PUBLIC_FACT, visibility: 'private', value: 'a private arrangement' }],
      citedEvents: [E2],
    });
    expect(payload.dramaticIronyFacts).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('a private arrangement');
  });

  it('never reports a superseded fact', () => {
    const payload = build({
      facts: [{ ...PUBLIC_FACT, validUntilEventId: 'e7', value: 'the retracted timing' }],
      citedEvents: [E2],
    });
    expect(payload.dramaticIronyFacts).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('the retracted timing');
  });

  it('never reports a fact whose event is not published', () => {
    for (const status of PUBLICATION_STATUSES.filter((value) => value !== 'published')) {
      const payload = build({
        facts: [PUBLIC_FACT],
        citedEvents: [{ ...E2, publicationStatus: status }],
      });
      expect(payload.dramaticIronyFacts).toEqual([]);
    }
  });

  it('never reports a fact whose Scene is withheld', () => {
    const payload = build({
      facts: [PUBLIC_FACT],
      citedEvents: [{ ...E2, sceneId: SCENE_ID }],
      withheldSceneIds: new Set([SCENE_ID]),
    });
    expect(payload.dramaticIronyFacts).toEqual([]);
  });

  it('admits `canon` visibility, because the public read models already publish it', () => {
    expect(PUBLIC_FACT_VISIBILITIES).toEqual(['public', 'canon']);
    const payload = build({
      facts: [{ ...PUBLIC_FACT, visibility: 'canon' }],
      citedEvents: [E2],
    });
    expect(payload.dramaticIronyFacts).toHaveLength(1);
  });

  it('drops a canon-visibility fact that quotes an unrevealed secret, and counts the drop', () => {
    // The one case where the two visibility policies pull apart: `canon` counts as publishable
    // (above) but NOT as a reveal, so this fact would otherwise put a secret nobody published
    // onto the page inside its own value.
    expect(SECRET_REVEALING_VISIBILITY).toBe('public');
    const payload = build({
      facts: [{ ...PUBLIC_FACT, visibility: 'canon', value: SECRET_CONTENT }],
      citedEvents: [E2],
    });
    expect(payload.dramaticIronyFacts).toEqual([]);
    expect(payload.redactedRowCount).toBe(1);
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('carries no rumor belief, stance, confidence or objective truth', () => {
    // Structural rather than filtered: the builder has no rumor input. This asserts the
    // consequence over a payload built from a world that has them.
    const payload = build({ facts: [fact(), PUBLIC_FACT], citedEvents: [cited(), E2] });
    const text = JSON.stringify(payload);
    for (const forbidden of ['rumor', 'stance', 'confidence', 'truthStatus', 'beliefValue', 'credibility']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Caps, ordering, determinism
// ---------------------------------------------------------------------------

describe('bounds and determinism', () => {
  const manyFacts = Array.from({ length: MAX_DRAMATIC_IRONY_FACTS + 5 }, (_, index) => fact({
    factId: `e2:fact:${index}`,
    subjectType: 'world',
    subjectId: WORLD_ID,
    predicate: `predicate-${index}`,
    value: `value-${index}`,
    validFromEventId: 'e2',
  }));

  it('caps the irony list and publishes what it left out', () => {
    const payload = build({ facts: manyFacts, citedEvents: [E2] });
    expect(payload.dramaticIronyFacts).toHaveLength(MAX_DRAMATIC_IRONY_FACTS);
    expect(payload.omittedIronyFactCount).toBe(5);
  });

  it('caps the secret list too', () => {
    const secrets = Array.from({ length: MAX_VIEWER_KNOWN_SECRETS + 3 }, (_, index) => ({
      secretId: `secret-${index}`,
      content: `a secret sentence number ${index}`,
      holderCharacterIds: [CHARACTER_ID],
    }));
    const facts = secrets.map((secret, index) => fact({
      factId: `e1:fact:${index}`, predicate: `p${index}`, value: secret.content,
    }));
    const payload = build({ secrets, facts });
    expect(payload.viewerKnownSecrets).toHaveLength(MAX_VIEWER_KNOWN_SECRETS);
    expect(payload.omittedSecretCount).toBe(3);
  });

  it('orders both lists totally, so a rebuild that changed nothing dedups', () => {
    const facts = [PUBLIC_FACT, { ...PUBLIC_FACT, factId: 'e2:fact:1', predicate: 'other' }];
    const first = build({ facts, citedEvents: [E2] });
    const second = build({ facts: [...facts].reverse(), citedEvents: [E2] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('publishes how far back it could see', () => {
    const payload = build({
      facts: [fact(), PUBLIC_FACT],
      citedEvents: [cited(), E2],
    });
    expect(payload.consideredWorldDays).toBe(2);
    expect(payload.oldestConsideredWorldDay).toBe(5);
  });

  it('reports no window at all when nothing is published', () => {
    const payload = build({ citedEvents: [cited({ publicationStatus: 'ready' })] });
    expect(payload.consideredWorldDays).toBe(0);
    expect(payload.oldestConsideredWorldDay).toBeNull();
  });

  it('does not mutate the ledger it was given', () => {
    // 「Character Knowledge 不能因為 public projection 被修改」 — the input is a read, and the
    // projection is derived. A build that wrote back would make the public surface an input to
    // the simulation's own state.
    const known = new Set(['e2:fact:0']);
    build({ facts: [PUBLIC_FACT], citedEvents: [E2], characterKnownFactIds: known });
    expect([...known]).toEqual(['e2:fact:0']);
  });
});

// ---------------------------------------------------------------------------
// The pieces, exercised directly
// ---------------------------------------------------------------------------

describe('the join, piece by piece', () => {
  it('viewerVisibleEvents keeps only published, unwithheld events', () => {
    const visible = viewerVisibleEvents([
      cited({ eventId: 'published' }),
      cited({ eventId: 'ready', publicationStatus: 'ready' }),
      cited({ eventId: 'withheld-scene', sceneId: SCENE_ID }),
    ], new Set([SCENE_ID]));
    expect([...visible.keys()]).toEqual(['published']);
  });

  it('revealedSecrets is world-scoped, not per character', () => {
    const visible = viewerVisibleEvents([cited()], new Set());
    const revealed = revealedSecrets(
      SECRETS,
      [fact(), fact({ factId: 'e1:fact:1', value: OTHER_SECRET_CONTENT })],
      visible,
    );
    // Both secrets are revealed by the world's own published events; which of them a given
    // character PAGE names is a separate decision, made in the builder.
    expect([...revealed.keys()].sort()).toEqual(['secret-qiu-index', 'secret-zhaoming-payments']);
  });

  it('redactUnrevealedSecrets drops a row by its text, whatever field carries it', () => {
    const rows = [{ factId: 'a', note: 'harmless' }, { factId: 'b', note: `…${SECRET_CONTENT}…` }];
    const { kept, redacted } = redactUnrevealedSecrets(rows, SECRETS);
    expect(kept.map(({ factId }) => factId)).toEqual(['a']);
    expect(redacted).toBe(1);
  });

  it('the whole-payload backstop finds a secret the row filter would not have seen', () => {
    // Driven directly, because today's payload shape cannot trip it — every string in it lives in
    // a row, and the row filter runs first. This is the check that would catch the NEXT field.
    const payload: ViewerKnowledgeProjection = {
      ...build({ citedEvents: [cited({ publicationStatus: 'ready' })] }),
      // Stands in for a future non-row field: a headline, a scope sentence, an excerpt.
      characterId: `${CHARACTER_ID} — ${SECRET_CONTENT}`,
    };
    expect(unrevealedSecretsInPayload(payload, SECRETS, new Set()))
      .toEqual(['secret-zhaoming-payments']);
  });

  it('the backstop clears a payload whose secrets were all revealed', () => {
    const payload = build();
    expect(unrevealedSecretsInPayload(payload, SECRETS, new Set(['secret-zhaoming-payments'])))
      .toEqual([]);
  });

  it('refuses an empty worldId or characterId rather than publishing an unaddressable row', () => {
    expect(() => build({ characterId: '  ' })).toThrow(/VIEWER_KNOWLEDGE_INVALID/);
  });
});

// ---------------------------------------------------------------------------
// The registry, which is three hand-maintained lists
// ---------------------------------------------------------------------------

describe('read-model kind registration', () => {
  // `process.cwd()`, the house pattern for a source-scanning test: `__dirname` is not defined
  // under the ESM module config `npm test` runs (see CLAUDE.md §7 on `npx jest`).
  const HERE = join(process.cwd(), 'convex/publicRead');
  const literalsIn = (source: string, blockPattern: RegExp): string[] => {
    const block = blockPattern.exec(source);
    if (block === null) throw new Error('the modelKind union block was not found — has it moved?');
    return [...block[1].matchAll(/v\.literal\('([^']+)'\)/g)].map((match) => match[1]);
  };

  it('is registered in all three places, and none of them carries a kind the others do not', () => {
    // CLAUDE.md §8: "Adding a read model means registering the kind in three places." Nothing
    // checked that until ART-169 needed the fourth kind added since it was written. A missing
    // entry in the schema is an insert-time failure in production and nowhere else.
    const schema = literalsIn(
      readFileSync(join(HERE, 'schema.ts'), 'utf8'),
      /modelKind: v\.union\(([\s\S]*?)\n {4}\),/,
    );
    const validator = literalsIn(
      readFileSync(join(HERE, 'readModelFunctions.ts'), 'utf8'),
      /const modelKindValidator = v\.union\(([\s\S]*?)\n\);/,
    );
    // The validator is the LIVE vocabulary exactly: a caller may name a kind if and only if
    // something publishes it.
    expect([...validator].sort()).toEqual([...READ_MODEL_KINDS].sort());
    // The schema is the STORED vocabulary, which is the live one plus whatever has been retired
    // and still has rows (ART-182). Equality on the union rather than a subset check in either
    // direction: a live kind missing from the schema is an insert-time production failure, and a
    // schema literal in neither list is a kind nobody decided to keep.
    expect([...schema].sort()).toEqual([...READ_MODEL_KINDS, ...RETIRED_READ_MODEL_KINDS].sort());
    expect(READ_MODEL_KINDS.some((kind) => (RETIRED_READ_MODEL_KINDS as readonly string[]).includes(kind))).toBe(false);
  });

  it('names this projection', () => {
    expect(VIEWER_KNOWLEDGE_MODEL_KIND).toBe('viewerKnowledge');
    expect(READ_MODEL_KINDS).toContain(VIEWER_KNOWLEDGE_MODEL_KIND);
  });
});
