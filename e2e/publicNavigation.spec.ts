import { expect, test, type Page } from '@playwright/test';

/**
 * Following a public link actually goes somewhere (ART-192).
 *
 * `PublicRoute` read `window.location.hash` during render and subscribed to nothing. A hash link
 * fires no navigation and reloads nothing, so React was never told the route moved: clicking any
 * public link changed the address bar and re-rendered the page the viewer was already on. Every
 * link was affected — the home page's character links, an Episode's related lists, the timeline's
 * 「查看本日故事」, 上一集 / 下一集, the recommended-episode call to action, 返回首頁.
 *
 * ## Why a full browser suite missed it
 *
 * Every existing spec navigates with `page.goto()`, and a full load reads the hash correctly.
 * Nothing anywhere FOLLOWED a link. That is the single rule this file exists to hold: each test
 * below must reach its destination by clicking, and `goto` may only be used to arrive at the
 * starting page.
 *
 * `RelationshipGraphView` worked throughout, because ART-44 gave it its own subscription. Its
 * docblock also asserted that a cross-route link 「re-enters `PublicRoute` through a different
 * branch and remounts」, which was the wrong half of the right observation: re-entering
 * `PublicRoute` requires `PublicRoute` to render again.
 */

const HOME = '/ai-town/#home/mistwood';

/** Arrive somewhere. The ONLY `goto` allowed in this file — everything else must be a click. */
async function arrive(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('main')).toBeVisible();
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

test.describe('following a link renders the destination', () => {
  test('a character link from the home page opens that character', async ({ page }) => {
    await arrive(page, HOME);
    // The cast on the first screen. Its visible text is the resident's name (ART-186/191).
    await page.locator('ul.home-cast a').first().click();
    await expect(page).toHaveURL(/#character\/mistwood\//);
    await expect(heading(page)).toHaveText('林映雪');
  });

  test('返回首頁 goes back to the home page', async ({ page }) => {
    await arrive(page, HOME);
    await page.locator('ul.home-cast a').first().click();
    await expect(heading(page)).toHaveText('林映雪');
    await page.getByRole('navigation', { name: '頁面導覽' }).getByRole('link').click();
    await expect(page).toHaveURL(/#home\/mistwood$/);
    await expect(heading(page)).not.toHaveText('林映雪');
  });

  test('the recommended-episode call to action opens that Episode', async ({ page }) => {
    await arrive(page, HOME);
    await page.getByRole('link', { name: /開始認識這個世界/ }).click();
    await expect(page).toHaveURL(/#episode\/mistwood\/\d+$/);
    await expect(heading(page)).toContainText('世界第');
  });

  test('an Episode’s related-character link opens that character', async ({ page }) => {
    await arrive(page, '/ai-town/#episode/mistwood/7');
    await page.locator('section.related a[href^="#character/"]').first().click();
    await expect(page).toHaveURL(/#character\/mistwood\/su-meizhen$/);
    /**
     * The exact name, not「contains no hyphen」.
     *
     * The first version of this assertion was `not.toContainText('-')`, which the fault injection
     * caught as unfailable: the Episode heading is 「世界第 7 天」 and contains no hyphen either, so
     * the test passed on a page that had not navigated at all. It is the one test of the eight that
     * survived removing the subscription — for the wrong reason.
     */
    await expect(heading(page)).toHaveText('蘇美珍');
  });
});

test.describe('changing the hash of the SAME route', () => {
  test('下一集 renders the next Episode, across an unpublished day', async ({ page }) => {
    /**
     * `#episode/mistwood/3` → `#episode/mistwood/5` changes no route branch, so the component is
     * reconciled rather than remounted. This is the case ART-44 had to solve for the graph and
     * that nothing else handled. Day 4 is unpublished, so this is also ART-189's bound, followed.
     */
    await arrive(page, '/ai-town/#episode/mistwood/3');
    await expect(heading(page)).toHaveText('世界第 3 天');
    await page.locator('nav.episode-nav').getByRole('button', { name: /下一集/ }).click();
    await expect(page).toHaveURL(/#episode\/mistwood\/5$/);
    await expect(heading(page)).toHaveText('世界第 5 天');
  });

  test('the relationship graph’s date stepper still works', async ({ page }) => {
    // It had its own subscription and now shares the router's. A regression here would mean the
    // extraction cost the one page that already worked.
    await arrive(page, '/ai-town/#graph/mistwood');
    await page.getByRole('link', { name: /查看世界日 6 的關係圖/ }).click();
    await expect(page).toHaveURL(/#graph\/mistwood\/6$/);
    await expect(page.locator('header')).toContainText('世界日 6');
  });
});

test.describe('browser history', () => {
  test('back returns to the page the viewer came from', async ({ page }) => {
    await arrive(page, HOME);
    await page.locator('ul.home-cast a').first().click();
    await expect(heading(page)).toHaveText('林映雪');
    await page.goBack();
    await expect(page).toHaveURL(/#home\/mistwood$/);
    await expect(heading(page)).not.toHaveText('林映雪');
  });

  test('forward returns to the destination', async ({ page }) => {
    await arrive(page, HOME);
    await page.locator('ul.home-cast a').first().click();
    await page.goBack();
    await page.goForward();
    await expect(heading(page)).toHaveText('林映雪');
  });
});
