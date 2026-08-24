/**
 * Shared chrome for every P0 public experience (ART-93, NFR-009).
 *
 * Replaces the near-identical `Frame` helpers that previously lived in
 * Homepage / LiveView / EpisodeList / EpisodeDetail / CharacterPage /
 * ArcDetailPage, so the accessibility guarantees are declared once:
 *
 * - `lang="zh-Hant"` on the public subtree. `index.html` declares
 *   `<html lang="en">` for the English game runtime and all public copy is
 *   Traditional Chinese, so the language of the part has to be marked
 *   (WCAG 2.1 3.1.2).
 * - Exactly one `<main>` landmark per page.
 * - The back link lives in a labelled `<nav>` *outside* `<main>`; it used to be
 *   the first child of `<main>`, which put navigation inside the main landmark.
 *
 * No skip link: the public routes are hash routes (`#home/…`, `#live/…`), so an
 * in-page `href="#main"` fragment would be swallowed by the router. It is also
 * unnecessary — WCAG 2.4.1 asks for a way past *blocks* of repeated content,
 * and these pages have at most one link before `<main>`. The `<main>` landmark
 * itself is the bypass mechanism (technique ARIA11). See docs/accessibility.md.
 */

export const PUBLIC_MAIN_ID = 'public-main';

/**
 * How wide the reading column is allowed to get.
 *
 * `default` is the prose measure every text page wants: `max-w-2xl` keeps a line of Traditional
 * Chinese at a comfortable length, and widening it would make the episode and character pages
 * harder to read, not easier.
 *
 * `wide` exists for exactly one surface — the live map (FR-O008 / ART-126). Its content is a
 * canvas beside a panel rather than a column of prose, and AC#1 requires the map and the story
 * overlay to be visible at the same time on desktop, which a 672px column cannot do. It is opt-in
 * per page rather than a global change so no prose page silently loses its measure.
 */
export type PublicPageWidth = 'default' | 'wide';

const WIDTH_CLASS: Record<PublicPageWidth, string> = {
  default: 'max-w-2xl',
  wide: 'max-w-5xl',
};

export function PublicPageFrame({
  worldId,
  showBackLink = true,
  width = 'default',
  children,
}: {
  worldId: string | null;
  /** Homepage is the back-link destination, so it renders no back navigation. */
  showBackLink?: boolean;
  /** Omitted keeps the prose measure, so every existing page is unchanged. */
  width?: PublicPageWidth;
  children: React.ReactNode;
}) {
  return (
    <div lang="zh-Hant" className={`public-page mx-auto ${WIDTH_CLASS[width]} p-4 font-body`}>
      {showBackLink && (
        <nav aria-label="頁面導覽">
          <a className="public-tap text-sm" href={worldId ? `#home/${worldId}` : '#home'}>
            返回首頁
          </a>
        </nav>
      )}
      <main id={PUBLIC_MAIN_ID} className="mt-3">
        {children}
      </main>
    </div>
  );
}
