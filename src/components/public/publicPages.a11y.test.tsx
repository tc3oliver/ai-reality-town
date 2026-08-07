/**
 * Automated accessibility evidence for the P0 public experiences
 * (ART-93, NFR-009). Covers Homepage, Live, Episode list, Episode detail,
 * Character and Story Arc.
 *
 * This is the ONLY suite in the repository that runs against a DOM. The `a11y`
 * Jest project (see `jest.config.ts`) gives `*.a11y.test.tsx` jsdom plus
 * `jest-axe`; every other test stays pure-logic-only. Accessibility cannot be
 * asserted without real rendered markup, which is why the exception exists and
 * why it is scoped this narrowly. See `docs/accessibility.md`.
 *
 * Markup is produced with `react-dom/server` and injected into jsdom, so the
 * pages render exactly what a browser would receive without needing a Convex
 * client or a component-testing library.
 */

import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import jestAxe from 'jest-axe';

import { ArcDetailView } from './ArcDetailPage';
import { CharacterPageView } from './CharacterPage';
import { EpisodeDetailView, type EpisodeProjection } from './EpisodeDetail';
import { EpisodeListView } from './EpisodeList';
import { HelpView } from './HelpPage';
import { HomepageView } from './Homepage';
import { LiveViewBody } from './LiveView';
import { composeArcViewModel } from './arcRoute';
import { composeCharacterViewModel } from './characterRoute';
import { composeHelpViewModel } from './helpRoute';
import { composeHomepageViewModel } from './homeRoute';
import { composeLiveViewModel } from './liveRoute';
import type { EpisodeListIndex } from './episodeListRoute';

const WORLD_ID = 'mistwood';
/** The deployment prefix Vite builds with (`vite.config.ts` sets `base: '/ai-town'`). */
const BASE = '/ai-town/';

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** Render into jsdom and hand back the container axe should analyse. */
function render(element: ReactElement): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(element);
  return document.body;
}

/** The accessible name a screen reader would announce for a link or button. */
function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null) return ariaLabel.trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  const img = element.querySelector('img[alt]');
  const alt = img?.getAttribute('alt') ?? '';
  return `${element.textContent ?? ''} ${alt}`.trim();
}

function headingLevels(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) =>
    Number(heading.tagName.slice(1)),
  );
}

/**
 * Structural checks that axe cannot make on its own: heading order, link and
 * button naming, image alternatives, and the single-main-landmark rule.
 */
function expectStructuralAccessibility(container: HTMLElement): void {
  // Exactly one <main> landmark, and the page-level navigation sits outside it.
  // (Content-level navigation such as episode paging legitimately lives inside
  // <main>, but it must carry its own label so the two are distinguishable.)
  const mains = container.querySelectorAll('main');
  expect(mains).toHaveLength(1);
  expect(mains[0].querySelector('nav[aria-label="頁面導覽"]')).toBeNull();
  for (const nav of Array.from(container.querySelectorAll('nav'))) {
    expect(nav.getAttribute('aria-label')).toBeTruthy();
  }

  // The public subtree declares its own language (document is lang="en").
  expect(container.querySelector('.public-page')?.getAttribute('lang')).toBe('zh-Hant');

  // Exactly one h1, and no skipped heading level anywhere below it.
  const levels = headingLevels(container);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }

  // Every interactive control has a non-empty accessible name that is more than
  // a bare glyph, so it still makes sense read out of context (WCAG 2.4.4).
  const controls = Array.from(container.querySelectorAll('a[href], button'));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const name = accessibleName(control);
    expect(name).not.toBe('');
    expect(name).not.toMatch(/^[→←▲★·\s]+$/u);
  }

  // Every image carries an alt attribute (the P0 pages render none today, so
  // this is a regression guard).
  for (const img of Array.from(container.querySelectorAll('img'))) {
    expect(img.hasAttribute('alt')).toBe(true);
  }

  // No inline animation/transition: reduced-motion cannot be honoured by CSS
  // if a component hard-codes motion in a style attribute.
  for (const styled of Array.from(container.querySelectorAll('[style]'))) {
    expect(styled.getAttribute('style') ?? '').not.toMatch(/animation|transition/i);
  }
}

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  expect(await jestAxe.axe(container)).toHaveNoViolations();
}

/** Full automated pass: axe rules plus the structural checks above. */
async function expectAccessible(element: ReactElement): Promise<HTMLElement> {
  const container = render(element);
  expectStructuralAccessibility(container);
  await expectNoAxeViolations(container);
  return container;
}

// ---------------------------------------------------------------------------
// Fixtures — shaped like the published projections the pages actually read.
// ---------------------------------------------------------------------------

function homeViewModel() {
  return composeHomepageViewModel({
    worldId: WORLD_ID,
    summary: {
      summaryText: '磨坊之爭正在升溫。',
      structured: {
        majorEvent: { eventId: 'mistwood#event#74', publicSummary: '審計被要求公開。' },
        importance: 4,
        characters: [
          { characterId: 'he-jun', name: '何俊' },
          { characterId: 'zhao-ming', name: '趙明' },
        ],
        facts: [
          { factId: 'f1', predicate: 'occupation', value: '磨坊管事' },
          { factId: 'f2', predicate: 'millStopped', value: true },
          { factId: 'f3', predicate: 'auditRequested', value: true },
        ],
        question: '審計會揭露什麼?',
        recommendedEpisode: { episodeNumber: 3, worldDay: 2 },
      },
    },
    world: { name: '霧林鎮', currentWorldDay: 5, currentTimeSlot: '午後' },
    live: { worldTime: { worldDay: 5, timeSlot: '午後' } },
    base: BASE,
  });
}

function liveViewModel() {
  return composeLiveViewModel({
    live: {
      worldTime: { worldDay: 5, timeSlot: '午後' },
      locations: [
        {
          locationId: 'mill',
          name: '磨坊',
          locationType: 'workplace',
          active: true,
          description: '停工中的磨坊。',
        },
        {
          locationId: 'square',
          name: '廣場',
          locationType: 'public',
          active: false,
          description: '鎮民聚集的廣場。',
        },
      ],
      characters: [
        { characterId: 'he-jun', locationId: 'mill', alive: true },
        { characterId: 'zhao-ming', locationId: null, alive: false },
      ],
      recentEvents: [
        { eventId: 'mistwood#event#74', summary: '審計被要求公開。', worldDay: 5, timeSlot: '午後' },
      ],
      activeArcs: [
        {
          arcId: 'arc:mistwood:50',
          title: '磨坊之爭',
          currentQuestion: '審計會揭露什麼?',
          status: 'escalating',
        },
      ],
      activeScenes: [{ title: '帳房對質', summary: '兩人在帳房前對質。' }],
      publishedEpisodeStatus: 'published',
    },
  });
}

function episodeListIndex(): EpisodeListIndex {
  return {
    episodes: [
      {
        worldDay: 2,
        episodeNumber: 3,
        title: '停工的第一天',
        headline: '磨坊突然停工。',
        arcIds: ['arc:mistwood:50'],
        characterIds: ['he-jun'],
        isRecommendedEntry: true,
        isTurningPoint: false,
      },
      {
        worldDay: 4,
        episodeNumber: 5,
        title: '帳目之爭',
        headline: '趙明要求公開審計。',
        arcIds: ['arc:mistwood:50'],
        characterIds: ['he-jun', 'zhao-ming'],
        isRecommendedEntry: false,
        isTurningPoint: true,
      },
    ],
    arcIds: ['arc:mistwood:50'],
    characterIds: ['he-jun', 'zhao-ming'],
  } as EpisodeListIndex;
}

function episodeProjection(): EpisodeProjection {
  return {
    episodeNumber: 5,
    worldDay: 4,
    title: '帳目之爭',
    headline: '趙明要求公開審計。',
    oneLineSummary: '磨坊的帳目被攤在鎮民面前。',
    keyScenes: [
      { title: '帳房對質', summary: '兩人在帳房前對質。', sourceEventIds: ['mistwood#event#74'] },
    ],
    relationshipChanges: [{ summary: '何俊與趙明關係惡化。', sourceEventId: 'mistwood#event#74' }],
    newQuestions: ['審計會揭露什麼?'],
    resolvedQuestions: ['磨坊為何停工?'],
    arcIds: ['arc:mistwood:50'],
    characterIds: ['he-jun', 'zhao-ming'],
    nextEpisodeTease: '審計的結果即將公開。',
  };
}

function characterViewModel() {
  return composeCharacterViewModel({
    worldId: WORLD_ID,
    character: {
      id: 'he-jun',
      worldId: WORLD_ID,
      name: '何俊',
      age: 39,
      occupation: '磨坊管事',
      publicProfile: '在鎮上長大的磨坊管事。',
      personality: '謹慎',
      values: '重視信譽',
      publicGoal: '讓磨坊重新運轉。',
      fear: null,
      currentLocationId: 'mill',
      healthState: '良好',
      emotionalState: '緊繃',
      financialState: '拮据',
      alive: true,
      active: true,
    },
    recentEvents: [
      {
        eventId: 'mistwood#event#74',
        worldDay: 4,
        timeSlot: '午後',
        publicSummary: '審計被要求公開。',
        episodeNumber: 5,
      },
      {
        eventId: 'mistwood#event#75',
        worldDay: 5,
        timeSlot: '傍晚',
        publicSummary: '何俊交出帳本。',
        episodeNumber: 6,
      },
    ],
  });
}

function arcViewModel(overrides: { status?: string; outcome?: { summary: string; sourceEventIds: string[] } | null } = {}) {
  return composeArcViewModel({
    worldId: WORLD_ID,
    arc: {
      worldId: WORLD_ID,
      arcId: 'arc:mistwood:50',
      title: '磨坊之爭',
      premise: '何俊與趙明因磨坊停工而對立。',
      currentQuestion: '審計會揭露什麼?',
      status: overrides.status ?? 'escalating',
      coreCharacterIds: ['he-jun', 'zhao-ming'],
      essentialBackstory: [
        { factId: 'f1', predicate: 'occupation', value: '磨坊管事', sourceEventId: 'mistwood#event#4' },
      ],
      incitingEventId: 'mistwood#event#50',
      latestTurningPointEventId: 'mistwood#event#74',
      recommendedEntry: { episodeNumber: 3, worldDay: 2 },
      relatedEpisodes: [{ episodeNumber: 3, worldDay: 2 }],
      knownClues: [
        { factId: 'f9', predicate: 'auditOpen', value: true, sourceEventId: 'mistwood#event#74' },
      ],
      unresolvedQuestions: ['審計會揭露什麼?'],
      outcome: overrides.outcome ?? null,
    },
    primer: null,
  });
}

// ---------------------------------------------------------------------------
// AC#1 / AC#2 / AC#4 — every P0 experience, populated and empty.
// ---------------------------------------------------------------------------

describe('P0 public experiences pass automated accessibility checks (NFR-009)', () => {
  test('homepage', async () => {
    await expectAccessible(<HomepageView worldId={WORLD_ID} vm={homeViewModel()} />);
  });

  test('homepage with no published content', async () => {
    const vm = composeHomepageViewModel({
      worldId: WORLD_ID,
      summary: null,
      world: null,
      live: null,
      base: BASE,
    });
    await expectAccessible(<HomepageView worldId={WORLD_ID} vm={vm} />);
  });

  test('live view', async () => {
    await expectAccessible(<LiveViewBody worldId={WORLD_ID} vm={liveViewModel()} />);
  });

  test('live view with a paused / missing projection', async () => {
    await expectAccessible(
      <LiveViewBody worldId={WORLD_ID} vm={composeLiveViewModel({ live: null })} />,
    );
  });

  test('episode list', async () => {
    await expectAccessible(<EpisodeListView worldId={WORLD_ID} index={episodeListIndex()} />);
  });

  test('episode list with nothing published', async () => {
    await expectAccessible(<EpisodeListView worldId={WORLD_ID} index={null} />);
  });

  test.each(['quick', 'standard', 'deep'] as const)('episode detail — %s recap', async (depth) => {
    await expectAccessible(
      <EpisodeDetailView
        worldId={WORLD_ID}
        worldDay={4}
        episode={episodeProjection()}
        initialRecapView={depth}
        onNavigate={() => undefined}
      />,
    );
  });

  test('character page', async () => {
    await expectAccessible(<CharacterPageView worldId={WORLD_ID} vm={characterViewModel()} />);
  });

  test('character page with no published projection', async () => {
    const vm = composeCharacterViewModel({ worldId: WORLD_ID, character: null, recentEvents: null });
    await expectAccessible(<CharacterPageView worldId={WORLD_ID} vm={vm} />);
  });

  test('story arc page', async () => {
    await expectAccessible(<ArcDetailView worldId={WORLD_ID} vm={arcViewModel()} />);
  });

  test('watch-only help page (ART-113)', async () => {
    await expectAccessible(
      <HelpView worldId={WORLD_ID} vm={composeHelpViewModel({ worldId: WORLD_ID, base: BASE })} />,
    );
  });

  test('story arc page for a resolved arc', async () => {
    const vm = arcViewModel({
      status: 'resolved',
      outcome: { summary: '審計公開,磨坊復工。', sourceEventIds: ['mistwood#event#90'] },
    });
    await expectAccessible(<ArcDetailView worldId={WORLD_ID} vm={vm} />);
  });
});

// ---------------------------------------------------------------------------
// AC#1 — keyboard reachability.
// ---------------------------------------------------------------------------

describe('keyboard reachability (NFR-009 AC#1)', () => {
  const pages: Array<[string, ReactElement]> = [
    ['homepage', <HomepageView worldId={WORLD_ID} vm={homeViewModel()} />],
    ['live', <LiveViewBody worldId={WORLD_ID} vm={liveViewModel()} />],
    ['episode list', <EpisodeListView worldId={WORLD_ID} index={episodeListIndex()} />],
    [
      'episode detail',
      <EpisodeDetailView
        worldId={WORLD_ID}
        worldDay={4}
        episode={episodeProjection()}
        onNavigate={() => undefined}
      />,
    ],
    ['character', <CharacterPageView worldId={WORLD_ID} vm={characterViewModel()} />],
    ['arc', <ArcDetailView worldId={WORLD_ID} vm={arcViewModel()} />],
  ];

  test.each(pages)('%s exposes every control to the keyboard in DOM order', (_name, element) => {
    const container = render(element);
    const interactive = Array.from(
      container.querySelectorAll('a[href], button, select, input, textarea, [tabindex]'),
    );
    expect(interactive.length).toBeGreaterThan(0);
    for (const control of interactive) {
      // Nothing is removed from the tab order, and nothing jumps the sequence:
      // focus order therefore follows DOM order, which is reading order.
      const tabindex = control.getAttribute('tabindex');
      expect(tabindex === null || Number(tabindex) === 0).toBe(true);
      // Nothing is made unreachable with aria-hidden or inert.
      expect(control.closest('[aria-hidden="true"]')).toBeNull();
      expect(control.hasAttribute('inert')).toBe(false);
    }
  });

  test('recap depth selection is announced, not just coloured', () => {
    const container = render(
      <EpisodeDetailView
        worldId={WORLD_ID}
        worldDay={4}
        episode={episodeProjection()}
        initialRecapView="standard"
        onNavigate={() => undefined}
      />,
    );
    const tabs = Array.from(container.querySelectorAll('.recap-tabs button'));
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((tab) => tab.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(container.querySelector('.recap-tabs')?.getAttribute('role')).toBe('group');
  });

  test('touch-sized controls carry the 44px target class (NFR-009 AC#2)', () => {
    const container = render(
      <EpisodeDetailView
        worldId={WORLD_ID}
        worldDay={4}
        episode={episodeProjection()}
        onNavigate={() => undefined}
      />,
    );
    const standalone = Array.from(
      container.querySelectorAll('nav a[href], .recap-tabs button, .episode-nav button'),
    );
    expect(standalone.length).toBeGreaterThan(0);
    for (const control of standalone) {
      expect(control.classList.contains('public-tap')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — the Live experience is an equivalent non-map view.
// ---------------------------------------------------------------------------

describe('Live has an equivalent accessible non-map view (NFR-009 AC#3)', () => {
  test('renders no map, canvas or image surface', () => {
    const container = render(<LiveViewBody worldId={WORLD_ID} vm={liveViewModel()} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  test('exposes the same live world state as readable text', () => {
    const container = render(<LiveViewBody worldId={WORLD_ID} vm={liveViewModel()} />);
    const text = container.textContent ?? '';
    // World clock, locations, character positions, scenes, events and arcs —
    // everything the animated map conveys visually.
    expect(text).toContain('世界日 5');
    expect(text).toContain('磨坊');
    expect(text).toContain('he-jun 位於 磨坊');
    expect(text).toContain('帳房對質');
    expect(text).toContain('審計被要求公開。');
    expect(text).toContain('磨坊之爭');
    // Position is stated in words rather than with an arrow glyph, which
    // screen readers do not announce.
    expect(text).not.toContain('→');
  });

  test('the watch-only help page points at the non-map live view', () => {
    // ART-113 AC#10: the fallback stays signposted while the map renderer is
    // introduced, so it is not silently orphaned before ART-135 replaces it.
    const container = render(
      <HelpView worldId={WORLD_ID} vm={composeHelpViewModel({ worldId: WORLD_ID, base: BASE })} />,
    );
    const live = Array.from(container.querySelectorAll('a[href]')).find(
      (anchor) => anchor.getAttribute('href') === `/ai-town/live/${WORLD_ID}/text`,
    );
    expect(live).toBeDefined();
    expect(accessibleName(live as Element)).not.toBe('');
  });

  test('the homepage links to the non-map live view', () => {
    const container = render(<HomepageView worldId={WORLD_ID} vm={homeViewModel()} />);
    const live = Array.from(container.querySelectorAll('a[href]')).find(
      (anchor) => anchor.getAttribute('href') === `/ai-town/live/${WORLD_ID}/text`,
    );
    expect(live).toBeDefined();
    expect(accessibleName(live as Element)).not.toBe('');
    // ART-118 (FR-O001): the map is offered too, but never *instead* of the
    // non-map view -- both entry points ship together.
    const map = Array.from(container.querySelectorAll('a[href]')).find(
      (anchor) => anchor.getAttribute('href') === `/ai-town/live/${WORLD_ID}`,
    );
    expect(map).toBeDefined();
    expect(accessibleName(map as Element)).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// Navigation targets have to resolve, or a keyboard user dead-ends.
// ---------------------------------------------------------------------------

describe('public links resolve to real routes', () => {
  test('episode detail links carry the worldId its targets require', () => {
    const container = render(
      <EpisodeDetailView
        worldId={WORLD_ID}
        worldDay={4}
        episode={episodeProjection()}
        onNavigate={() => undefined}
      />,
    );
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`#home/${WORLD_ID}`);
    expect(hrefs).toContain(`#character/${WORLD_ID}/he-jun`);
    expect(hrefs).toContain(`#arc/${WORLD_ID}/arc:mistwood:50`);
  });

  test('live view arc links carry the worldId', () => {
    const container = render(<LiveViewBody worldId={WORLD_ID} vm={liveViewModel()} />);
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`#arc/${WORLD_ID}/arc:mistwood:50`);
  });

  test('repeated character-page links are distinguishable out of context', () => {
    const container = render(<CharacterPageView worldId={WORLD_ID} vm={characterViewModel()} />);
    const names = Array.from(container.querySelectorAll('.character-recent a[href]')).map(
      accessibleName,
    );
    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
    // WCAG 2.5.3: the accessible name still starts with the visible label.
    for (const name of names) expect(name.startsWith('本日故事')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — contrast, reduced motion and touch targets, checked against the real
// stylesheet. jsdom applies no CSS, so axe's `color-contrast` rule cannot run;
// these assertions compute the ratios from the declared tokens instead, which
// is what makes the contrast claim in docs/accessibility.md reproducible in CI
// rather than a one-off manual measurement.
// ---------------------------------------------------------------------------

/** Comments are stripped so prose about CSS is never mistaken for CSS. */
const INDEX_CSS = readFileSync(new URL('../../index.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** WCAG 2.1 relative luminance of an #rrggbb colour. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2.1 contrast ratio between two #rrggbb colours. */
function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Read a declaration out of the first matching rule block in index.css. */
function declaredValue(selector: string, property: string, from = INDEX_CSS): string {
  const block = from.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
  );
  expect(block).not.toBeNull();
  const declaration = (block as RegExpMatchArray)[1].match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`),
  );
  expect(declaration).not.toBeNull();
  return (declaration as RegExpMatchArray)[1].trim();
}

/**
 * The public dark-scheme overrides. `index.css` contains more than one
 * `prefers-color-scheme: dark` block (the original one only redefines the body
 * custom properties), so select the block that actually carries the public
 * tokens rather than the first one in the file.
 */
function darkSchemeBlock(): string {
  const blocks = [
    ...INDEX_CSS.matchAll(
      /@media \(prefers-color-scheme: dark\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g,
    ),
  ].map((match) => match[1]);
  const publicBlock = blocks.find((block) => block.includes('.public-muted'));
  expect(publicBlock).toBeDefined();
  return publicBlock as string;
}

describe('public stylesheet meets NFR-009 (AC#2)', () => {
  // Worst-case body background in each colour scheme. The body gradient runs
  // from --background-start-rgb to --background-end-rgb, so the lowest-contrast
  // point in the light scheme is the start colour.
  const LIGHT_BACKGROUND = '#d6dbdc';
  const DARK_BACKGROUND = '#000000';
  const AA_NORMAL_TEXT = 4.5;

  test('light-scheme public text and links clear WCAG AA', () => {
    expect(contrastRatio('#000000', LIGHT_BACKGROUND)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(
      contrastRatio(declaredValue('.public-muted', 'color'), LIGHT_BACKGROUND),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(
      contrastRatio(declaredValue('.public-page a', 'color'), LIGHT_BACKGROUND),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test('dark-scheme public text and links clear WCAG AA', () => {
    const dark = darkSchemeBlock();
    expect(contrastRatio('#ffffff', DARK_BACKGROUND)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(
      contrastRatio(declaredValue('.public-muted', 'color', dark), DARK_BACKGROUND),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    // Regression guard: the user-agent default link colour (#0000EE) measures
    // ~2.2:1 here, which is what the pages shipped with before ART-93.
    expect(
      contrastRatio(declaredValue('.public-page a', 'color', dark), DARK_BACKGROUND),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio('#0000EE', DARK_BACKGROUND)).toBeLessThan(AA_NORMAL_TEXT);
  });

  test('standalone controls declare a 44px minimum target', () => {
    expect(declaredValue('.public-tap', 'min-height')).toBe('44px');
    expect(declaredValue('.public-tap', 'min-width')).toBe('44px');
  });

  test('a visible focus indicator is declared for public controls', () => {
    expect(INDEX_CSS).toMatch(/\.public-page a:focus-visible/);
    expect(INDEX_CSS).toMatch(/\.public-page button:focus-visible/);
    expect(INDEX_CSS).toMatch(/outline:\s*3px solid currentColor/);
  });

  test('reduced motion is honoured', () => {
    const guard = INDEX_CSS.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
    expect(guard).not.toBeNull();
    const body = (guard as RegExpMatchArray)[1];
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  test('no P0 page can force horizontal overflow on a narrow viewport', () => {
    // Structural guard for WCAG 1.4.10 reflow. This is not a rendered
    // measurement — see docs/accessibility.md §4.3, which is still open — but it
    // does prove the markup contains none of the constructs that break reflow:
    // fixed widths, non-wrapping flex rows, explicit horizontal scroll, or
    // fixed/sticky positioning.
    const pages = [
      'Homepage.tsx',
      'LiveView.tsx',
      'EpisodeList.tsx',
      'EpisodeDetail.tsx',
      'CharacterPage.tsx',
      'ArcDetailPage.tsx',
      'PublicPageFrame.tsx',
    ];
    for (const page of pages) {
      const source = readFileSync(new URL(`./${page}`, import.meta.url), 'utf8');
      for (const className of source.match(/className="[^"]*"/g) ?? []) {
        expect(className).not.toMatch(/\bw-\[\d/); // fixed pixel width
        expect(className).not.toMatch(/\bmin-w-\[(?!44px)/); // fixed minimum width
        expect(className).not.toMatch(/\bwhitespace-nowrap\b/);
        expect(className).not.toMatch(/\boverflow-x-\b/);
        expect(className).not.toMatch(/\b(fixed|sticky|absolute)\b/);
        // Any flex row that holds more than one control must be allowed to wrap.
        if (/\bflex\b/.test(className) && !/\bflex-col\b/.test(className)) {
          expect(className).toMatch(/\bflex-wrap\b/);
        }
      }
    }
    // The single column is bounded by max-width, not width, so it shrinks.
    expect(
      readFileSync(new URL('./PublicPageFrame.tsx', import.meta.url), 'utf8'),
    ).toMatch(/max-w-2xl/);
  });

  test('the P0 public pages declare no animation of their own', () => {
    // Documented finding: the only @keyframes in the stylesheet belongs to the
    // game runtime progress bar, and no public component uses a motion utility.
    // This guards that finding rather than inventing motion to protect.
    const keyframes = INDEX_CSS.match(/@keyframes\s+([\w-]+)/g) ?? [];
    expect(keyframes).toEqual(['@keyframes moveStripes']);

    const pages = [
      'Homepage.tsx',
      'LiveView.tsx',
      'EpisodeList.tsx',
      'EpisodeDetail.tsx',
      'CharacterPage.tsx',
      'ArcDetailPage.tsx',
      'PublicPageFrame.tsx',
    ];
    for (const page of pages) {
      const source = readFileSync(new URL(`./${page}`, import.meta.url), 'utf8');
      const classNames = source.match(/className="[^"]*"/g) ?? [];
      for (const className of classNames) {
        expect(className).not.toMatch(/\b(animate-|transition|duration-|motion-safe:)/);
      }
    }
  });
});
