/**
 * The daily environment ballot, as rendered on the homepage (FR-J001 / ART-45).
 *
 * PURELY PRESENTATIONAL. It holds no state, calls no hook, and knows nothing about Convex: the
 * model is {@link ./environmentVoteModel.ts} and the write channel is handed in as `onCast`.
 * That is not decoration — `Homepage`'s presentational half is deliberately renderable without a
 * Convex client so the accessibility suite can exercise the real markup, and a component that
 * bound the write itself would have taken that away from every page that contains it.
 *
 * It is also why this file sits outside the boundary exemption: only
 * {@link ./useEnvironmentVote.ts} may name a write API, and this component never needs to.
 *
 * Accessibility follows the same rules as every other public section (ART-93 / NFR-009): the
 * section is named by its own visible heading through `aria-labelledby`, the result message is a
 * live region so a refusal is announced rather than silently appearing, and each option is a
 * real `<button>` so it is reachable and operable from the keyboard.
 */

import {
  composeEnvironmentVoteViewModel,
  type EnvironmentVoteBallot,
  type VoteInteractionState,
} from './environmentVoteModel';

export function EnvironmentVotePanel({
  ballot,
  headingId,
  interaction = { kind: 'idle' },
  onCast,
  now = Date.now(),
}: {
  /** `undefined` while the query is in flight, `null` when no round is open. */
  ballot: EnvironmentVoteBallot | null | undefined;
  headingId: string;
  interaction?: VoteInteractionState;
  /** Omitted where there is no write channel; the ballot then renders without controls. */
  onCast?: (candidateId: string) => void;
  now?: number;
}) {
  const vm = composeEnvironmentVoteViewModel({
    ballot: ballot ?? null,
    interaction,
    now,
    canSubmit: onCast !== undefined,
  });

  return (
    <section className="vote mt-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        投票
      </h2>
      <p className="public-muted">{vm.status}</p>
      {vm.options.length > 0 && (
        <ul className="mt-2 list-none p-0">
          {vm.options.map((option) => (
            <li key={option.candidateId} className="mt-2">
              <button
                type="button"
                className="public-tap"
                disabled={!option.selectable}
                aria-pressed={option.chosen}
                onClick={() => onCast?.(option.candidateId)}
              >
                {option.title}
              </button>
              <span className="public-muted ml-2">
                {option.description}（{option.votes} 票 / {option.sharePercent}%）
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Always rendered, never conditionally: a live region a screen reader only meets after
          the message appears is a live region it has not been told to watch. */}
      <p className="public-muted mt-2" role="status" aria-live="polite">
        {vm.message ?? ''}
      </p>
      <p className="public-muted mt-2">{vm.disclaimer}</p>
    </section>
  );
}
