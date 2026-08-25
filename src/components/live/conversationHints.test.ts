/**
 * Private dialogue cannot reach the public surface (FR-O004 / ART-123 AC#2, AC#3).
 *
 * ## Why the indicator rather than a caption
 *
 * AC#1 allows a summary, a status OR a short bubble. Choosing the existing vector indicator over
 * a `PIXI.Text` caption turns AC#2 and AC#3 from rules someone must remember into a property of
 * the renderer: no projection text reaches the canvas, so none can leak there.
 *
 * The canvas is not text-free — `MapZoneLayer` draws the eight authored location names, which
 * are repository constants and public by construction. The claim is that no WORLD-DERIVED text
 * reaches it, which is both true and the thing the criteria need.
 *
 * The public summaries live in the DOM instead, where they have already been through FR-P004's
 * withhold substitution, can be read by a screen reader, and can be selected.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { composeCharacterCardViewModel } from './characterCardModel';
import { composeActiveScenePanel } from './activeSceneModel';
import { mistwoodLocationFootprints } from '../../../data/mistwood';
import { MAX_PUBLIC_CONVERSATION_HINT_LENGTH } from '../../../convex/shared/publicText';

const ROOT = process.cwd();
const WORLD = 'mistwood';
const MILL = 'mistwood-mill';

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return entry.name.includes('.test.') ? [] : [path];
  });
}

describe('the canvas carries no WORLD-DERIVED text (AC#2, AC#3)', () => {
  const renderer = sourceFiles('src/components/world').map((path) => ({
    path,
    source: readFileSync(join(ROOT, path), 'utf8'),
  }));

  test('the sweep is not vacuous', () => {
    expect(renderer.length).toBeGreaterThan(0);
  });

  /**
   * The canvas is NOT text-free, and the first version of this suite wrongly claimed it was.
   *
   * `MapZoneLayer` draws location names — `footprint.name`, from `data/mistwood.ts`. That is
   * authored map furniture: the same eight strings on every deploy, in the repository, and
   * public by construction. It is not a leak surface and never becomes one.
   *
   * The claim worth making, and the one AC#2 and AC#3 actually need, is narrower: no text on
   * the canvas comes from a PROJECTION PAYLOAD. A summary, a dialogue line, a character's
   * profile — anything derived from Canon — has no path to the renderer, so there is nothing to
   * remember to truncate or filter there. The public summaries live in the DOM, where they have
   * already been through FR-P004's withhold substitution and where a screen reader can read
   * them.
   */
  test('the only text constructor on the canvas is the authored zone label', () => {
    const withText = renderer.filter((file) => /new PIXI\.Text\(|new Text\(|BitmapText/.test(file.source));
    expect(withText.map((file) => file.path)).toEqual(['src/components/world/MapZoneLayer.tsx']);
  });

  test('and it is fed from the authored footprint, never from a projection', () => {
    const layer = renderer.find((file) => file.path.endsWith('/MapZoneLayer.tsx'))!;
    expect(layer.source).toContain('new PIXI.Text(footprint.name');
    // The vocabulary a projection payload would arrive under. None of it reaches the renderer.
    for (const field of ['summary', 'publicSummary', 'dialogue', 'title', 'conversationHint']) {
      expect(layer.source).not.toContain(field);
    }
  });

  test('no renderer file reads a summary or a dialogue field at all', () => {
    for (const file of renderer) {
      for (const field of ['publicSummary', 'dialogue', 'conversationHint', 'summaryText']) {
        expect({ path: file.path, has: file.source.includes(field) })
          .toEqual({ path: file.path, has: false });
      }
    }
  });

  test('the character indicator draws shapes, not strings', () => {
    // `SPEECH_PRIMITIVES` has drawn a bubble since ART-119, waiting for a server that produced
    // `speaking`. ART-123 is that server, and this pins that lighting it up did not also
    // introduce a caption.
    const animation = renderer.find((file) => file.path.endsWith('/characterAnimation.ts'));
    expect(animation).toBeDefined();
    expect(animation!.source).toContain('SPEECH_PRIMITIVES');
    expect(animation!.source).not.toMatch(/\btext\s*:/i);
  });
});

describe('a withheld scene contributes no text, only state (AC#3, AC#5)', () => {
  const withheldScene = {
    // What FR-P004 actually substitutes: the placeholder title and an EMPTY summary. The
    // participants and the location are deliberately still public.
    title: '內容審核中',
    summary: '',
    sceneId: `7:evening:${MILL}`,
    locationId: MILL,
    participantCharacterIds: ['he-jun', 'pei-lan'],
    arcIds: ['arc-mill'],
    status: 'active' as const,
    publicationStatus: 'withheld' as const,
  };

  test('the card names who is talking but quotes nothing', () => {
    const card = composeCharacterCardViewModel({
      worldId: WORLD,
      characterId: 'he-jun',
      character: null,
      motion: null,
      recentEvents: null,
      scenes: [withheldScene],
      spriteKeys: {},
      footprints: mistwoodLocationFootprints,
    });
    // AC#5: the safe state is still shown.
    expect(card.conversationPartnerIds).toEqual(['pei-lan']);
    // AC#3: and nothing that has not passed publication is shown.
    expect(card.conversationHint).toBe('');
  });

  test('the panel marks it as withheld rather than presenting the placeholder as a title', () => {
    const panel = composeActiveScenePanel({
      scenes: [withheldScene],
      footprints: mistwoodLocationFootprints,
      worldId: WORLD,
    });
    expect(panel.scenes[0].withheld).toBe(true);
    // The location survives, because the map is already drawing characters standing there — a
    // scene vanishing from under them would be a bigger lie than saying it is under review.
    expect(panel.scenes[0].locationLabel).not.toBeNull();
  });

  test('a scene with no publication verdict is treated as published', () => {
    // A payload persisted before FR-P004 carries none, and reading silence as "withheld" would
    // label every pre-ART-132 scene as held back.
    const panel = composeActiveScenePanel({
      scenes: [{ ...withheldScene, publicationStatus: undefined, summary: '水車卡住了。' }],
      footprints: mistwoodLocationFootprints,
      worldId: WORLD,
    });
    expect(panel.scenes[0].withheld).toBe(false);
  });
});

describe('a published scene does produce a hint (AC#1, AC#4)', () => {
  const scene = (summary: string) => ({
    title: '磨坊對質',
    summary,
    sceneId: `7:evening:${MILL}`,
    locationId: MILL,
    participantCharacterIds: ['he-jun', 'pei-lan'],
    status: 'active' as const,
    publicationStatus: 'published' as const,
  });

  const cardFor = (summary: string) =>
    composeCharacterCardViewModel({
      worldId: WORLD,
      characterId: 'he-jun',
      character: null,
      motion: null,
      recentEvents: null,
      scenes: [scene(summary)],
      spriteKeys: {},
      footprints: mistwoodLocationFootprints,
    });

  test('the summary appears, shortened', () => {
    expect(cardFor('水車卡住了。').conversationHint).toBe('水車卡住了。');
  });

  test('a long summary never exceeds the budget', () => {
    // AC#4: long content is summarised and does not obscure the main view.
    const hint = cardFor('一'.repeat(200)).conversationHint;
    expect(hint.length).toBeLessThanOrEqual(MAX_PUBLIC_CONVERSATION_HINT_LENGTH);
  });

  test('an ended scene names nobody and quotes nothing', () => {
    const card = composeCharacterCardViewModel({
      worldId: WORLD,
      characterId: 'he-jun',
      character: null,
      motion: null,
      recentEvents: null,
      scenes: [{ ...scene('水車卡住了。'), status: 'ended' as const }],
      spriteKeys: {},
      footprints: mistwoodLocationFootprints,
    });
    expect(card.conversationPartnerIds).toEqual([]);
    expect(card.conversationHint).toBe('');
  });

  test('a character not in the scene gets neither', () => {
    const card = composeCharacterCardViewModel({
      worldId: WORLD,
      characterId: 'someone-else',
      character: null,
      motion: null,
      recentEvents: null,
      scenes: [scene('水車卡住了。')],
      spriteKeys: {},
      footprints: mistwoodLocationFootprints,
    });
    expect(card.conversationPartnerIds).toEqual([]);
    expect(card.conversationHint).toBe('');
  });

  test('partners are sorted and de-duplicated across scenes', () => {
    const card = composeCharacterCardViewModel({
      worldId: WORLD,
      characterId: 'he-jun',
      character: null,
      motion: null,
      recentEvents: null,
      scenes: [
        { ...scene('a'), sceneId: 's1', participantCharacterIds: ['he-jun', 'pei-lan'] },
        { ...scene('b'), sceneId: 's2', participantCharacterIds: ['he-jun', 'pei-lan', 'lin-yingxue'] },
      ],
      spriteKeys: {},
      footprints: mistwoodLocationFootprints,
    });
    // Deterministic, so a card re-opened with no change reads identically.
    expect(card.conversationPartnerIds).toEqual(['lin-yingxue', 'pei-lan']);
  });

  test('two scenes never have their summaries concatenated', () => {
    // A sentence neither scene published is exactly the derived text FR-P004's provenance rule
    // forbids. The first active scene with any published text wins.
    const card = composeCharacterCardViewModel({
      worldId: WORLD,
      characterId: 'he-jun',
      character: null,
      motion: null,
      recentEvents: null,
      scenes: [
        { ...scene('第一段。'), sceneId: 's1' },
        { ...scene('第二段。'), sceneId: 's2' },
      ],
      spriteKeys: {},
      footprints: mistwoodLocationFootprints,
    });
    expect(card.conversationHint).toBe('第一段。');
    expect(card.conversationHint).not.toContain('第二段');
  });
});
