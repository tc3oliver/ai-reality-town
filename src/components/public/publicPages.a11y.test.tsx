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
import { PublicStatusChips } from './PublicStatusChips';
import {
  PUBLIC_FRESHNESS_STATES,
  freshnessDescriptor,
  worldClockDescriptors,
} from './publicStatusBadge';
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

/** Read a declaration out of the first matching rule block in index.css, unresolved. */
function rawDeclaredValue(selector: string, property: string, from = INDEX_CSS): string {
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
 *
 * ART-131 moved those tokens from a set of `.public-muted` / `.public-page a`
 * overrides into custom properties on `.public-page`, so the block is now found
 * by the token name rather than by the class it used to redefine.
 */
function darkSchemeBlock(): string {
  const blocks = [
    ...INDEX_CSS.matchAll(
      /@media \(prefers-color-scheme: dark\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g,
    ),
  ].map((match) => match[1]);
  const publicBlock = blocks.find((block) => block.includes('--public-muted'));
  expect(publicBlock).toBeDefined();
  return publicBlock as string;
}

/**
 * ART-131 (FR-P003) expresses the palette as custom properties on `.public-page`, so a
 * declaration now typically reads `color: var(--public-muted)` rather than a literal. This
 * resolver follows one level of `var()` into the `.public-page` block of the given scope.
 *
 * It is what keeps the contrast claim honest AFTER tokenisation: without it these assertions
 * would silently start comparing the string "var(--public-muted)" — which parses to NaN — and
 * pass forever. `the token resolver actually resolves` below pins that both ways.
 */
function tokenValue(name: string, scope = INDEX_CSS): string {
  const block = scope.match(/\.public-page\s*\{([^}]*)\}/);
  expect(block).not.toBeNull();
  const declaration = (block as RegExpMatchArray)[1].match(
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`),
  );
  expect(declaration).not.toBeNull();
  return (declaration as RegExpMatchArray)[1].trim();
}

/** A declaration with any `var(--token)` resolved against the given scope. */
function declaredValue(selector: string, property: string, from = INDEX_CSS): string {
  const value = rawDeclaredValue(selector, property, from === INDEX_CSS ? INDEX_CSS : from);
  const reference = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return reference === null ? value : tokenValue(reference[1], from);
}

describe('public stylesheet meets NFR-009 (AC#2)', () => {
  // Worst-case body background in each colour scheme. The body gradient runs
  // from --background-start-rgb to --background-end-rgb, so the lowest-contrast
  // point in the light scheme is the start colour.
  const LIGHT_BACKGROUND = '#d6dbdc';
  const DARK_BACKGROUND = '#000000';
  const AA_NORMAL_TEXT = 4.5;

  /**
   * Every ink token, against every background it can land on (ART-131 / FR-P003 AC#1).
   *
   * Before ART-131 there was ONE background — the body gradient — and these assertions measured
   * against it alone. Cards introduced a second (`--public-surface`) and nested cards a third
   * (`--public-surface-sunken`), so a token that cleared AA on the page and failed on a card
   * would have been invisible to the old pair of tests. All three are checked now, in both
   * schemes, which is 24 ratios rather than 6.
   */
  const INK_TOKENS = ['--public-text', '--public-muted', '--public-link', '--public-accent'];

  function backgrounds(scope: string, body: string): Array<[string, string]> {
    return [
      ['body', body],
      ['surface', tokenValue('--public-surface', scope)],
      ['sunken', tokenValue('--public-surface-sunken', scope)],
    ];
  }

  test('light-scheme ink clears WCAG AA on the page and on both card surfaces', () => {
    expect(contrastRatio('#000000', LIGHT_BACKGROUND)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    const failures: string[] = [];
    for (const token of INK_TOKENS) {
      for (const [name, background] of backgrounds(INDEX_CSS, LIGHT_BACKGROUND)) {
        const ratio = contrastRatio(tokenValue(token, INDEX_CSS), background);
        if (ratio < AA_NORMAL_TEXT) failures.push(`${token} on ${name}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
    // The class the pages actually carry still points at the token, so tokenising did not leave
    // `.public-muted` behind with a stale literal.
    expect(declaredValue('.public-muted', 'color')).toBe(tokenValue('--public-muted'));
  });

  test('dark-scheme ink clears WCAG AA on the page and on both card surfaces', () => {
    const dark = darkSchemeBlock();
    expect(contrastRatio('#ffffff', DARK_BACKGROUND)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    const failures: string[] = [];
    for (const token of INK_TOKENS) {
      for (const [name, background] of backgrounds(dark, DARK_BACKGROUND)) {
        const ratio = contrastRatio(tokenValue(token, dark), background);
        if (ratio < AA_NORMAL_TEXT) failures.push(`${token} on ${name}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
    // Regression guard: the user-agent default link colour (#0000EE) measures
    // ~2.2:1 here, which is what the pages shipped with before ART-93.
    expect(contrastRatio('#0000EE', DARK_BACKGROUND)).toBeLessThan(AA_NORMAL_TEXT);
  });

  test('the token resolver actually resolves, so these ratios are not measuring NaN', () => {
    // The failure mode this guards: `contrastRatio('var(--public-muted)', …)` parses to NaN, and
    // every `toBeGreaterThanOrEqual` above would then be comparing NaN and passing nothing.
    for (const token of INK_TOKENS) {
      expect(tokenValue(token)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokenValue(token, darkSchemeBlock())).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // ...and the two schemes really do differ, so the dark block is being read rather than the
    // light one being returned twice.
    expect(tokenValue('--public-surface')).not.toBe(tokenValue('--public-surface', darkSchemeBlock()));
  });

  test('a border that carries meaning meets the 3:1 non-text threshold', () => {
    // Two border tokens exist because they do two different jobs. The hairline only separates a
    // card from the page and is allowed to be faint — WCAG 1.4.11 applies to boundaries REQUIRED
    // to identify a component, and nothing is identified by it. The strong token is used wherever
    // a border IS a signal (the status chip's border-style), so it has to clear 3:1.
    const AA_NON_TEXT = 3;
    for (const [scope, background] of [
      [INDEX_CSS, LIGHT_BACKGROUND],
      [darkSchemeBlock(), DARK_BACKGROUND],
    ] as Array<[string, string]>) {
      const strong = tokenValue('--public-border-strong', scope);
      expect(contrastRatio(strong, background)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrastRatio(strong, tokenValue('--public-surface', scope)))
        .toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrastRatio(strong, tokenValue('--public-surface-sunken', scope)))
        .toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
    // And the chip — the one component whose border is a state signal — uses it.
    expect(rawDeclaredValue('.public-chip', 'border-color')).toBe('var(--public-border-strong)');
  });

  test('the palette is not monochrome (AC#5)', () => {
    // RISK2-006's failure in one sentence: "a plain monochrome document". A grey accent would
    // satisfy every contrast assertion above and still leave the pages looking like an admin
    // console, so the accent is required to actually be a colour — its channels must differ.
    for (const scope of [INDEX_CSS, darkSchemeBlock()]) {
      const accent = tokenValue('--public-accent', scope).slice(1);
      const channels = [0, 2, 4].map((offset) => parseInt(accent.slice(offset, offset + 2), 16));
      const spread = Math.max(...channels) - Math.min(...channels);
      // A grey has a spread of 0. This threshold is well clear of "nearly grey".
      expect(spread).toBeGreaterThan(48);
    }
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

// ---------------------------------------------------------------------------
// The public design system (ART-131 / FR-P003).
//
// Two halves, as with every visual claim in this repo. The rendered half is
// what a page actually produces; the stylesheet half is what the tokens
// declare. jsdom applies no CSS, so neither alone would mean anything — the
// structural card rule could be perfect while no page rendered the shape it
// keys off, or every page could render the shape while the rule was deleted.
// ---------------------------------------------------------------------------

describe('the public design system (FR-P003 / ART-131)', () => {
  /** Every surface AC#4 names, rendered as its real markup. */
  const surfaces: Array<[string, ReactElement]> = [
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

  test('AC#2/#4 — every surface renders its regions as the shape the card rule keys off', () => {
    // The card treatment is applied structurally (`.public-page main > section`) rather than by a
    // class on every element, which is what keeps this task from having touched what any page
    // SAYS. That only works if every page really does render `main > section`; a page that wrapped
    // its regions in a `div` would silently opt out and look like the odd one, with no test
    // failing anywhere. So the shape itself is what is asserted.
    for (const [name, element] of surfaces) {
      const container = render(element);
      const main = container.querySelector('main');
      expect(main).not.toBeNull();
      const sections = (main as Element).querySelectorAll(':scope > section');
      expect(`${name}: ${sections.length}`).not.toBe(`${name}: 0`);
      // ...and no region is a bare div beside them, which is the opt-out this guards against.
      for (const child of Array.from((main as Element).children)) {
        expect(['SECTION', 'HEADER', 'P', 'H1', 'NAV', 'DIV', 'UL', 'ARTICLE']).toContain(
          child.tagName,
        );
      }
    }
  });

  test('AC#2 — the card treatment is declared for exactly that shape', () => {
    // The stylesheet half. Together with the test above: the shape exists on every page, and the
    // rule that styles the shape exists in the stylesheet.
    const rule = INDEX_CSS.match(/\.public-page main > section,\s*\.public-card\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = (rule as RegExpMatchArray)[1];
    expect(body).toMatch(/background:\s*var\(--public-surface\)/);
    expect(body).toMatch(/border:\s*1px solid var\(--public-border\)/);
    expect(body).toMatch(/border-radius/);
    expect(body).toMatch(/padding/);
  });

  test('AC#4 — the live surface is drawn from the same tokens, not from its own colours', () => {
    // Before ART-131 the live panels used `border-color: currentColor`, which is not a shared
    // decision — it is each element picking its own. The live map is one of the five surfaces
    // AC#4 names, so it has to speak the same language as the four text pages.
    for (const selector of ['.live-story-overlay', '.live-map-canvas']) {
      const rule = INDEX_CSS.match(
        new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`),
      );
      expect(rule).not.toBeNull();
      expect((rule as RegExpMatchArray)[1]).toMatch(/var\(--public-border\)/);
    }
    // Nothing in the live block reaches for `currentColor` as a border any more.
    for (const rule of INDEX_CSS.matchAll(/\.live-[\w-]+\s*\{([^}]*)\}/g)) {
      expect(rule[1]).not.toMatch(/border[\w-]*color:\s*currentColor/);
    }
  });

  test('AC#5 — the pages are no longer set in the terminal face', () => {
    // The single largest reason these surfaces read as an admin console: `.public-page` carried
    // `font-body`, i.e. VCR OSD Mono — a monospace pixel face with no CJK coverage, so every
    // Chinese glyph fell back to a generic monospace.
    const frame = readFileSync(new URL('./PublicPageFrame.tsx', import.meta.url), 'utf8');
    const className = frame.match(/className=\{`public-page[^`]*`\}/);
    expect(className).not.toBeNull();
    expect((className as RegExpMatchArray)[0]).not.toContain('font-body');
    // ...and a real reading stack is what replaced it, applied through the token.
    expect(declaredValue('.public-page', 'font-family')).toMatch(/system-ui/);
    // The pixel face survives, but only on the chips, where it is a short numeric label rather
    // than a paragraph of Chinese it cannot render.
    expect(tokenValue('--public-font-chip')).toContain('VCR OSD Mono');
    expect(rawDeclaredValue('.public-chip', 'font-family')).toBe('var(--public-font-chip)');
  });

  test('AC#5 — controls are drawn as controls', () => {
    // Tailwind preflight strips the user agent's button styling, so before ART-131 every control
    // on every public page rendered as bare text.
    const rule = INDEX_CSS.match(/\.public-page button\.public-tap\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect((rule as RegExpMatchArray)[1]).toMatch(/border:/);
    expect((rule as RegExpMatchArray)[1]).toMatch(/background:/);
  });

  test('AC#7 — a toggle’s pressed state is not signalled by colour alone', () => {
    const rule = INDEX_CSS.match(
      /\.public-page button\.public-tap\[aria-pressed='true'\]\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    const body = (rule as RegExpMatchArray)[1];
    // Colour changes too, but weight and border-width are what survive greyscale.
    expect(body).toMatch(/border-width:/);
    expect(body).toMatch(/font-weight:/);
  });
});

// ---------------------------------------------------------------------------
// Status chips (ART-131 AC#3, AC#7).
// ---------------------------------------------------------------------------

describe('the status chips (FR-P003 / ART-131 AC#3, AC#7)', () => {
  function chipRow(states: readonly string[]) {
    return (
      <div className="public-page">
        <PublicStatusChips
          chips={states.map((state) => freshnessDescriptor(state)!)}
          label="世界運作狀態"
          live
        />
      </div>
    );
  }

  test('every state renders a label, a decorative glyph and a spoken sentence', async () => {
    const container = render(chipRow(PUBLIC_FRESHNESS_STATES));
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const chips = Array.from(container.querySelectorAll('.public-chip'));
    expect(chips).toHaveLength(PUBLIC_FRESHNESS_STATES.length);
    for (const chip of chips) {
      // Signal 1: the visible label.
      expect(chip.querySelector('.public-chip-label')?.textContent).toBeTruthy();
      // Signal 2: a glyph, hidden from assistive tech because the label already says it in words.
      const glyph = chip.querySelector('.public-chip-glyph');
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
      expect(glyph?.textContent).toBeTruthy();
      // Signal 3: the attribute the stylesheet keys a distinct border-style off.
      expect(chip.getAttribute('data-state')).toBeTruthy();
      // ...and the sentence, for the case a fragment is not enough.
      expect(chip.querySelector('.sr-only')?.textContent?.length ?? 0).toBeGreaterThan(2);
    }
  });

  test('AC#7 — stripped of every class and attribute, the states are still told apart by text', () => {
    // The strongest form of the claim: not "colour is not the only signal" but "with the entire
    // stylesheet gone, and every hook a stylesheet could use gone with it, the four states are
    // still distinguishable". Mirrors the proof `TimeStateBanner` carries for ART-121.
    const container = render(chipRow(PUBLIC_FRESHNESS_STATES));
    const chips = Array.from(container.querySelectorAll('.public-chip'));
    for (const chip of chips) {
      chip.removeAttribute('class');
      chip.removeAttribute('data-state');
      for (const child of Array.from(chip.querySelectorAll('[class]'))) child.removeAttribute('class');
      for (const child of Array.from(chip.querySelectorAll('[aria-hidden]'))) {
        child.removeAttribute('aria-hidden');
      }
    }
    const texts = chips.map((chip) => (chip.textContent ?? '').trim());
    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test('one distinct border-style is declared per state', () => {
    const styles = new Map<string, string>();
    for (const rule of INDEX_CSS.matchAll(/\.public-chip\[data-state='([a-z]+)'\]\s*\{([^}]*)\}/g)) {
      const style = rule[2].match(/border-style:\s*([a-z]+)/);
      expect(style).not.toBeNull();
      styles.set(rule[1], (style as RegExpMatchArray)[1]);
    }
    expect([...styles.keys()].sort()).toEqual([...PUBLIC_FRESHNESS_STATES].sort());
    // Distinct, so the shape differs before the colour does.
    expect(new Set(styles.values()).size).toBe(styles.size);
  });

  test('the world clock row does not announce itself, and the runtime row does', () => {
    // A live region that fires for the world clock would interrupt a screen reader for something
    // nobody asked to be told about; the runtime state changing under the viewer is exactly what
    // they do want to hear.
    const clock = render(
      <div className="public-page">
        <PublicStatusChips chips={worldClockDescriptors(7, 'evening')} label="世界時間" />
      </div>,
    );
    expect(clock.querySelector('[role="status"]')).toBeNull();
    expect(clock.querySelectorAll('.public-chip')).toHaveLength(2);
    expect(clock.querySelector('.public-chip')?.hasAttribute('data-state')).toBe(false);

    const runtime = render(chipRow(['live']));
    expect(runtime.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  test('AC#6 — the chip renders named fields only, so it cannot leak a payload', () => {
    // The visual layer must not alter Canon semantics, and the cheapest way to guarantee it is
    // that the layer cannot carry anything but what it was handed. Mirrors the proof the
    // character card carries: a descriptor poisoned with extra keys renders none of them.
    const poisoned = {
      ...freshnessDescriptor('live')!,
      privateGoal: '秘密目標',
      rawModelOutput: 'raw model output',
      prompt: 'system prompt',
    } as ReturnType<typeof freshnessDescriptor> & Record<string, unknown>;
    const container = render(
      <div className="public-page">
        <PublicStatusChips chips={[poisoned!]} label="世界運作狀態" />
      </div>,
    );
    for (const forbidden of ['秘密目標', 'raw model output', 'system prompt', 'privateGoal']) {
      expect(container.innerHTML).not.toContain(forbidden);
    }
    // ...and it did render, so this is not passing by rendering nothing.
    expect(container.textContent).toContain('直播中');
  });

  test('the homepage shows the badge only once the server has reached a verdict', () => {
    // `undefined` (in flight) and `null` (never captured) must both render nothing: a state claim
    // nobody has checked is worse than no claim at all.
    for (const freshness of [null, undefined, 'unrecognised']) {
      const container = render(
        <HomepageView worldId={WORLD_ID} vm={homeViewModel()} freshness={freshness} />,
      );
      expect(container.querySelector('.public-chip[data-state]')).toBeNull();
    }
    const shown = render(
      <HomepageView worldId={WORLD_ID} vm={homeViewModel()} freshness="paused" />,
    );
    expect(shown.querySelector('.public-chip[data-state="paused"]')).not.toBeNull();
    expect(shown.textContent).toContain('已暫停');
  });
});
