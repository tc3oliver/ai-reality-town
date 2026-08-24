import type { PublicStatusDescriptor } from './publicStatusBadge';

/**
 * The shared status/metadata chip row (FR-P003 / ART-131 AC#3, AC#7).
 *
 * Presentational only: descriptors in, markup out, no query and no state — the same contract
 * every other shared public component has. It is the one place a state is DRAWN, so the five
 * surfaces cannot render the same state four different ways.
 *
 * Each chip carries the three non-colour signals {@link ./publicStatusBadge} composes: the
 * visible label, an `aria-hidden` glyph (decorative, because the label beside it already says the
 * same thing in words), and a `data-state` attribute the stylesheet turns into a distinct
 * border-style. `publicPages.a11y.test.tsx` strips the class and the data attribute and checks
 * the remaining text still tells the states apart, so the claim survives greyscale AND the
 * stylesheet being off entirely.
 *
 * The full-sentence `announcement` is visually hidden rather than shown: a chip reads as a
 * fragment ("延遲"), and a fragment is not what a screen reader should hand a viewer asking what
 * state the world is in.
 */
export function PublicStatusChips({
  chips,
  label,
  live = false,
}: {
  chips: readonly PublicStatusDescriptor[];
  /** Names the group, since a bare row of chips is not self-describing. */
  label: string;
  /**
   * Whether the row should announce its own changes. `true` on surfaces where the state can
   * change while the viewer is looking at it (the runtime freshness); `false` for the world
   * clock, which changes with the page rather than under it, and where a live region would
   * interrupt for something nobody asked to be told about.
   */
  live?: boolean;
}) {
  if (chips.length === 0) return null;
  const row = (
    <ul className="public-chip-row" aria-label={label}>
      {chips.map((chip) => (
        <li
          key={`${chip.state ?? 'meta'}:${chip.label}`}
          className="public-chip"
          {...(chip.state === null ? {} : { 'data-state': chip.state })}
        >
          <span className="public-chip-glyph" aria-hidden="true">
            {chip.glyph}
          </span>
          <span className="public-chip-label">{chip.label}</span>
          <span className="sr-only">{chip.announcement}</span>
        </li>
      ))}
    </ul>
  );

  // The live region is a WRAPPER, never `role="status"` on the `<ul>` itself. An ARIA role
  // replaces the element's implicit one, so putting it on the list would strip the list role and
  // leave every `<li>` without a valid parent — axe's `aria-required-parent`, and a screen reader
  // that no longer announces "list, 4 items". Caught by this suite when it was written that way.
  return live ? (
    <div role="status" aria-live="polite">
      {row}
    </div>
  ) : (
    row
  );
}
