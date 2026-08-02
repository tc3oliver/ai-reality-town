import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { replayFromSnapshot } from './snapshots';
import { validateCanon, validateEventStructure } from './validators';
import { createMistwoodFixture, MISTWOOD_FIXED_SEED, MISTWOOD_FIXTURE_VERSION } from './mistwoodFixture';

describe('Mistwood fixed world fixture', () => {
  it('is versioned, fixed-seed, structurally valid, canon-valid, and replayable', () => {
    const fixture = createMistwoodFixture();
    expect(fixture.version).toBe(MISTWOOD_FIXTURE_VERSION);
    expect(fixture.seed).toBe(MISTWOOD_FIXED_SEED);
    let projection = fixture.initialProjection;
    for (const event of fixture.events) {
      expect(validateEventStructure(event)).toBeNull();
      expect(validateCanon(event, projection)).toBeNull();
      projection = reduceWorldEvent(projection, event);
    }
    expect(projection).toEqual(fixture.fullProjection);
    expect(replayWorldEvents(fixture.initialProjection, fixture.events)).toEqual(fixture.fullProjection);
    expect(replayFromSnapshot(fixture.snapshot, fixture.eventsAfterSnapshot)).toEqual(fixture.fullProjection);
  });

  it('returns isolated copies that cannot contaminate later tests', () => {
    const first = createMistwoodFixture();
    first.initialProjection.characterLocations.cassia = 'mutated';
    first.events[0].participantIds.push('intruder');
    first.snapshot.projection.facts.push({
      subjectType: 'world', subjectId: 'bad', predicate: 'bad', value: true, visibility: 'public',
      sourceEventId: 'mutated-event',
    });
    const second = createMistwoodFixture();
    expect(second.initialProjection.characterLocations.cassia).toBe('mistwood-market');
    expect(second.events[0].participantIds).toEqual(['cassia']);
    expect(second.snapshot.projection.facts).not.toContainEqual(expect.objectContaining({ subjectId: 'bad' }));
  });
});
