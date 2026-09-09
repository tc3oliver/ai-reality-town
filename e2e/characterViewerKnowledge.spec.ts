import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * FR-I005's last two public fields, in a real browser (ART-169).
 *
 * ## What only this file can settle
 *
 * `characterRoute.test.ts` proves the view-model mapping and `publicPages.a11y.test.tsx` proves
 * the markup, but both stop short of the thing ART-169 AC#4 actually asks for: that the page
 * READS the new read model and RENDERS it. The a11y suite renders `CharacterPageView` directly
 * with a view model handed to it, so it would keep passing if `CharacterPage` never issued the
 * `viewerKnowledge` query at all — the field would be published, the section would be on the
 * page, and every viewer would see it empty forever.
 *
 * The E2E fixture transport throws on an unregistered query
 * (`src/e2e/fixtureConvexClient.ts`), so a page that asked for the wrong `modelRef` fails loudly
 * here too. That is the second half of the same guarantee: the address the page asks for and the
 * address the server publishes are one string, built by `convex/shared/viewerKnowledgeRef.ts`.
 *
 * ## The empty case is the one a real world spends its time in
 *
 * Only the first resident's fixture payload carries rows. FR-K004 reserves `publish` for an
 * administrator, so an Episode in a running world stops at `ready` and these sections are
 * legitimately empty most of the time — which is why the placeholder prose is asserted with the
 * same weight as the populated rows. A section that rendered nothing at all when empty would tell
 * a viewer that the question had not been asked.
 */

const BASE = '/ai-town';
const WORLD = 'mistwood';
/** The one resident the fixture gives a revealed secret and an unknown fact. */
const REVEALED = 'lin-yingxue';
/** Any other resident: published, and with nothing the viewer has been told. */
const QUIET = 'gao-wenrui';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const characterUrl = (characterId: string) => `${BASE}/#character/${WORLD}/${characterId}`;

async function open(page: Page, characterId: string) {
  await page.goto(characterUrl(characterId));
  await expect(page.locator('main')).toBeVisible();
  // The sections are rendered from a query result, so waiting for the heading is waiting for the
  // read to have resolved rather than for a static shell.
  await expect(page.locator('.character-secrets h2')).toHaveText('觀眾已知秘密');
}

test.describe('FR-I005 觀眾已知秘密 / 角色不知道但觀眾知道的資訊', () => {
  test('the character page renders both fields from the published read model', async ({ page }) => {
    await open(page, REVEALED);

    const secrets = page.locator('.character-secrets');
    await expect(secrets.locator('li')).toHaveCount(1);
    await expect(secrets).toContainText('他在水車停轉那晚把舊帳本搬離了磨坊。');

    const irony = page.locator('.character-irony');
    await expect(irony.locator('h2')).toHaveText('角色還不知道的事');
    await expect(irony.locator('li')).toHaveCount(1);
    await expect(irony).toContainText('鎮公所已排定水車聽證會:第九日上午');
    // The scope line, which is what stops an empty list reading as "there is nothing".
    await expect(irony).toContainText('以第 6 日之後已發布的故事為準。');
  });

  test('each row links to the world day that published it', async ({ page }) => {
    await open(page, REVEALED);
    // The provenance FR-I005 needs: a viewer can go and read the story the secret came out in.
    await expect(page.locator('.character-secrets a')).toHaveAttribute(
      'href', `#episode/${WORLD}/6`);
    await expect(page.locator('.character-irony a')).toHaveAttribute(
      'href', `#episode/${WORLD}/7`);
  });

  test('a character the viewer has been told nothing about says so', async ({ page }) => {
    await open(page, QUIET);
    await expect(page.locator('.character-secrets')).toContainText(
      '觀眾還沒有從已發布的故事裡得知這個角色的任何秘密。');
    await expect(page.locator('.character-secrets li')).toHaveCount(0);
    await expect(page.locator('.character-irony')).toContainText(
      '觀眾知道的公開資訊,這個角色目前都已經知道了。');
  });

  test('the page is axe-clean with both sections populated', async ({ page }) => {
    await open(page, REVEALED);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  test('both row links are reachable from the keyboard and named distinctly', async ({ page }) => {
    await open(page, REVEALED);
    const names = await page.locator('.character-secrets a, .character-irony a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('aria-label') ?? ''));
    expect(names).toHaveLength(2);
    // WCAG 2.4.4: both links read 「第 N 日故事」 on screen, so the accessible name has to carry
    // what each one is a link to.
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name.length).toBeGreaterThan('第 7 日故事'.length);
  });
});
