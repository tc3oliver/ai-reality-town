/**
 * Accessibility evidence for the live map's chrome (ART-118, FR-O001 AC#3/#7; NFR-009).
 *
 * A canvas is opaque to assistive technology, which is exactly why every camera
 * affordance was built as a DOM control rather than as a Pixi hit test. This
 * suite is what makes that claim checkable: each control is a real `<button>`
 * with an accessible name, reachable in DOM order, and the WebGL-unavailable
 * page is a complete, axe-clean page that signposts the text Live View.
 *
 * The map itself is not rendered here -- mounting a Pixi `Stage` needs a real
 * WebGL context jsdom cannot provide. What the canvas draws is covered by
 * `components/world/readOnlyWorld.dom.test.tsx`, and the gestures by the
 * recorded manual browser pass in `docs/live-view-navigation.md`.
 */

import { readFileSync } from 'node:fs';

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import jestAxe from 'jest-axe';

import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import {
  INITIAL_CAMERA_MODE,
  focusTargetsFrom,
  locationTargetId,
  type CameraMode,
} from '../world/cameraModel';
import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { ActiveScenePanel } from './ActiveScenePanel';
import { composeActiveScenePanel } from './activeSceneModel';
import { CameraControls } from './CameraControls';
import { CharacterCard } from './CharacterCard';
import { composeCharacterCardViewModel } from './characterCardModel';
import { LiveMapFallback } from './LiveMapFallback';
import { ReplayControls } from './ReplayControls';
import { StoryOverlay } from './StoryOverlay';
import { composeStoryOverlayViewModel } from './storyOverlayModel';
import { TimeStateBanner } from './TimeStateBanner';
import { composeTimeStateBadges } from './timeStateLabel';

const WORLD_ID = 'mistwood';
const BASE = '/ai-town/';

function render(element: ReactElement): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(element);
  return document.body;
}

function accessibleName(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

function targets() {
  return focusTargetsFrom({
    motions: [
      {
        characterId: 'he-jun',
        semanticLocationId: 'mistwood-mill',
        motionType: 'canon',
        motionSequence: 1,
        from: { x: 36, y: 18 },
        to: { x: 36, y: 18 },
        startedAt: 0,
        arriveAt: 0,
        animationState: 'idle',
        direction: 'down',
      },
    ],
    footprints: mistwoodLocationFootprints,
    map: mistwoodWorldMap,
    nowMs: 0,
  });
}

function controls(mode: CameraMode = INITIAL_CAMERA_MODE) {
  return <CameraControls targets={targets()} mode={mode} onModeChange={() => undefined} />;
}

describe('the camera chrome is operable without a mouse (NFR-009, FR-O005 AC#3)', () => {
  test('is axe-clean', async () => {
    expect(await jestAxe.axe(render(controls()))).toHaveNoViolations();
  });

  test('every camera affordance is a real button with an accessible name', () => {
    const container = render(controls());
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(4);
    for (const button of buttons) {
      // A canvas hit test is none of these things; a <button> is all of them.
      expect(button.getAttribute('type')).toBe('button');
      expect(accessibleName(button)).not.toBe('');
      expect(button.getAttribute('tabindex')).toBeNull();
      expect(button.closest('[aria-hidden="true"]')).toBeNull();
      expect(button.classList.contains('public-tap')).toBe(true);
    }
    // Nothing on the map is clickable-but-not-focusable.
    const nonButtonControls = container.querySelectorAll('[onclick], [role="button"]');
    expect(nonButtonControls).toHaveLength(0);
  });

  test('the whole control set AC#3 requires is present and named', () => {
    const names = Array.from(render(controls()).querySelectorAll('button')).map(accessibleName);
    expect(names).toContain('回到全鎮視角');
    expect(names).toContain('拉近');
    expect(names).toContain('拉遠');
    expect(names).toContain('自動跟隨主要場景');
    // One focus button per location...
    for (const footprint of mistwoodLocationFootprints) expect(names).toContain(footprint.name);
    // ...and one per published character.
    expect(names).toContain('he-jun');
  });

  test('the current camera state is announced, not just drawn', () => {
    const followingOff = render(
      controls({ follow: false, focusId: locationTargetId('mistwood-mill'), zoomStep: 0 }),
    );
    const pressed = Array.from(followingOff.querySelectorAll('button[aria-pressed="true"]')).map(
      accessibleName,
    );
    expect(pressed).toEqual(['Northwater Mill']);

    const following = render(controls({ follow: true, focusId: null, zoomStep: 0 }));
    expect(
      Array.from(following.querySelectorAll('button[aria-pressed="true"]')).map(accessibleName),
    ).toEqual(['自動跟隨主要場景']);
  });

  test('headings run in order and name their own groups', () => {
    const container = render(controls());
    const levels = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((heading) =>
      Number(heading.tagName.slice(1)),
    );
    // Three focus lists since ART-122: scenes, locations, characters.
    expect(levels).toEqual([2, 3, 3, 3]);
    for (const list of Array.from(container.querySelectorAll('ul[aria-labelledby]'))) {
      const id = list.getAttribute('aria-labelledby')!;
      expect(container.querySelector(`#${id}`)?.textContent).toBeTruthy();
    }
  });
});

describe('the WebGL-unavailable page (FR-O001 AC#7)', () => {
  test('is axe-clean and renders as a complete page', async () => {
    const container = render(<LiveMapFallback worldId={WORLD_ID} base={BASE} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('.public-page')?.getAttribute('lang')).toBe('zh-Hant');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    // It is informational, not a second renderer: no canvas is attempted.
    expect(container.querySelector('canvas')).toBeNull();
  });

  test('hands the viewer to the text Live View rather than dead-ending', () => {
    const container = render(<LiveMapFallback worldId={WORLD_ID} base={BASE} />);
    const link = Array.from(container.querySelectorAll('a[href]')).find(
      (anchor) => anchor.getAttribute('href') === `/ai-town/live/${WORLD_ID}/text`,
    );
    expect(link).toBeDefined();
    expect(accessibleName(link as Element)).not.toBe('');
  });

  test('says which failure happened, since only one of them is the viewer‘s to fix', () => {
    const noWebgl = render(<LiveMapFallback worldId={WORLD_ID} base={BASE} />).textContent ?? '';
    const crashed =
      render(<LiveMapFallback worldId={WORLD_ID} base={BASE} reason="render-failed" />)
        .textContent ?? '';
    expect(noWebgl).toContain('WebGL');
    expect(crashed).not.toBe(noWebgl);
    // Neither wording implies the world stopped -- it did not.
    for (const text of [noWebgl, crashed]) expect(text).toContain('世界仍在運作');
  });
});

/**
 * The public character card (FR-O006 / ART-124).
 *
 * The card's open affordance is the reason this suite matters more than usual for it: clicking a
 * character is the natural gesture, and the natural implementation — a pointer handler on the
 * Pixi sprite — is unreachable by keyboard and invisible to assistive technology, as well as
 * being structurally forbidden by `readOnlyWorldSurface.test.ts`. What replaces it is asserted
 * here: a real, individually named `<button>` per character, in the camera chrome.
 */
describe('the character card (FR-O006 / ART-124)', () => {
  const CHARACTER_ID = 'he-jun';

  function card(overrides: Partial<Parameters<typeof composeCharacterCardViewModel>[0]> = {}) {
    return composeCharacterCardViewModel({
      worldId: WORLD_ID,
      characterId: CHARACTER_ID,
      character: {
        id: CHARACTER_ID, worldId: WORLD_ID, name: '何俊', age: 38, occupation: '磨坊工',
        publicProfile: '北水磨坊的工頭。', personality: '沉穩', values: '守信',
        publicGoal: '修好水車', fear: '洪水', currentLocationId: 'mistwood-mill',
        healthState: '健康', emotionalState: '平靜', financialState: '拮据', alive: true, active: true,
      },
      motion: {
        characterId: CHARACTER_ID, semanticLocationId: 'mistwood-mill',
        animationState: 'idle', motionType: 'idle',
      },
      scenes: [{
        title: '修水車', sceneId: '7:evening:mistwood-mill', status: 'active',
        participantCharacterIds: [CHARACTER_ID], arcIds: ['arc-mill'],
      }],
      recentEvents: [
        { eventId: 'e1', worldDay: 3, timeSlot: 'noon', publicSummary: '簽下休戰。', episodeNumber: 3 },
      ],
      spriteKeys: mistwoodCharacterSpriteKeys,
      footprints: mistwoodLocationFootprints,
      ...overrides,
    });
  }

  test('renders every AC#1-#4 field as real markup, and is axe-clean', async () => {
    const container = render(<CharacterCard viewModel={card()} onClose={() => {}} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    for (const fragment of [
      '何俊', '磨坊工', '北水磨坊的工頭。', // AC#1
      'Northwater Mill', '停留原地', '待著', // AC#2
      '修好水車', 'arc-mill', '簽下休戰。', // AC#3
    ]) {
      expect(text).toContain(fragment);
    }
    // AC#4 — the link out to the full character page.
    expect(container.querySelector(`a[href="#character/${WORLD_ID}/${CHARACTER_ID}"]`)).not.toBeNull();
    // The section names itself, so a screen reader can reach it as a landmark.
    expect(container.querySelector('section[aria-labelledby="live-character-card"]')).not.toBeNull();
  });

  test('AC#5 — a view model carrying private fields still renders none of them', () => {
    // `characterCardModel.test.ts` proves the composer never puts them there. This is the other
    // half: the component prints named fields only, so even a view model that somehow carried
    // them — a future edit, a stale cache, a hand-built object — renders nothing of them. The
    // two together mean there is no single place where adding a spread would leak a secret.
    const poisoned = {
      ...card(),
      privateProfile: '不該外洩的私事',
      privateGoal: '秘密目標',
      knowledge: { secret: '未揭露的秘密' },
      memory: ['私人記憶'],
      prompt: 'system prompt',
      rawModelOutput: 'raw model output',
      adminNotes: 'operator annotation',
    } as unknown as ReturnType<typeof card>;
    const container = render(<CharacterCard viewModel={poisoned} onClose={() => {}} />);
    const markup = container.innerHTML;
    for (const forbidden of [
      'privateProfile', 'privateGoal', 'knowledge', 'memory', 'prompt', 'rawModelOutput', 'adminNotes',
      '不該外洩的私事', '秘密目標', '未揭露的秘密', '私人記憶', 'system prompt', 'operator annotation',
    ]) {
      expect(markup).not.toContain(forbidden);
    }
    // Nor `fear`, which is server-allowlisted but is not a card field: the card shows the
    // fields AC#1-#3 name and stops there.
    expect(container.textContent).not.toContain('洪水');
    // ...and it did render, so this is not passing by rendering nothing.
    expect(container.textContent).toContain('北水磨坊的工頭。');
  });

  test('is closable, and the close control says what it closes', () => {
    const container = render(<CharacterCard viewModel={card()} onClose={() => {}} />);
    const close = Array.from(container.querySelectorAll('button'))
      .find((button) => accessibleName(button).includes('關閉'));
    expect(close).toBeDefined();
    expect(close?.getAttribute('type')).toBe('button');
    // Named per character, since the page can carry other "close" controls in future.
    expect(accessibleName(close as Element)).toBe('關閉 何俊 的角色卡');
  });

  test('says it is loading rather than rendering blanks while the read is in flight', async () => {
    const container = render(
      <CharacterCard
        viewModel={card({ character: undefined, motion: null, scenes: null, recentEvents: null })}
        onClose={() => {}}
      />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(container.textContent).toContain('載入角色資料中…');
  });

  test('degrades to the live motion, not to a permanent spinner, for an unbuilt projection', async () => {
    // `serveReadModel` returns `null` for a character whose model has never been published.
    // Rendering "loading…" there waits forever for something that is not coming.
    const container = render(
      <CharacterCard viewModel={card({ character: null })} onClose={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    expect(text).not.toContain('載入角色資料中…');
    expect(text).toContain('這個角色的公開資料尚未建立');
    // The half that does not need the projection is still there...
    expect(text).toContain('Northwater Mill');
    // ...and so is the way out, which is when a viewer most needs it.
    expect(container.querySelector(`a[href="#character/${WORLD_ID}/${CHARACTER_ID}"]`)).not.toBeNull();
  });

  test('is focusable on open and announces itself, so opening it is not silent', async () => {
    // The card renders BELOW the button that opens it, so without this a keyboard or
    // screen-reader user presses "角色卡" and the new content is behind them in the tab order.
    // The effect that calls `.focus()` needs a mounted tree; what static markup can prove is
    // that the target is focusable at all and that the announcement exists.
    const container = render(<CharacterCard viewModel={card()} onClose={() => {}} />);
    const section = container.querySelector('section[aria-labelledby="live-character-card"]');
    expect(section).not.toBeNull();
    // Programmatically focusable, but never a tab stop of its own.
    expect(section?.getAttribute('tabindex')).toBe('-1');
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('何俊');
    // Announced without being shown twice.
    expect(status?.classList.contains('sr-only')).toBe(true);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
  });

  test('the open affordance is a named DOM button per character, never a canvas hit test', async () => {
    const container = render(
      <CameraControls
        targets={targets()}
        mode={INITIAL_CAMERA_MODE}
        onModeChange={() => undefined}
        onOpenCharacterCard={() => undefined}
      />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const names = Array.from(container.querySelectorAll('button')).map(accessibleName);
    // One per published character, individually named — not a repeated bare "角色卡".
    expect(names).toContain('查看 he-jun 的角色卡');
    // Locations and the town get no card button: only characters have cards.
    expect(names.filter((name) => name.includes('的角色卡'))).toHaveLength(1);
    expect(container.querySelector('canvas')).toBeNull();
  });

  test('without the handler, the character list is exactly what it was before ART-124', () => {
    const before = render(controls()).querySelectorAll('button').length;
    const after = render(
      <CameraControls
        targets={targets()}
        mode={INITIAL_CAMERA_MODE}
        onModeChange={() => undefined}
        onOpenCharacterCard={() => undefined}
      />,
    ).querySelectorAll('button').length;
    expect(after).toBe(before + 1);
  });
});

/**
 * The active scene panel (FR-O003 / ART-122 AC#1/#2/#3/#5).
 *
 * Real rendering evidence rather than a browser click: the deployment this repo builds
 * against is quota-disabled, so the live map cannot be fed real data in a browser. What a
 * browser would have shown -- a titled scene with its location, summary, participants, arcs,
 * a focus button and an Episode link -- is asserted here against the actual rendered DOM.
 */
describe('the active scene panel (FR-O003 / ART-122)', () => {
  const HALL = 'mistwood-hall';

  function panel(scenes: Parameters<typeof composeActiveScenePanel>[0]['scenes']) {
    return composeActiveScenePanel({ scenes, footprints: mistwoodLocationFootprints, worldId: WORLD_ID });
  }

  const activeScene = {
    title: '簽約', summary: '眾人見證休戰。', sceneId: `7:evening:${HALL}`, locationId: HALL,
    participantCharacterIds: ['cassia', 'rowan'], arcIds: ['arc-truce'], status: 'active' as const,
  };

  test('renders title, location, summary, participants and arcs, and is axe-clean', async () => {
    const container = render(
      <ActiveScenePanel model={panel([activeScene])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    for (const fragment of ['簽約', 'Town Hall', '眾人見證休戰。', 'cassia', 'rowan', 'arc-truce']) {
      expect(text).toContain(fragment);
    }
    // The section names itself, so a screen reader can reach it as a landmark.
    expect(container.querySelector('section[aria-labelledby="live-active-scenes"]')).not.toBeNull();
  });

  test('focus is a real button with an accessible name (AC#3)', () => {
    const container = render(
      <ActiveScenePanel model={panel([activeScene])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(accessibleName(buttons[0])).toBe('聚焦此場景');
    // Not a canvas hit test: a button is keyboard-reachable and announceable for free.
    expect(container.querySelector('canvas')).toBeNull();
  });

  test('an ended scene offers its Episode, an active one does not (AC#5)', () => {
    const ended = render(
      <ActiveScenePanel
        model={panel([{ ...activeScene, status: 'ended' }])}
        mode={INITIAL_CAMERA_MODE}
        onModeChange={() => {}}
      />,
    );
    const link = ended.querySelector('a[href="#episode/mistwood/7"]');
    expect(link).not.toBeNull();
    expect(accessibleName(link as Element)).toBe('閱讀當日 Episode');
    expect(ended.textContent).toContain('已結束');

    const active = render(
      <ActiveScenePanel model={panel([activeScene])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    expect(active.querySelectorAll('a[href]')).toHaveLength(0);
  });

  test('the empty state is a sentence, not a blank region', async () => {
    const container = render(
      <ActiveScenePanel model={panel([])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(container.textContent).toContain('目前沒有進行中的場景。');
  });
});

/**
 * The replay chrome (FR-O013 / ART-121 AC#6/#8).
 */
describe('ReplayControls (FR-O013 / ART-121 AC#6/#8)', () => {
  test('with nothing to replay, says so rather than showing a dead control', async () => {
    const container = render(
      <ReplayControls available={false} playing={false} onSkip={() => {}} onReplay={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).toContain('目前沒有可重播的場景。');
  });

  test('offers "重播今日事件" while idle, and it is a real, named button', async () => {
    const container = render(
      <ReplayControls available={true} playing={false} onSkip={() => {}} onReplay={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('type')).toBe('button');
    expect(accessibleName(buttons[0])).toBe('重播今日事件');
    expect(container.textContent).not.toContain('跳過重播');
  });

  test('offers "跳過重播" while playing, in the same place, AC#8 reachable at every point', async () => {
    const container = render(
      <ReplayControls available={true} playing={true} onSkip={() => {}} onReplay={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(accessibleName(buttons[0])).toBe('跳過重播');
    expect(container.textContent).not.toContain('重播今日事件');
  });
});

/**
 * The persistent time-state banner (FR-O014 / ART-121 AC#9).
 *
 * "Not by colour alone" is proven three independent ways here: the visible label text differs
 * per row, an `aria-hidden` glyph differs per row, and a `data-time-state` attribute the
 * stylesheet keys a border style off is present on every row — so removing any one signal still
 * leaves the other two.
 */
describe('TimeStateBanner (FR-O014 / ART-121 AC#9)', () => {
  function rows(container: HTMLElement) {
    return Array.from(container.querySelectorAll('.live-time-state-row'));
  }

  test('live state (no replay) renders exactly one row: 現在, and is axe-clean', async () => {
    const badges = composeTimeStateBadges({ replay: null, worldDay: 4, timeSlot: 'evening' });
    const container = render(<TimeStateBanner badges={badges} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0].getAttribute('data-time-state')).toBe('now');
    expect(container.textContent).toContain('現在');
  });

  test('a `role="status"` region announces state changes without interrupting', () => {
    const badges = composeTimeStateBadges({ replay: null });
    const container = render(<TimeStateBanner badges={badges} />);
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  test('during playback, three rows render — 重播/稍早/現在 — each with its own glyph, label and attribute, and the set is axe-clean', async () => {
    const badges = composeTimeStateBadges({
      replay: { worldDay: 2, timeSlot: 'morning', sceneIndex: 0, sceneCount: 2 },
      worldDay: 4,
      timeSlot: 'evening',
    });
    const container = render(<TimeStateBanner badges={badges} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();

    const states = rows(container).map((row) => row.getAttribute('data-time-state'));
    expect(states).toEqual(['replay', 'earlier', 'now']);

    const labels = Array.from(container.querySelectorAll('.live-time-state-label')).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['重播', '稍早', '現在']);
    // Three distinct labels — the DOM order matches the state order, so a row can never be
    // told apart from another only by position once the stylesheet is gone.
    expect(new Set(labels).size).toBe(3);

    const glyphs = Array.from(container.querySelectorAll('.live-time-state-glyph')).map(
      (node) => node.textContent,
    );
    expect(new Set(glyphs).size).toBe(3);
    // The glyph is decorative, not a second announcement of the same information.
    for (const glyph of container.querySelectorAll('.live-time-state-glyph')) {
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
    }
  });

  test('stripped of every class and data attribute, the three rows are still distinguishable by text alone', () => {
    const badges = composeTimeStateBadges({
      replay: { worldDay: 2, timeSlot: 'morning', sceneIndex: 0, sceneCount: 2 },
      worldDay: 4,
      timeSlot: 'evening',
    });
    const container = render(<TimeStateBanner badges={badges} />);
    for (const row of rows(container)) {
      row.removeAttribute('class');
      row.removeAttribute('data-time-state');
      for (const child of Array.from(row.querySelectorAll('[class]'))) child.removeAttribute('class');
      for (const child of Array.from(row.querySelectorAll('[aria-hidden]'))) {
        child.removeAttribute('aria-hidden');
      }
    }
    const texts = rows(container).map((row) => (row.textContent ?? '').trim());
    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test('each row carries a full-sentence announcement for assistive tech', () => {
    const badges = composeTimeStateBadges({
      replay: { worldDay: 2, timeSlot: 'morning', sceneIndex: 0, sceneCount: 2 },
      worldDay: 4,
      timeSlot: 'evening',
    });
    const container = render(<TimeStateBanner badges={badges} />);
    for (const row of rows(container)) {
      const announcement = row.querySelector('.sr-only')?.textContent ?? '';
      expect(announcement.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The Live Story Overlay (FR-O007 / ART-125).
 *
 * Two claims need real markup rather than a model assertion.
 *
 * **AC#5 — collapsible, and never obscuring the map.** The collapse is a native
 * `<details>`/`<summary>`, so what is asserted here is that the element really is that (the
 * browser then supplies the keyboard behaviour, the disclosure marker and the expanded state for
 * free) and that it renders OPEN by default, since PRD 2.0 UX2-004 asks for the context to be
 * permanently available. "Does not obscure the map" is proven structurally rather than
 * visually: `liveMapSurface.test.ts` asserts the overlay is a block sibling rendered before
 * `.live-map-canvas`, and the stylesheet assertion below asserts it is never lifted out of flow.
 * jsdom applies no CSS, so a rendered overlap test would prove nothing here.
 *
 * **AC#1/#2 — the content contract.** Every field the overlay promises is checked as text in the
 * rendered DOM, including the three degraded states (loading, unavailable, empty).
 */
describe('the Live Story Overlay (FR-O007 / ART-125)', () => {
  /** Comments are stripped so prose about CSS is never mistaken for CSS. */
  const INDEX_CSS = readFileSync(new URL('../../index.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  function overlay(
    overrides: Partial<Parameters<typeof composeStoryOverlayViewModel>[0]> = {},
  ) {
    return composeStoryOverlayViewModel({
      worldId: WORLD_ID,
      summary: {
        summaryText: '近期大事:兩派在鎮公所簽下休戰。',
        structured: {
          majorEvent: { eventId: 'e-42', publicSummary: '兩派在鎮公所簽下休戰。' },
          recommendedEpisode: { episodeNumber: 3, worldDay: 7 },
        },
      },
      activeArcs: [
        { arcId: 'arc-truce', title: '休戰協議', currentQuestion: '休戰能撐過冬天嗎?', status: 'climax' },
        { arcId: 'arc-mill', title: '磨坊', currentQuestion: '水車修得好嗎?', status: 'resolving' },
      ],
      worldDay: 7,
      timeSlot: 'evening',
      scenes: [{ title: '簽約', status: 'active' }],
      ...overrides,
    });
  }

  test('renders every AC#1/#2 answer as real markup, and is axe-clean', async () => {
    const container = render(<StoryOverlay viewModel={overlay()} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    for (const fragment of [
      '第 7 天', 'evening', // world day and time slot
      '近期大事:兩派在鎮公所簽下休戰。', // current situation
      '休戰協議', '高潮', '休戰能撐過冬天嗎?', // the PRIMARY arc — the climax one, not the first
      '1 個場景', '簽約', // active scenes
      '兩派在鎮公所簽下休戰。', // latest major event
    ]) {
      expect(text).toContain(fragment);
    }
    // AC#2 — the recommended entry point, in the shape every other page links Episodes with.
    expect(container.querySelector(`a[href="#episode/${WORLD_ID}/7"]`)).not.toBeNull();
    // The section names itself, so a screen reader can reach it as a landmark.
    expect(container.querySelector('section[aria-labelledby="live-story-overlay"]')).not.toBeNull();
    expect(container.querySelector('#live-story-overlay')?.tagName).toBe('H2');
  });

  test('AC#5 — it is a native disclosure, open by default, with a named toggle', () => {
    const container = render(<StoryOverlay viewModel={overlay()} />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    // Open by default: the context is meant to be permanently available (PRD 2.0 UX2-004), and
    // collapsing it is the viewer's choice on a small screen.
    expect(details?.hasAttribute('open')).toBe(true);
    const toggle = details?.querySelector('summary');
    expect(toggle).not.toBeNull();
    expect(accessibleName(toggle as Element)).toContain('故事資訊');
    // The world clock lives in the toggle, so collapsing never costs the viewer "when is this".
    expect(toggle?.textContent).toContain('第 7 天');
    // No hand-rolled disclosure beside the real one, which would be a second, inconsistent state.
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(0);
  });

  test('AC#5 — the stylesheet never lifts it out of normal flow', () => {
    // ONE of three halves. The composition (block sibling of the canvas, first in document
    // order, no positioning utility class on any rendered node) is proven on the mounted tree in
    // `storyOverlayLayout.dom.test.tsx`, which is the half a stylesheet sweep structurally
    // cannot reach in a Tailwind project. This is the stylesheet half: a later edit that made
    // the panel `position: absolute` would put it over the map without changing a line of markup.
    const block = INDEX_CSS.match(/\.live-story-overlay\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect((block as RegExpMatchArray)[1]).toContain('position: static');
    for (const rule of [...INDEX_CSS.matchAll(/(\.live-story-overlay[\w-]*)\s*\{([^}]*)\}/g)]) {
      expect(rule[2]).not.toMatch(/position\s*:\s*(absolute|fixed|sticky)/);
      expect(rule[2]).not.toMatch(/\bz-index\b/);
    }
  });

  test('says it is loading rather than rendering blanks while the reads are in flight', async () => {
    const container = render(
      <StoryOverlay viewModel={overlay({ summary: undefined, activeArcs: undefined })} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    expect(text).toContain('載入目前情勢中…');
    expect(text).toContain('載入故事線中…');
    expect(text).toContain('載入近期大事中…');
    // AND NOTHING ELSE. A spinner rendered above 「目前沒有可顯示的近期大事。」 is two
    // contradictory statements at once, which is what one panel-wide status produced.
    expect(text).not.toContain('目前沒有可顯示的近期大事。');
    expect(text).not.toContain('目前沒有進行中的主線故事。');
    // The map half is there regardless — it never needed either read.
    expect(text).toContain('第 7 天');
  });

  test('a section never claims "there is none" for a read that never landed', async () => {
    const container = render(
      <StoryOverlay viewModel={overlay({ summary: null, activeArcs: null })} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    expect(text).not.toContain('載入');
    expect(text).toContain('這個世界的故事摘要尚未建立');
    expect(text).toContain('故事線資料尚未建立。');
    expect(text).toContain('近期大事尚未建立。');
    // "Never built" is not the same sentence as "there genuinely is none", and only the second
    // is a claim about the world.
    expect(text).not.toContain('目前沒有可顯示的近期大事。');
    expect(text).not.toContain('目前沒有進行中的主線故事。');
    expect(text).toContain('第 7 天');
  });

  test('the two sources degrade independently, so one failing hides nothing of the other', async () => {
    // The case a single combined status got wrong: a summary that was never built beside a
    // healthy arc list read `ready`, suppressed the "unavailable" notice entirely, and then
    // asserted 「目前沒有可顯示的近期大事。」 as if it were a confirmed fact.
    const container = render(<StoryOverlay viewModel={overlay({ summary: null })} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    expect(text).toContain('這個世界的故事摘要尚未建立');
    expect(text).toContain('近期大事尚未建立。');
    expect(text).not.toContain('目前沒有可顯示的近期大事。');
    // ...while the arc, from the other read, is shown in full.
    expect(text).toContain('休戰協議');
    expect(text).toContain('高潮');

    // And the mirror image: a healthy summary beside an arc read that is still in flight keeps
    // AC#2's way out on screen, which is when a viewer most needs it.
    const arcsPending = render(<StoryOverlay viewModel={overlay({ activeArcs: undefined })} />);
    const pendingText = arcsPending.textContent ?? '';
    expect(pendingText).toContain('載入故事線中…');
    expect(pendingText).not.toContain('目前沒有進行中的主線故事。');
    expect(pendingText).toContain('近期大事:兩派在鎮公所簽下休戰。');
    expect(arcsPending.querySelector(`a[href="#episode/${WORLD_ID}/7"]`)).not.toBeNull();
  });

  test('an empty arc list is a fact about the world, not a failed read', async () => {
    const container = render(<StoryOverlay viewModel={overlay({ activeArcs: [] })} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    expect(text).toContain('目前沒有進行中的主線故事。');
    expect(text).not.toContain('故事線資料尚未建立。');
    expect(text).not.toContain('載入故事線中…');
  });

  test('the empty-scene state is a sentence too', () => {
    const container = render(<StoryOverlay viewModel={overlay({ scenes: [] })} />);
    expect(container.textContent).toContain('目前沒有進行中的場景。');
  });

  test('it offers no control that could ask the world for anything', () => {
    // AC#3/#6 at the render layer: the only interactive things in the overlay are the disclosure
    // toggle and an ordinary same-origin Episode link. `liveMapSurface.test.ts` proves the file
    // names no request API; this proves the rendered surface offers no affordance either.
    const container = render(<StoryOverlay viewModel={overlay()} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('form')).toHaveLength(0);
    const links = Array.from(container.querySelectorAll('a[href]')).map((anchor) =>
      anchor.getAttribute('href'),
    );
    expect(links).toEqual([`#episode/${WORLD_ID}/7`]);
  });
});
