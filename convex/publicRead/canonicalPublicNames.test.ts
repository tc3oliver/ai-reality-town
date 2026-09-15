/**
 * A resident is published under the name this codebase says is canonical (ART-191).
 *
 * `data/mistwoodCharacters.ts` states the rule on the field itself:
 *
 *     /** The canonical public zh-TW label. The seed's romanised name is never published. *​/
 *     displayName: string;
 *
 * Nothing honoured it. The label was read in one place — `convex/visual/mistwoodVisualBindings.ts`
 * — and only to pick a sprite, while `convex/canon/mistwoodSeed.ts`'s romanised name reached every
 * public surface through THIS projection's `name` field, and from there into
 * `characterDisplayName`, `liveState.displayName`, the onboarding primer and ART-183's prose
 * substitution.
 *
 * The second describe block is the one that matters. It does not check a hand-written list of
 * twelve names: it derives the forbidden strings FROM the seed and the required strings FROM the
 * visual roster, and asserts over the cross product. A resident added to the seed without an
 * authored label, or a label quietly reverted to the romanised form, fails it — neither of which a
 * list written out by hand would catch.
 */

import { mistwoodCharacterSeed, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { MISTWOOD_CHARACTER_VISUALS } from '../../data/mistwoodCharacters';
import { buildCharacterProjection, canonicalPublicName } from './worldCharacterProjection';

/** The projection as the rebuild produces it, from a source carrying the SEED's own name. */
const publish = (worldId: string, characterId: string, seedName: string) =>
  buildCharacterProjection({
    worldId,
    source: { id: characterId, name: seedName, occupation: 'Mill operations manager' },
  });

describe('the authored label wins over the seed name', () => {
  it('publishes 何俊 for a character the seed calls He Jun', () => {
    expect(publish(MISTWOOD_PUBLIC_WORLD_ID, 'he-jun', 'He Jun').name).toBe('何俊');
  });

  it('keeps the projection name for a character the roster does not cover', () => {
    // Not a Mistwood resident. Nothing is invented for them; they publish exactly as before.
    expect(publish(MISTWOOD_PUBLIC_WORLD_ID, 'a-visitor', 'A Visitor').name).toBe('A Visitor');
  });

  it('does not reach across worlds, because a character id is unique only within one', () => {
    // A second world's `he-jun` is a different person and must not inherit Mistwood's 何俊.
    expect(publish('another-world', 'he-jun', 'Someone Else').name).toBe('Someone Else');
    expect(canonicalPublicName('another-world', 'he-jun')).toBeNull();
  });

  it('publishes null rather than a guess when the source names nobody and nobody is authored', () => {
    expect(buildCharacterProjection({
      worldId: MISTWOOD_PUBLIC_WORLD_ID, source: { id: 'a-visitor' },
    }).name).toBeNull();
  });
});

describe('no romanised seed name survives to the published projection', () => {
  const seeded = mistwoodCharacterSeed.characters
    .map((character) => ({ id: character.id, seedName: character.name }));

  it('covers every seeded resident, so this suite cannot pass by testing nobody', () => {
    // The `Tests: 0 total` guard in assertion form: an empty roster would make every `it.each`
    // below vacuous, and a filtered summary could not tell that from a clean pass.
    expect(seeded.length).toBe(12);
    expect(MISTWOOD_CHARACTER_VISUALS).toHaveLength(seeded.length);
  });

  it.each(MISTWOOD_CHARACTER_VISUALS.map((visual) => [visual.characterId, visual.displayName]))(
    'publishes %s as %s',
    (characterId, displayName) => {
      const seedEntry = seeded.find((entry) => entry.id === characterId);
      // Every authored label must name a resident the seed actually has. A label for a character
      // who does not exist is dead data that would silently stop being checked.
      expect(seedEntry).toBeDefined();
      const projection = publish(
        MISTWOOD_PUBLIC_WORLD_ID, characterId, seedEntry?.seedName as string,
      );
      expect(projection.name).toBe(displayName);
      expect(projection.name).not.toBe(seedEntry?.seedName);
    },
  );

  it('publishes no resident under a name the seed romanised', () => {
    const romanised = new Set(seeded.map((entry) => entry.seedName));
    const published = seeded.map((entry) =>
      publish(MISTWOOD_PUBLIC_WORLD_ID, entry.id, entry.seedName).name);
    for (const name of published) {
      expect(romanised.has(name as string)).toBe(false);
    }
    // And the positive half, so "published nothing" could not pass the loop above.
    expect(published.filter((name) => typeof name === 'string' && name.length > 0))
      .toHaveLength(seeded.length);
  });

  it('gives every seeded resident an authored label', () => {
    const authored = new Set(MISTWOOD_CHARACTER_VISUALS.map((visual) => visual.characterId));
    const missing = seeded.filter((entry) => !authored.has(entry.id)).map((entry) => entry.id);
    expect(missing).toEqual([]);
  });

  it('holds every authored label to being a zh-TW name rather than an identifier', () => {
    /**
     * Added after a fault injection did not bite.
     *
     * The `it.each` above derives its expectation from `MISTWOOD_CHARACTER_VISUALS` and then
     * asserts against the same table, so replacing 趙銘 with the string `zhao-ming` changed what
     * was expected as well as what was produced and the suite stayed green — a validator handed
     * its own input (CLAUDE.md §9). This is the independent property: the field is documented as
     * 「The canonical public zh-TW label」, and a zh-TW personal name is neither an ASCII
     * identifier nor the id it is keyed by.
     */
    for (const visual of MISTWOOD_CHARACTER_VISUALS) {
      expect(visual.displayName).not.toBe(visual.characterId);
      expect(visual.displayName).not.toMatch(/[A-Za-z]/u);
      expect(visual.displayName.trim().length).toBeGreaterThan(0);
    }
  });
});
