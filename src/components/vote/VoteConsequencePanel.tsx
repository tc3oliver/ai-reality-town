/**
 * The viewer-intervention consequence view, rendered beside the ballot (FR-J002 / ART-46).
 *
 * PURELY PRESENTATIONAL, for the same reason {@link ./EnvironmentVotePanel.tsx} is: it holds no
 * state, calls no hook, and knows nothing about Convex. The published payload is handed in, so
 * `HomepageView` stays renderable without a Convex client and the accessibility suite keeps
 * exercising the real markup.
 *
 * It also has to be presentational for a structural reason. `src/components/vote` is the
 * `clientViewerWrite` module, which may not depend on `publicRead`; the `getPublishedReadModel`
 * read therefore lives on the homepage (`clientPublic`), which may. The panel next to which this
 * one belongs is the ballot, so this is where the file lives — with the read on the other side
 * of the boundary, where the boundary requires it.
 *
 * Every correctness boundary — which bucket says what, how an empty bucket is worded, how a
 * withheld summary is shown — lives in {@link ./voteConsequenceModel.ts} and is unit-tested
 * without a DOM.
 *
 * Accessibility follows the same rules as every other public section (ART-93 / NFR-009): the
 * section is named by its own visible heading through `aria-labelledby`, headings run h2 → h3
 * with no skipped level, and muted text uses the measured `.public-muted` token.
 */

import {
  composeVoteConsequenceViewModel,
  type VoteConsequencePayload,
} from './voteConsequenceModel';

export function VoteConsequencePanel({
  payload,
  headingId,
  loading = false,
}: {
  /** `undefined` while the query is in flight, `null` when nothing was published for the day. */
  payload: VoteConsequencePayload | null | undefined;
  headingId: string;
  /**
   * True while a read this section depends on has not settled.
   *
   * Separate from `payload` being absent because the homepage cannot name this model until the
   * live projection has told it the world day — so "missing" is the normal state for the first
   * frame of every load, and rendering 「尚未有投票後果資料。」 there would state something untrue.
   */
  loading?: boolean;
}) {
  const vm = composeVoteConsequenceViewModel({ payload, loading });

  return (
    <section className="vote-consequence mt-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        投票後續追蹤
      </h2>
      <p className="public-muted">{vm.status}</p>
      {/* Rendered before the buckets, because on today's data it is the finding and the empty
          lists below are its consequence — not the other way round. */}
      {vm.causalEvidenceNote !== null && (
        <p className="public-muted mt-2">{vm.causalEvidenceNote}</p>
      )}
      {vm.sections.map((section) => (
        <div key={section.key} className={`vote-consequence-${section.key} mt-3`}>
          <h3 className="font-medium">{section.title}</h3>
          <p className="public-muted text-sm">{section.description}</p>
          {section.items.length > 0 ? (
            <ul className="public-rows text-sm mt-1">
              {section.items.map((item) => (
                <li key={item.eventId}>
                  <span>{item.summary}</span>
                  <span className="public-muted ml-2">{item.when}</span>
                  {item.depthLabel !== null && (
                    <span className="public-muted ml-2">{item.depthLabel}</span>
                  )}
                  {/* AC#3 on screen: a viewer can see what each row rests on, not just that
                      the system asserts it. */}
                  <span className="public-muted ml-2">{item.basisLabel}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="public-muted text-sm mt-1">{section.emptyText}</p>
          )}
        </div>
      ))}
      {/* Unconditional (AC#2). A disclaimer a viewer only meets when the system happens to be
          unsure reads as an apology for one screen rather than as how the world works. */}
      <p className="public-muted mt-2">{vm.disclaimer}</p>
    </section>
  );
}
