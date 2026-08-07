import { PublicPageFrame } from './PublicPageFrame';
import { composeHelpViewModel, parseHelpRoute, type HelpViewModel } from './helpRoute';

/**
 * Watch-only help page (ART-113 / FR-N002 AC#8), replacing the retired a16z
 * "how to play" modal. Renders static content only -- no query, no read model,
 * nothing to fail.
 *
 * Thin render layer: content and route logic live in {@link ./helpRoute}
 * (pure, unit-tested).
 */
export default function HelpPage() {
  const route = typeof window === 'undefined' ? null : parseHelpRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  return (
    <HelpView
      worldId={worldId}
      vm={composeHelpViewModel({ worldId, base: import.meta.env.BASE_URL })}
    />
  );
}

/**
 * Presentational help page. Split out from the default export so the
 * accessibility suite can render the real markup.
 */
export function HelpView({ worldId, vm }: { worldId: string | null; vm: HelpViewModel }) {
  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">{vm.title}</h1>
        <p className="mt-2">{vm.intro}</p>
      </header>

      {vm.sections.map((section) => (
        <section key={section.id} className="mt-4" aria-labelledby={section.id}>
          <h2 id={section.id} className="text-xl font-semibold">
            {section.heading}
          </h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="mt-1">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      {/* NFR-009 AC#3: the text Live View is the non-map equivalent, and the
          help page is one of the places a viewer is told where to find it. */}
      {vm.textLiveHref !== null && (
        <p className="mt-4">
          <a href={vm.textLiveHref}>開啟文字實況(不需地圖)</a>
        </p>
      )}
    </PublicPageFrame>
  );
}
