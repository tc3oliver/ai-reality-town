import { expect, test, type Page } from '@playwright/test';

/**
 * A zh-Hant viewer never reads the canonical world name (ART-190).
 *
 * `mistwood` is still the world id and `Mistwood` is still what Canon and the seed call the town.
 * The policy is that neither reaches a viewer, and that the display name never appears beside them.
 *
 * The browser is where the whole path is exercised at once: the published `world:<worldId>`
 * projection arrives through a Convex subscription, the home page heads itself from the world id
 * before that read lands, and the watch guide resolves the name from a hash route that reads no
 * projection at all. A unit test covers each of those separately; only this covers them together.
 *
 * The last test is the point of the task. The home page rendered 「Mistwood」 as its `h1` and a
 * hardcoded 「現在的霧林鎮」 as the heading three lines below — so it scans the WHOLE page for the
 * canonical name rather than checking either heading on its own.
 */

const HOME = '/ai-town/#home/mistwood';
const HELP = '/ai-town/#help/mistwood';
const DISPLAY_NAME = '霧林鎮';

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('main')).toBeVisible();
}

test.describe('the home page', () => {
  test('heads itself with the display name', async ({ page }) => {
    await open(page, HOME);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DISPLAY_NAME);
  });

  test('uses the same name in the first screen’s heading', async ({ page }) => {
    await open(page, HOME);
    await expect(page.locator('#home-first-screen')).toHaveText(`現在的${DISPLAY_NAME}`);
  });
});

test.describe('the watch guide', () => {
  test('names the town in Chinese, in a route that reads no projection', async ({ page }) => {
    await open(page, HELP);
    await expect(page.locator('main')).toContainText(`${DISPLAY_NAME}是一個持續運作的 AI 世界`);
    await expect(page.locator('main')).toContainText(`目前的${DISPLAY_NAME}`);
  });
});

test.describe('the canonical name reaches no viewer', () => {
  /**
   * Every public route, scanned for the bare word. `Mistwood Station` and `Mistwood Chronicle` are
   * authored location names and are deliberately NOT translated by this task, so the check is for
   * `Mistwood` not followed by another capitalised word — the town itself, rather than a place
   * inside it.
   */
  const ROUTES = [
    ['home', HOME],
    ['help', HELP],
    ['episodes', '/ai-town/#episodes/mistwood'],
    ['episode', '/ai-town/#episode/mistwood/7'],
    ['timeline', '/ai-town/#timeline/mistwood'],
    ['graph', '/ai-town/#graph/mistwood'],
  ] as const;

  for (const [name, url] of ROUTES) {
    test(`${name} does not print the canonical world name`, async ({ page }) => {
      await open(page, url);
      const text = (await page.locator('main').innerText()) ?? '';
      // Non-empty first: a route that rendered nothing would pass the scan below trivially.
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\bMistwood\b(?!\s+[A-Z])/u);
    });
  }
});
