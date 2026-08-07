import type { TimeStateBadge } from './timeStateLabel';

/**
 * The persistent time-state banner (FR-O014 / ART-121 AC#9).
 *
 * Always rendered, never conditional on a replay being in flight: a banner that appeared only
 * during playback would leave "is this live?" unanswered for the rest of the session, which is
 * the question RISK2-009 is about. Live state shows one row; playback shows three.
 *
 * `role="status"` with `aria-live="polite"` so a screen reader is told when the state changes
 * without being interrupted mid-sentence. Each row carries its own `announcement`, in a
 * visually-hidden span, because the visible layout reads as a label and a fragment while an
 * announcement has to be a sentence.
 */
export function TimeStateBanner({ badges }: { badges: readonly TimeStateBadge[] }) {
  return (
    <section
      className="live-time-state mt-3"
      role="status"
      aria-live="polite"
      aria-labelledby="live-time-state-heading"
    >
      <h2 id="live-time-state-heading" className="text-xl font-semibold">
        時間狀態
      </h2>
      <ul className="live-time-state-rows">
        {badges.map((badge) => (
          <li key={badge.state} className="live-time-state-row" data-time-state={badge.state}>
            {/* Shape, not colour. Hidden from assistive tech because the label beside it
                already says the same thing in words. */}
            <span className="live-time-state-glyph" aria-hidden="true">
              {badge.glyph}
            </span>
            <span className="live-time-state-label">{badge.label}</span>
            <span className="live-time-state-detail public-muted">{badge.detail}</span>
            <span className="sr-only">{badge.announcement}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
