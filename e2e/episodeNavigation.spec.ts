import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_EPISODE_DAYS, FIXTURE_WORLD_ID } from '../src/e2e/fixtureWorld';

/**
 * The Episode page in a real browser (ART-189).
 *
 * The fixture registered no `episode:<worldDay>` model until this task, so every browser visit to
 * `#episode/mistwood/<day>` rendered 「找不到此故事」 and this P0 public surface had no browser
 * coverage at all — its recap depths, its related lists and its navigation were exercised only
 * through `EpisodeDetailView` in jsdom.
 *
 * That matters most for the navigation. `episodeNeighbours.test.ts` pins the rule and
 * `episodeNavigation.dom.test.tsx` pins that the component obeys it, but neither proves the page
 * READS the published index — the index arrives through a Convex subscription, and a component
 * wired to the wrong `modelRef` would pass both while offering nothing in a browser.
 *
 * `FIXTURE_EPISODE_DAYS` is `[3, 5, 7]` on purpose. Days 4 and 6 are holes, which is what makes
 * the "step over an unpublished day" case reachable here rather than only in a unit test.
 */

const EPISODE = (worldDay: number) =>
  `/ai-town/#episode/${FIXTURE_WORLD_ID}/${worldDay}`;

async function open(page: Page, worldDay: number) {
  await page.goto(EPISODE(worldDay));
  await expect(page.locator('main')).toBeVisible();
  // The page found a published Episode rather than falling to the not-found branch, which is the
  // precondition for every assertion below and is itself the fixture gap this spec closes.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('世界第');
}

test.describe('the navigation is bounded by what is published', () => {
  test('the newest Episode offers no next control, and says why', async ({ page }) => {
    await open(page, 7);
    const nav = page.locator('nav.episode-nav');
    await expect(nav).toContainText('這是目前最新的一集。');
    await expect(nav.getByRole('button', { name: /下一集/ })).toHaveCount(0);
  });

  test('the earliest Episode offers no previous control, and says why', async ({ page }) => {
    await open(page, FIXTURE_EPISODE_DAYS[0]);
    const nav = page.locator('nav.episode-nav');
    await expect(nav).toContainText('已經是最早一集。');
    await expect(nav.getByRole('button', { name: /上一集/ })).toHaveCount(0);
  });

  test('a next control names the nearest PUBLISHED day, not the adjacent one', async ({ page }) => {
    /**
     * Day 3's next published Episode is day 5; arithmetic would have offered day 4, which the
     * index does not list.
     *
     * This asserts the LABEL rather than following the control, because following it is a
     * different guarantee and was broken for a different reason: `PublicRoute` reads
     * `window.location.hash` during render and never subscribes to `hashchange`, so no public
     * hash navigation re-renders anything. That is ART-192, and its spec follows this control to
     * its destination once the router listens.
     */
    await open(page, 3);
    await expect(page.locator('nav.episode-nav'))
      .toContainText('下一集:第 2 集(世界日 5)');
  });

  test('a control names both the episode number and the world day it goes to', async ({ page }) => {
    await open(page, 5);
    await expect(page.locator('nav.episode-nav'))
      .toContainText('上一集:第 1 集(世界日 3)');
  });
});

test.describe('the page names what it links to (ART-187)', () => {
  test('關連角色 renders names, not ids', async ({ page }) => {
    await open(page, 7);
    const related = page.locator('section.related');
    await expect(related).toContainText('蘇美珍');
    await expect(related).not.toContainText('su-meizhen');
  });

  test('關連故事線 renders an arc title, not an arc id', async ({ page }) => {
    await open(page, 7);
    const arcs = page.locator('section.related-arcs');
    await expect(arcs).toContainText('休戰協議');
    await expect(arcs).not.toContainText('arc-truce');
  });
});
