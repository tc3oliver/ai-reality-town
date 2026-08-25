import { expect, test, type Page, type Request } from '@playwright/test';

import { FIXTURE_CHARACTER_IDS } from '../src/e2e/fixtureWorld';

/**
 * The dynamic viewing experience, in a real browser (FR-Q006 / ART-137).
 *
 * ## What this suite is for
 *
 * PRD 2.0 §22 makes browser evidence a release gate, and it is also the missing half of two
 * earlier tasks: ART-126 (responsive layout) and ART-130 (live ↔ editorial navigation) each
 * asserted everything a DOM and a stylesheet can settle, and each recorded explicitly that real
 * layout in a real engine was NOT covered because no headless browser ran in this repo. This is
 * that browser.
 *
 * ## How each criterion is operationalised, and what that does and does not prove
 *
 * The map is a `<canvas>`, which is opaque to both the DOM and to assistive technology. That is
 * not a limitation to work around — it is the reason ART-113 put every affordance in the DOM
 * beside the canvas rather than as a Pixi hit test. So the criteria are settled the way a VIEWER
 * settles them, which is also the way a screen-reader user does:
 *
 * - "characters visible" (AC#2) — one named focus control per published character. A character
 *   the projection published but the surface never offered is invisible in the sense that
 *   matters.
 * - "states distinguishable" (AC#4) — the card's movement/activity lines for four characters
 *   carrying four different `animationState`s must read differently. Pixel-peeping the Pixi
 *   indicator would prove something a blind viewer cannot use.
 * - "moving smoothly" (AC#3) — successive screenshots of the canvas region must each differ from
 *   the last. This proves the canvas is CONTINUOUSLY changing while a motion is in flight, which
 *   is what "smooth" means as against a teleport; it does not identify which pixels moved, and
 *   that is stated rather than implied.
 *
 * ## The zero-mutation and zero-LLM guarantees
 *
 * Observed two independent ways, on purpose. The fixture transport records and THROWS on any
 * non-query call — but a guarantee checked only by the thing being replaced is not a guarantee,
 * so the spec also watches the browser's own network layer, which a component bypassing the
 * client (a bare `fetch`, a second client) cannot influence.
 */

const WORLD = 'mistwood';
/** The deploy prefix `vite.config.ts` sets, carried here because `baseURL` cannot hold it. */
const BASE = '/ai-town';
const LIVE = `${BASE}/live/${WORLD}`;

/** What the fixture transport recorded. Shape mirrors `src/e2e/fixtureConvexClient.ts`. */
type Recorder = { queries: string[]; writes: string[] };

/** The server this suite serves the build from. Everything else is off-site by definition. */
const ORIGIN = 'http://127.0.0.1:4173';

/**
 * Whether a request is the page loading ITSELF rather than talking to a backend.
 *
 * Compared against the fixed server origin rather than against `page.url()`. The very first
 * request IS the navigation, and at that moment the page's own URL is still `about:blank` — so an
 * origin comparison classified the document request as off-site and made AC#10 fail on the one
 * request that is unavoidable.
 */
function isStaticAsset(request: Request): boolean {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN) return false;
  return /\.(?:js|css|html|png|jpe?g|svg|ttf|woff2?|json|ico|map)$/.test(url.pathname)
    || url.pathname.endsWith('/')
    || url.pathname.startsWith(`${BASE}/live/`)
    || url.pathname === `${BASE}/`
    || url.pathname === BASE;
}

/** Every request the page made that was not it loading itself. */
function watchNetwork(page: Page): { offSite: string[]; writes: string[] } {
  const record = { offSite: [] as string[], writes: [] as string[] };
  page.on('request', (request) => {
    if (request.method() !== 'GET') record.writes.push(`${request.method()} ${request.url()}`);
    if (!isStaticAsset(request)) record.offSite.push(`${request.method()} ${request.url()}`);
  });
  return record;
}

async function recorder(page: Page): Promise<Recorder> {
  return page.evaluate(() => (window as unknown as { __ART137__: Recorder }).__ART137__);
}

/** The canvas the Pixi stage draws into. */
function stage(page: Page) {
  return page.locator('.live-map-canvas canvas');
}

/** The row that is present only while a replay is playing. */
function replayRow(page: Page) {
  return page.locator('.live-time-state-row[data-time-state="replay"]');
}

/**
 * Open the live map and wait for the AMBIENT state.
 *
 * The wait is load-bearing rather than defensive. The replay auto-plays once per tab, and
 * Playwright gives every test a fresh context — so without this, roughly the first two seconds of
 * every test run against replayed frames rather than live ones. That is not a cosmetic
 * difference: during playback the page substitutes the replay's motions for the live ones, so a
 * character not in the current replay scene has no motion at all and their card reads 「—」. It
 * made two of AC#4's four states indistinguishable, which looked like a product defect and was
 * really the suite reading the wrong frame.
 *
 * AC#9 deliberately does NOT use this: observing the auto-play is what it is for.
 */
async function openLive(page: Page) {
  await page.goto(LIVE);
  await expect(page.locator('main')).toBeVisible();
  // SKIPPED rather than waited out. A real replay is 20-60s per scene by contract
  // (`REPLAY_SCENE_MIN_MS`), so waiting would add forty seconds to every test; skipping is a
  // real viewer action the product offers at any point (FR-O013 AC#8) and is instant.
  const skip = page.getByRole('button', { name: '跳過重播' });
  if (await skip.count() > 0) await skip.click();
  await expect(replayRow(page)).toHaveCount(0, { timeout: 20_000 });
}

test.describe('the live map in a real browser', () => {
  test('AC#1 — /live loads the map, not the WebGL fallback', async ({ page }) => {
    await openLive(page);
    await expect(page.getByRole('heading', { level: 1, name: '實況地圖' })).toBeVisible();
    // The fallback is a complete, deliberate page — so "the map loaded" has to be asserted as
    // the canvas being present, not merely as the route resolving.
    await expect(stage(page)).toBeVisible();
    await expect(page.getByText('WebGL')).toHaveCount(0);
    const box = await stage(page).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test('AC#2 — every published character is reachable, and the canvas is not blank', async ({ page }) => {
    await openLive(page);
    const cardButtons = page.getByRole('button', { name: /的角色卡$/ });
    // Twelve in the fixture, which is the roster the public acceptance environment carries; the
    // criterion's floor is four, so this asserts the floor AND the actual number.
    await expect(cardButtons).toHaveCount(12);
    expect(await cardButtons.count()).toBeGreaterThanOrEqual(4);

    // ...and something was actually drawn. An all-one-colour canvas would pass every DOM
    // assertion above while showing the viewer nothing.
    const shot = await stage(page).screenshot();
    expect(shot.byteLength).toBeGreaterThan(1000);
    const distinctBytes = new Set(shot.subarray(0, 20_000));
    expect(distinctBytes.size).toBeGreaterThan(16);
  });

  test('AC#3 — a motion in flight animates continuously rather than teleporting', async ({ page }) => {
    await openLive(page);
    await expect(stage(page)).toBeVisible();
    // Three samples, each compared with the last. One pair differing could be a single jump; a
    // chain of differing pairs is continuous change, which is what distinguishes an interpolated
    // walk from a position that snapped. It does NOT identify which pixels moved.
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i += 1) {
      frames.push(await stage(page).screenshot());
      await page.waitForTimeout(600);
    }
    expect(frames[0].equals(frames[1])).toBe(false);
    expect(frames[1].equals(frames[2])).toBe(false);
  });

  test('AC#5 — pressing a character control opens their card, and closing returns focus', async ({ page }) => {
    await openLive(page);
    const trigger = page.getByRole('button', { name: /的角色卡$/ }).first();
    const name = await trigger.getAttribute('aria-label');
    await trigger.click();

    const card = page.locator('section.live-character-card');
    await expect(card).toBeVisible();
    // The card took focus, which is what makes opening it non-silent for a keyboard user — the
    // claim `characterCardFocus.dom.test.tsx` proves in jsdom, here in a real browser.
    await expect(card).toBeFocused();
    await expect(card.getByText('目前地點:')).toBeVisible();

    await page.getByRole('button', { name: /^關閉 .* 的角色卡$/ }).click();
    await expect(card).toHaveCount(0);
    // Focus is back on the control that opened it, not dropped on <body>.
    await expect(page.getByRole('button', { name: name as string })).toBeFocused();
  });

  test('AC#4 — the four animation states read differently on the card', async ({ page }) => {
    await openLive(page);
    const readings: string[] = [];
    // Selected BY CHARACTER, not by position in the control list. The camera chrome orders its
    // focus targets its own way, so `nth(0..3)` picked four arbitrary residents — two of whom
    // happened to share a state, and AC#4 failed for a reason that had nothing to do with the
    // states being distinguishable. `fixtureWorld.test.ts` pins which four carry them.
    for (const characterId of FIXTURE_CHARACTER_IDS.slice(0, 4)) {
      await page.getByRole('button', { name: `查看 ${characterId} 的角色卡` }).click();
      const card = page.locator('section.live-character-card');
      await expect(card).toBeVisible();
      const text = await card.locator('li', { hasText: '移動狀態' }).innerText();
      const activity = await card.locator('li', { hasText: '目前活動' }).innerText();
      readings.push(`${text}|${activity}`);
      await page.getByRole('button', { name: /^關閉 .* 的角色卡$/ }).click();
    }
    // Four states, four distinct readings — in words, so this is what a screen reader gets too.
    expect(new Set(readings).size).toBe(4);
  });

  test('AC#6 — focusing an active scene presses the control and its summary is on screen', async ({ page }) => {
    await openLive(page);
    const panel = page.locator('section.live-active-scenes');
    await expect(panel.getByText('磨坊對質')).toBeVisible();
    await expect(panel.getByText('兩派在磨坊為停工的水車爭執。')).toBeVisible();

    const focus = panel.getByRole('button', { name: '聚焦此場景' }).first();
    await expect(focus).toHaveAttribute('aria-pressed', 'false');
    await focus.click();
    // The camera state is announced, not merely drawn — the half a canvas cannot carry.
    await expect(focus).toHaveAttribute('aria-pressed', 'true');

    // An ended scene offers its Episode; that link is ART-130's live -> editorial direction.
    await expect(panel.getByRole('link', { name: '閱讀當日 Episode' })).toHaveAttribute(
      'href',
      /#episode\/mistwood\//,
    );
  });

  test('AC#7 — pan, zoom and return to town view all work', async ({ page }) => {
    await openLive(page);
    const follow = page.getByRole('button', { name: '自動跟隨主要場景' });
    await expect(follow).toHaveAttribute('aria-pressed', 'true');

    const before = await stage(page).screenshot();
    await page.getByRole('button', { name: '拉近' }).click();
    await page.waitForTimeout(900);
    const zoomed = await stage(page).screenshot();
    expect(before.equals(zoomed)).toBe(false);

    await page.getByRole('button', { name: '拉遠' }).click();
    await page.waitForTimeout(900);

    // Returning to the town view also switches auto-follow off, so the primary scene does not
    // pull the camera straight back — which is the state the control reports.
    await page.getByRole('button', { name: '回到全鎮視角' }).click();
    await expect(follow).toHaveAttribute('aria-pressed', 'false');

    // Pan: a drag on the canvas. `touch-action: none` is what lets pixi-viewport claim it, and a
    // regression there is invisible to every non-browser test in this repo.
    const box = await stage(page).boundingBox();
    if (box !== null) {
      const midX = box.x + box.width / 2;
      const midY = box.y + box.height / 2;
      const panned0 = await stage(page).screenshot();
      await page.mouse.move(midX, midY);
      await page.mouse.down();
      await page.mouse.move(midX - 120, midY - 80, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(700);
      expect(panned0.equals(await stage(page).screenshot())).toBe(false);
    }
  });

  test('AC#9 — the replay auto-plays once, is skippable, and replays on request', async ({ page }) => {
    // A fresh context per test means an unconsumed once-per-tab mark, so the auto-play is
    // observable here rather than having to be triggered.
    await page.goto(LIVE);
    await expect(page.locator('main')).toBeVisible();

    // 1. It played on its own, and the event card is on screen with the resolved text.
    await expect(replayRow(page)).toBeVisible();
    await expect(page.locator('.live-replay-card')).toBeVisible();
    // The three time states are all named while playback runs, so "am I watching now or then?"
    // is answerable at a glance (FR-O014 / RISK2-009).
    await expect(page.locator('.live-time-state-row')).toHaveCount(3);

    // 2. Skipping returns to the ambient live state immediately (FR-O013 AC#8): one "now" row,
    //    no card. The natural END of playback is the same code path — `advanceReplay` returning
    //    `finished` — and is covered exhaustively by `replayPlayback.test.ts`; asserting it here
    //    would cost forty seconds of wall clock per run to re-prove a pure function.
    await page.getByRole('button', { name: '跳過重播' }).click();
    await expect(replayRow(page)).toHaveCount(0);
    await expect(page.locator('.live-time-state-row[data-time-state="now"]')).toHaveCount(1);
    await expect(page.locator('.live-replay-card')).toHaveCount(0);

    // 3. ONCE: it does not start again by itself. Waited past a full scene rather than checked
    //    immediately, which would pass even if it were about to restart.
    await page.waitForTimeout(3_000);
    await expect(replayRow(page)).toHaveCount(0);

    // 4. ...and the manual control still works, which AC#9 names separately. It is available in
    //    every state, including after auto-play has already fired.
    await page.getByRole('button', { name: '重播今日事件' }).click();
    await expect(replayRow(page)).toBeVisible();
    await expect(page.locator('.live-replay-card')).toBeVisible();
    await page.getByRole('button', { name: '跳過重播' }).click();
    await expect(replayRow(page)).toHaveCount(0);
  });

  test('AC#8 — the layout is map-first when stacked and side-by-side when wide', async ({ page }, testInfo) => {
    await openLive(page);
    const canvas = page.locator('.live-map-canvas');
    const overlay = page.locator('.live-story-overlay');
    await expect(canvas).toBeVisible();
    await expect(overlay).toBeVisible();

    const canvasBox = (await canvas.boundingBox())!;
    const overlayBox = (await overlay.boundingBox())!;

    if (testInfo.project.name === 'mobile') {
      // Stacked, map first (FR-O008 AC#2). Measured, not inferred from the markup.
      expect(overlayBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
      // And no horizontal overflow anywhere on the page (AC#4 of FR-O008).
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
      // The card still opens on a small screen (FR-O008 AC#5).
      await page.getByRole('button', { name: /的角色卡$/ }).first().click();
      await expect(page.locator('section.live-character-card')).toBeVisible();
    } else {
      // Side by side, both on screen at once (FR-O008 AC#1). Their vertical spans overlap, which
      // is what "simultaneously" means and what a stacked layout cannot satisfy.
      expect(overlayBox.x).toBeGreaterThan(canvasBox.x + canvasBox.width - 2);
      expect(overlayBox.y).toBeLessThan(canvasBox.y + canvasBox.height);
    }

    // Touch targets, measured in the engine rather than read off a stylesheet (FR-O008 AC#3).
    for (const control of await page.locator('main .public-tap').all()) {
      const box = await control.boundingBox();
      if (box === null) continue;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.width).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('AC#10/#11 — watching the world writes nothing and asks for no generation', async ({ page }) => {
    const network = watchNetwork(page);
    await openLive(page);

    // Exercise everything a viewer can do, so the guarantee covers the interactions rather than
    // only the initial load — which is the half static reasoning already settles.
    await page.getByRole('button', { name: '拉近' }).click();
    await page.getByRole('button', { name: '自動跟隨主要場景' }).click();
    await page.getByRole('button', { name: /的角色卡$/ }).first().click();
    await page.getByRole('button', { name: /^關閉 .* 的角色卡$/ }).click();
    await page.getByRole('button', { name: '聚焦此場景' }).first().click();
    await page.getByRole('button', { name: '重播今日事件' }).click();
    await page.waitForTimeout(1500);


    // 1. What the app asked its client to do. The fixture transport throws on any non-query, so
    //    a write would already have failed the run — this asserts the record as well.
    const recorded = await recorder(page);
    expect(recorded.writes).toEqual([]);
    expect(recorded.queries.length).toBeGreaterThan(0);
    for (const query of recorded.queries) {
      // Only published-read queries, and only ones on the anonymous allowlist.
      expect(query.startsWith('publicRead/')).toBe(true);
      expect(query).toMatch(/^publicRead\/\w+:get/);
    }

    // 2. What the BROWSER did, which the client cannot influence. A bare `fetch` or a second
    //    client would show up here and nowhere else.
    expect(network.writes).toEqual([]);
    expect(network.offSite).toEqual([]);

    // 3. AC#11 — no generation was asked for. There is no LLM endpoint the public bundle can
    //    name; the observable form of "the count did not increase" is that the page made no
    //    request to anything but its own static assets, which (2) has just established.
    expect(network.offSite).toHaveLength(0);
  });
});

/**
 * The homepage first screen (FR-P001 / ART-129).
 *
 * Two of its criteria are only settleable in a browser: whether the first screen actually paints
 * the residents (a `background-image` on a 64px box is a claim until an engine loads the texture),
 * and whether the page triggers any generation — which is a statement about the network, not
 * about the source.
 */
test.describe('the homepage first screen (FR-P001 / ART-129)', () => {
  const HOME = `${BASE}/#home/${WORLD}`;

  test('AC#3/#4 — the residents are drawn, from the texture the map uses', async ({ page }) => {
    await page.goto(HOME);
    await expect(page.locator('.home-first-screen')).toBeVisible();
    const sprites = page.locator('.home-first-screen .public-sprite');
    await expect(sprites.first()).toBeVisible();

    // Painted, not merely declared: the box has real size and the texture actually loaded. A
    // broken URL leaves `background-image` in the style attribute and nothing on screen.
    const box = await sprites.first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
    const loaded = await sprites.first().evaluate((element) => {
      const url = getComputedStyle(element).backgroundImage.match(/url\("?([^")]+)"?\)/)?.[1];
      if (url === undefined) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(probe.naturalWidth > 0);
        probe.onerror = () => resolve(false);
        probe.src = url;
      });
    });
    expect(loaded).toBe(true);
    // Nearest-neighbour, so the homepage and the Pixi canvas — which samples the same texture —
    // do not show visibly different characters.
    await expect(sprites.first()).toHaveCSS('image-rendering', 'pixelated');
  });

  test('AC#5 — a resident tile navigates to their page', async ({ page }) => {
    await page.goto(HOME);
    const tile = page.locator('.home-cast-link').first();
    await expect(tile).toBeVisible();
    const href = await tile.getAttribute('href');
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`${(href as string).replace('#', '\\#')}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('AC#6 — the homepage triggers no generation', async ({ page }) => {
    const network = watchNetwork(page);
    await page.goto(HOME);
    await expect(page.locator('.home-first-screen')).toBeVisible();
    await page.waitForTimeout(1_500);

    // Same two independent observations the live map gets. The published models the first screen
    // reads are rebuilt on Canon commit and served from cache, so a public view structurally
    // cannot cause a summary to be generated — this is that claim, at runtime.
    const recorded = await recorder(page);
    expect(recorded.writes).toEqual([]);
    // An explicit allowlist rather than the `^publicRead/\w+:get` prefix this used to match.
    //
    // The prefix was doing two jobs and only one of them well. It settled "no generation", but it
    // also silently blessed any FUTURE query added under `publicRead/` — the homepage could grow
    // a fifth read and no one would be told. And it FAILED when ART-45 added a legitimate
    // anonymous read from `viewer/`, which is a published read like the others and triggers no
    // generation, so the prefix was rejecting the right thing for the wrong reason.
    //
    // Naming them makes each addition a reviewed decision. `getEnvironmentVoteBallot` reads an
    // open ballot row; the WRITE that a vote performs is a mutation, and mutations land in
    // `recorded.writes`, which the assertion above still requires to be empty — so this list
    // cannot become a way to smuggle a write past the check.
    expect([...new Set(recorded.queries)].sort()).toEqual([
      'publicRead/readModelFunctions:getPublishedReadModel',
      'publicRead/runtimeSnapshotFunctions:getPublicRuntimeSnapshot',
      'viewer/environmentVoteFunctions:getEnvironmentVoteBallot',
    ]);
    expect(network.writes).toEqual([]);
    expect(network.offSite).toEqual([]);
  });
});

/**
 * The degradation ladder in a real browser (FR-O010 / ART-127).
 *
 * The rung that matters most here is the STATIC MAP, and it is the one no unit test can reach
 * honestly: jsdom has no WebGL either, so every DOM-level assertion about "what happens when
 * WebGL is missing" is made in an environment where WebGL was never present to begin with.
 * Only a real engine can be given a working GPU and then have it taken away.
 *
 * The fault is injected through the BROWSER, not through a product flag. There is no
 * `?degrade=` parameter and no test hook in the shipped bundle: `page.addInitScript` overrides
 * `HTMLCanvasElement.prototype.getContext` before any application code runs, so what the page
 * meets is indistinguishable from a browser that genuinely cannot make a WebGL context. A
 * query-string switch would have been easier and would have tested the switch.
 */
test.describe('the degradation ladder (FR-O010 / ART-127)', () => {
  /** Deny WebGL the way a real browser without it does: no context, for anyone who asks. */
  async function withoutWebGL(page: Page) {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      // 2D is left working on purpose. Denying everything would also break sprite decoding and
      // turn "no WebGL" into "no canvas at all", which is a different and much rarer fault.
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        id: string,
        ...rest: unknown[]
      ) {
        if (id === 'webgl' || id === 'webgl2' || id === 'experimental-webgl') return null;
        return (original as unknown as (...args: unknown[]) => unknown).call(this, id, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  }

  test('AC#1/AC#3 — a browser without WebGL gets the static plan, labelled, not a blank page', async ({ page }) => {
    await withoutWebGL(page);
    await page.goto(LIVE);
    await expect(page.locator('main')).toBeVisible();

    // Rung 3, not rung 4 and not the old cliff. Before ART-127 this page was the standalone
    // signpost and the two middle rungs were unreachable.
    await expect(page.locator('.live-map-canvas[data-rung="static-map"]')).toHaveCount(1);
    await expect(page.locator('.static-map-plan')).toBeVisible();
    await expect(stage(page)).toHaveCount(0);

    // AC#3 — the rung and the reason, both in words, above the fold.
    const notice = page.locator('.degradation-notice');
    await expect(notice).toHaveAttribute('data-level', 'static-map');
    await expect(notice).toContainText('靜態地圖');
    await expect(notice).toContainText('WebGL');
  });

  test('AC#1 — the plan actually places people, and the roster names the same ones', async ({ page }) => {
    await withoutWebGL(page);
    await page.goto(LIVE);
    await expect(page.locator('.static-map-plan')).toBeVisible();

    // Every published character is on the plan. The same standard AC#2 holds the animated map
    // to: a character the projection published but the surface never drew is invisible in the
    // sense that matters.
    for (const characterId of FIXTURE_CHARACTER_IDS) {
      await expect(page.locator(`.static-map-occupant[data-character="${characterId}"]`)).toHaveCount(1);
    }
    const roster = page.locator('.static-map-roster');
    await expect(roster).toBeVisible();
    for (const characterId of FIXTURE_CHARACTER_IDS) {
      await expect(roster).toContainText(characterId);
    }
  });

  test('AC#2 — Episode content is untouched by the ladder', async ({ page }) => {
    // Read the Episode page WITH the renderer denied, then again with it working, and require
    // the text to be identical. Degradation is about the live map; if an Episode page changed
    // by one character because WebGL was missing, the ladder would have leaked out of it.
    await withoutWebGL(page);
    await page.goto(`${BASE}/#episode/${WORLD}/7`);
    await expect(page.locator('main')).toBeVisible();
    const degraded = await page.locator('main').innerText();

    const healthy = await page.context().newPage();
    await healthy.goto(`${BASE}/#episode/${WORLD}/7`);
    await expect(healthy.locator('main')).toBeVisible();
    const intact = await healthy.locator('main').innerText();
    await healthy.close();

    expect(degraded).toBe(intact);
  });

  test('AC#4 — a renderer that cannot start writes nothing and asks for no generation', async ({ page }) => {
    const network = watchNetwork(page);
    await withoutWebGL(page);
    await page.goto(LIVE);
    await expect(page.locator('.static-map-plan')).toBeVisible();
    // Long enough for a retry loop to show itself. A boundary that re-mounted the renderer, or
    // a level that re-subscribed its queries, would appear here as repeated traffic.
    await page.waitForTimeout(3_000);

    // Both observers, for the reason AC#10/#11 use both: the fixture transport is the thing
    // being replaced, so it cannot be the only witness to its own guarantee.
    expect((await recorder(page)).writes).toEqual([]);
    expect(network.writes).toEqual([]);
    expect(network.offSite).toEqual([]);
  });

  test('AC#3 — the healthy page is labelled too, so a missing notice never means "probably fine"', async ({ page }) => {
    await openLive(page);
    const notice = page.locator('.degradation-notice');
    await expect(notice).toHaveAttribute('data-level', 'stream');
    await expect(notice).toContainText('即時畫面');
    // The top rung has nothing to explain, so it prints no reason sentence.
    await expect(notice.locator('p')).toHaveCount(0);
  });
});
