import { PublicStatusChips } from '../public/PublicStatusChips';
import { freshnessDescriptor } from '../public/publicStatusBadge';
import type { PublicStatusDescriptor } from '../public/publicStatusBadge';
import {
  degradationDescriptor,
  degradationReasonSentence,
  lastUpdatedDescriptor,
  type DegradationVerdict,
} from './degradationLadder';

/**
 * What rung the viewer is on, when it was last updated, and why (FR-O010 / ART-127 AC#3).
 *
 * ## Rendered at EVERY rung, including the top
 *
 * AC#3 asks for the last-updated time and the current status "at every level", and a notice
 * that only appeared when something was wrong would fail it in the one case that matters
 * most: a viewer looking at the top rung has no way to tell whether the absence of a notice
 * means "everything is fine" or "this page does not have that feature". The same reasoning
 * `TimeStateBanner` (ART-121) used for staying mounted outside of playback — if the banner
 * only appears during a replay, "is this live?" has no answer the rest of the time.
 *
 * ## Chips, not a sentence
 *
 * The state row reuses `PublicStatusChips` and the three-non-colour-signal vocabulary from
 * ART-131, so a degraded rung is drawn by the same machinery as every other public state and
 * cannot end up looking like a different product. The REASON is a sentence rather than a chip
 * because it is the one part that is a explanation rather than a state, and compressing
 * "這個瀏覽器沒有可用的 WebGL" into a chip label would lose the only actionable part of it.
 *
 * `live` on the chip row: this state genuinely changes under the viewer — the whole point of
 * the ladder is that it climbs back on its own (AC#5) — so a viewer who is not watching the
 * chips still gets told when it does.
 */
export function DegradationNotice({
  verdict,
  freshness,
  updatedAt,
  nowMs,
}: {
  verdict: DegradationVerdict;
  /** The server's own verdict on the content it served, or `null` when unknown. */
  freshness?: string | null;
  /** When the content on screen was last updated, or `null` when unknown. */
  updatedAt?: number | null;
  nowMs: number;
}) {
  const chips: PublicStatusDescriptor[] = [degradationDescriptor(verdict.level)];
  // Kept as a SEPARATE chip rather than folded into the level. "Which rung am I on" and "how
  // fresh is the content on it" are different questions: a snapshot rung can be minutes old
  // or half a day old, and the rung alone does not say which.
  const freshnessChip = freshnessDescriptor(freshness ?? null);
  if (freshnessChip !== null) chips.push(freshnessChip);
  const updatedChip = lastUpdatedDescriptor(updatedAt ?? null, nowMs);
  if (updatedChip !== null) chips.push(updatedChip);

  const reason = degradationReasonSentence(verdict.reason);

  return (
    <div className="degradation-notice" data-level={verdict.level}>
      <PublicStatusChips chips={chips} label="畫面狀態" live />
      {reason !== null && <p className="text-sm public-muted">{reason}</p>}
    </div>
  );
}
