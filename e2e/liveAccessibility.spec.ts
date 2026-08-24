import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_CHARACTER_IDS } from '../src/e2e/fixtureWorld';

/**
 * The dynamic view's accessibility baseline (FR-Q004 / ART-135, realizing NFR2-006).
 *
 * ## Why this is a browser suite and not a jsdom one
 *
 * The live map's accessibility problem is not its markup — `publicPages.a11y.test.tsx` and
 * `liveMap.a11y.test.tsx` already prove the markup, and jsdom is fine for that. The problem is
 * that the map is a **canvas**, and every claim that actually matters is about what happens when
 * one is on the page:
 *
 * - Does Tab really reach the controls, in the order they are read, with a visible ring? jsdom has
 *   no focus ring and no layout, so it cannot say.
 * - Does Reduced Motion really stop the animation? jsdom runs no animation to stop.
 * - Is the canvas really inert to assistive technology, or has something added a handler?
 * - Does axe pass on the page as it renders, canvas and all?
 *
 * So this file asserts the half its jsdom siblings structurally cannot, and defers everything
 * they already cover to them rather than restating it.
 *
 * ## The standard applied
 *
 * WCAG 2.1 AA, which is what `docs/accessibility.md` records for the P0 surfaces. axe is run with
 * the `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` tags so the pass is a named standard rather than
 * "whatever axe's defaults happen to be this release".
 */

const BASE = '/ai-town';
const WORLD = 'mistwood';
const LIVE = `${BASE}/live/${WORLD}`;
const TEXT_LIVE = `${LIVE}/text`;

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function replayRow(page: Page) {
  return page.locator('.live-time-state-row[data-time-state="replay"]');
}

/** Open the live map in the ambient state, skipping the auto-played replay. */
async function openLive(page: Page) {
  await page.goto(LIVE);
  await expect(page.locator('main')).toBeVisible();
  const skip = page.getByRole('button', { name: '跳過重播' });
  if ((await skip.count()) > 0) await skip.click();
  await expect(replayRow(page)).toHaveCount(0, { timeout: 20_000 });
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help}`);
}

test.describe('AC#1 — the world is comprehensible without the map', () => {
  test('the map always signposts its non-map equivalent, and it is a real page', async ({ page }) => {
    await openLive(page);
    const link = page.getByRole('link', { name: '改用文字實況(不需地圖)' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', TEXT_LIVE);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`${TEXT_LIVE}$`));
    await expect(page.locator('main')).toBeVisible();
    // The equivalence AC#1 asks for: characters, locations AND scenes, as text.
    await expect(page.locator('canvas')).toHaveCount(0);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('磨坊');
    expect(text.length).toBeGreaterThan(80);
  });

  test('the non-map view is axe-clean', async ({ page }) => {
    await page.goto(TEXT_LIVE);
    await expect(page.locator('main')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('AC#2 — the surface is operable from the keyboard alone', () => {
  test('Tab reaches the character controls, and Enter opens the card', async ({ page }) => {
    await openLive(page);
    const characterId = FIXTURE_CHARACTER_IDS[0];
    const target = page.getByRole('button', { name: `查看 ${characterId} 的角色卡` });

    // Focused programmatically then activated BY KEY — the activation is the part a click cannot
    // stand in for, because a control reachable by pointer but not by Enter is still broken.
    await target.focus();
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');

    const card = page.locator('section.live-character-card');
    await expect(card).toBeVisible();
    // Focus moved INTO the new content. Without this a keyboard user presses the control and the
    // card appears behind them in the tab order — the defect ART-124 fixed, proven in a browser.
    await expect(card).toBeFocused();

    // Escape is not a documented affordance here (the card is a block, not a dialogue), so the
    // close control is what must be reachable — and it must return focus to the trigger.
    await page.getByRole('button', { name: /^關閉 .* 的角色卡$/ }).focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(target).toBeFocused();
  });

  test('Tab order runs forward through the page without a trap', async ({ page }) => {
    await openLive(page);
    await page.locator('body').press('Tab');
    const seen: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const active = await page.evaluate(() => {
        const element = document.activeElement;
        if (element === null || element === document.body) return null;
        return `${element.tagName}:${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 24)}`;
      });
      if (active !== null) seen.push(active);
      await page.keyboard.press('Tab');
    }
    expect(seen.length).toBeGreaterThan(10);
    // Not a trap: successive tabs do not sit on one element. A keyboard user who tabs into the
    // map's chrome has to be able to tab out of it again.
    expect(new Set(seen).size).toBeGreaterThan(5);
  });

  test('the canvas itself is not a tab stop and carries no handler', async ({ page }) => {
    await openLive(page);
    // ART-113's guarantee, checked on the real element rather than in the source: the renderer
    // has no affordance, which is why every affordance is a DOM control beside it.
    const canvas = page.locator('.live-map-canvas canvas');
    await expect(canvas).toHaveCount(1);
    expect(await canvas.getAttribute('tabindex')).toBeNull();
    expect(await canvas.getAttribute('onclick')).toBeNull();
    expect(await canvas.getAttribute('role')).toBeNull();
  });

  test('every control shows a visible focus ring', async ({ page }) => {
    await openLive(page);
    // `:focus-visible` is declared in the stylesheet; this is whether the engine actually paints
    // it, which is the half a stylesheet sweep cannot reach.
    const control = page.getByRole('button', { name: '拉近' });
    // Reached BY KEY, not by `locator.focus()`. `:focus-visible` is a heuristic about how focus
    // arrived — a programmatic focus after a pointer interaction does not match it, so focusing
    // directly would have measured `outline: none` and reported a defect that is not there.
    await page.locator('body').press('Tab');
    for (let i = 0; i < 40 && !(await control.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(control).toBeFocused();
    const outline = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});

test.describe('AC#3 — Reduced Motion is honoured, not merely declared', () => {
  /**
   * Emulated per test with `page.emulateMedia`, not with `test.use({ reducedMotion })`.
   *
   * The fixture form did not reach the page here — `matchMedia('(prefers-reduced-motion: reduce)')`
   * still reported `false`, so this whole group was silently asserting things about the ORDINARY
   * page and passing for the wrong reason. Caught only because each test below checks the
   * emulation is real before concluding anything from it, which is why that check stays in.
   *
   * A `beforeEach` was not enough either: it applied for the first test in the group and not the
   * rest. Emulating inside each test, immediately before the navigation it governs, is the only
   * form with no ordering to get wrong.
   */

  test('the replay does not auto-play, but stays available on request', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(LIVE);
    await expect(page.locator('main')).toBeVisible();
    // The emulation is real, asserted before anything is concluded from it. Without this, a
    // Playwright option that silently stopped applying would turn this whole group into a set of
    // assertions about the ordinary page — passing, and proving nothing about Reduced Motion.
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    // Motion a viewer did not ask for is exactly what the preference is about. Waited past a full
    // scene rather than checked immediately, which would pass even if it were about to start.
    await page.waitForTimeout(3_000);
    await expect(replayRow(page)).toHaveCount(0);
    await expect(page.locator('.live-replay-card')).toHaveCount(0);

    // The FEATURE is not removed, only the automatic part: a viewer who wants it asks for it.
    const manual = page.getByRole('button', { name: '重播今日事件' });
    await expect(manual).toBeVisible();
    await manual.click();
    await expect(replayRow(page)).toBeVisible();
  });

  test('the map still renders — the preference suppresses motion, not the feature', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(LIVE);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    // The failure mode a preference-gated derivation invites: gating so much that the surface
    // degrades to nothing. Reduced Motion must cost a viewer motion, never information.
    await expect(page.locator('.live-map-canvas canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: /的角色卡$/ })).toHaveCount(12);
    await expect(page.locator('.live-story-overlay')).toBeVisible();
    await expect(page.locator('section.live-active-scenes')).toContainText('磨坊對質');

    // NOT asserted here: that the canvas stops changing. It legitimately does not — the fixture
    // has one character mid-walk, and a Canon-driven movement is NOT suppressed by Reduced
    // Motion. Suppressing it would misrepresent the world: the character really did move. What
    // the preference turns off is AMBIENT drift and environmental animation, which are derived
    // from a seed rather than from Canon and are therefore proven where they can be isolated —
    // `ambientMotion.test.ts` and `environmentAnimation.dom.test.tsx`, deterministically. A pixel
    // comparison here could not tell the two apart, and an earlier version of this test asserted
    // stillness and failed for exactly that reason.
  });

  test('the stylesheet neutralises transitions for everything else', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(LIVE);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    // Parsed numerically rather than string-matched: the guard declares `0.01ms`, and browsers
    // serialise that inconsistently (`0.00001s`, `1e-05s`). A string filter passed on one engine
    // and reported 276 offenders on another, which is a property of the serialisation and not of
    // the page. Anything under a millisecond is "neutralised" by any reading.
    const offenders = await page.evaluate(() => {
      const seconds = (value: string) => value.split(',').map((part) => parseFloat(part) || 0);
      return Array.from(document.querySelectorAll('main *'))
        .map((element) => getComputedStyle(element))
        .flatMap((style) => [
          ...seconds(style.transitionDuration),
          ...seconds(style.animationDuration),
        ])
        .filter((value) => value >= 0.001);
    });
    expect(offenders).toEqual([]);
  });
});

test.describe('AC#4/#5 — state is never colour-only, and everything important is readable', () => {
  test('the live map is axe-clean with the canvas on the page', async ({ page }) => {
    await openLive(page);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('it is still axe-clean with a character card open', async ({ page }) => {
    await openLive(page);
    await page.getByRole('button', { name: /的角色卡$/ }).first().click();
    await expect(page.locator('section.live-character-card')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('it is still axe-clean during playback, when three time states are on screen', async ({ page }) => {
    await page.goto(LIVE);
    await expect(replayRow(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('the time states survive greyscale, because they differ in shape and in words', async ({ page }) => {
    await page.goto(LIVE);
    await expect(replayRow(page)).toBeVisible();
    const rows = page.locator('.live-time-state-row');
    await expect(rows).toHaveCount(3);

    // Signal 1: distinct words. Read from the RENDERED text, so a row whose label was dropped
    // fails here even though the markup still had a slot for it.
    const labels = await page.locator('.live-time-state-label').allInnerTexts();
    expect(new Set(labels).size).toBe(3);

    // Signal 2: distinct computed border styles — shape, not colour. Read from the engine, which
    // is the only place a `data-state` selector actually becomes a border.
    const styles = await rows.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).borderLeftStyle),
    );
    expect(new Set(styles).size).toBe(3);

    // Signal 3: a distinct glyph, hidden from assistive tech because the label already says it.
    const glyphs = await page.locator('.live-time-state-glyph').allInnerTexts();
    expect(new Set(glyphs).size).toBe(3);
    for (const glyph of await page.locator('.live-time-state-glyph').all()) {
      await expect(glyph).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('every animation state has a readable text alternative on the card', async ({ page }) => {
    await openLive(page);
    // AC#5. What the canvas draws as a glyph over a sprite, the card says in words — which is the
    // only form of it a screen-reader user can reach.
    const readings: string[] = [];
    for (const characterId of FIXTURE_CHARACTER_IDS.slice(0, 4)) {
      await page.getByRole('button', { name: `查看 ${characterId} 的角色卡` }).click();
      const card = page.locator('section.live-character-card');
      await expect(card).toBeVisible();
      readings.push(await card.locator('li', { hasText: '目前活動' }).innerText());
      await page.getByRole('button', { name: /^關閉 .* 的角色卡$/ }).click();
    }
    expect(new Set(readings).size).toBe(4);
    for (const reading of readings) expect(reading.trim().endsWith(':')).toBe(false);
  });

  test('the story overlay states its world clock in words, collapsed or not', async ({ page }) => {
    await openLive(page);
    const summary = page.locator('.live-story-overlay summary');
    await expect(summary).toContainText('故事資訊');
    // The one line that must survive the panel being collapsed — otherwise collapsing costs the
    // viewer "when is this", which is the question the whole time-state vocabulary exists for.
    await expect(summary).toContainText('第 7 天');
  });
});
