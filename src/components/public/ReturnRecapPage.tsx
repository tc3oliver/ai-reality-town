import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';

import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import { ReturnRecapView } from '../recap/ReturnRecapView';
import {
  composeReturnRecapViewModel,
  parseRecapRoute,
  type RecapEpisodeIndex,
  type RecapTimeline,
  type RecapVoteConsequence,
  type SpoilerMode,
} from '../recap/returnRecap';
import { browserViewerProgressKey } from '../recap/viewerProgressKey';
import { useRecordViewerProgress, useStoredViewerProgress } from '../recap/useViewerProgress';
import { voteConsequenceModelRef } from '../../../convex/shared/environmentVoteCatalog';

/**
 * Device-aware return recap (FR-H004 / ART-39), on its own route: `#recap/<worldId>`.
 *
 * ## Why not the homepage
 *
 * `e2e/dynamicView.spec.ts` asserts that loading the homepage produces zero writes AND an
 * exhaustive set of queries. Both are ART-127 / ART-137 evidence for「公開觀看不執行任何成功
 * Mutation」. A per-viewer progress read and a follow control on the homepage would change the
 * query set and put a write control on the surface those assertions describe. A separate route
 * keeps the homepage's evidence exactly as it was and gives the recap its own, narrower claim:
 * this page reads three published models plus this device's own progress row, and writes only
 * when the viewer presses something.
 *
 * ## Nothing writes on load
 *
 * `useRecordViewerProgress` binds the mutation and is invoked from event handlers only. There is
 * no effect on this page — no `useEffect` that records a visit, no auto-marking of position.
 * Recording progress is something the viewer does, which is also the only reading of「裝置層級
 * 進度」that does not amount to tracking someone who never asked to be remembered.
 *
 * Thin render layer: route resolution, the view model and every string live in
 * {@link ../recap/returnRecap} (pure, unit-tested); the markup is {@link ../recap/ReturnRecapView}
 * (pure, exercised by the accessibility suite).
 */
export default function ReturnRecapPage() {
  const route = typeof window === 'undefined' ? null : parseRecapRoute(window.location.hash);
  const worldId = route?.worldId ?? null;

  // Resolved once per mount. `null` means this browser refuses `localStorage`, in which case the
  // page degrades to a read-only recap rather than minting a throwaway key on every render —
  // which would create a new server row per page load.
  const deviceKey = useMemo(() => browserViewerProgressKey(), []);

  const progress = useStoredViewerProgress(worldId, deviceKey);
  const episodes = useQuery(
    getPublishedReadModelRef,
    worldId !== null ? { worldId, modelKind: 'episode', modelRef: `episodes:${worldId}` } : 'skip',
  );
  const timeline = useQuery(
    getPublishedReadModelRef,
    worldId !== null ? { worldId, modelKind: 'timeline', modelRef: `timeline:${worldId}` } : 'skip',
  );

  const episodeIndex = (episodes?.payload ?? null) as RecapEpisodeIndex | null;
  // The consequence model is per world DAY, so the day has to come from somewhere. The latest
  // published episode is that source: it costs no extra read, and it is the same day the recap is
  // already summarising up to. Before the index arrives the read is skipped rather than guessed.
  const latestWorldDay = episodeIndex === null || episodeIndex.episodes.length === 0
    ? null
    : Math.max(...episodeIndex.episodes.map((episode) => episode.worldDay));
  const voteEnabled = worldId !== null && latestWorldDay !== null;
  const voteConsequence = useQuery(
    getPublishedReadModelRef,
    voteEnabled
      ? {
          worldId,
          modelKind: 'voteConsequence',
          modelRef: voteConsequenceModelRef(worldId, latestWorldDay),
        }
      : 'skip',
  );

  const record = useRecordViewerProgress();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The optimistic local copy of what was last accepted. The server row stays the source of
  // truth; this only keeps the controls responsive between a click and the query re-resolving.
  const [applied, setApplied] = useState<{
    lastViewedEpisodeId: string | null;
    followedCharacterIds: string[];
    followedArcIds: string[];
    spoilerMode: string;
    updatedAt: number;
  } | null>(null);

  if (worldId === null) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">回訪摘要</h1>
        <p className="mt-2">
          網址格式應為 <code>#recap/&lt;worldId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }

  const loading = episodes === undefined || timeline === undefined
    || (deviceKey !== null && progress === undefined);
  // Tracked separately because this read resolves LAST by construction: its `modelRef` contains a
  // world day only the episode index can supply, so it is `'skip'` until that index arrives.
  // `useQuery` returns `undefined` for skipped and in-flight alike, so "in flight" has to be
  // derived from whether the read was enabled at all — otherwise the section would either claim
  // an absence during the window or never stop claiming to load.
  const voteLoading = voteEnabled && voteConsequence === undefined;
  const current = applied ?? progress ?? null;

  const vm = composeReturnRecapViewModel({
    worldId,
    progress: current,
    episodes: episodeIndex,
    timeline: (timeline?.payload ?? null) as RecapTimeline | null,
    voteConsequence: (voteConsequence?.payload ?? null) as RecapVoteConsequence | null,
    loading,
    voteLoading,
    storageAvailable: deviceKey !== null,
  });

  /**
   * Send the whole record, not a delta.
   *
   * `recordViewerProgress` validates the complete §13.12 record on every call, so a partial
   * update would have to be merged somewhere — and the only place that could merge it is the
   * handler, which would then need a notion of "unchanged" that a caller could exploit to skip
   * validation on a field. Sending everything keeps one validated shape and one code path.
   */
  const submit = (next: {
    lastViewedEpisodeId: string | null;
    followedCharacterIds: string[];
    followedArcIds: string[];
    spoilerMode: string;
  }) => {
    if (deviceKey === null || pending) return;
    setPending(true);
    setStatus(null);
    void record({ worldId, deviceKey, ...next })
      .then((result) => {
        if (result.accepted) {
          setApplied({ ...next, updatedAt: Date.now() });
          setStatus('已更新這個裝置的進度。');
        } else {
          // The stable code, not a sentence built from it: the server deliberately returns a code
          // that names no submitted value, and expanding every one of them here would re-invent
          // the echo the mutation refuses to perform.
          setStatus(`這次更新沒有被接受(${result.code ?? 'UNKNOWN'})。`);
        }
      })
      .catch(() => setStatus('更新進度時發生問題,請稍後再試。'))
      .finally(() => setPending(false));
  };

  const base = {
    lastViewedEpisodeId: current?.lastViewedEpisodeId ?? null,
    followedCharacterIds: current?.followedCharacterIds ?? [],
    followedArcIds: current?.followedArcIds ?? [],
    spoilerMode: current?.spoilerMode ?? vm.spoilerMode,
  };
  const toggled = (values: string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

  return (
    <PublicPageFrame worldId={worldId}>
      <ReturnRecapView
        vm={vm}
        handlers={{
          onToggleCharacter: (characterId) =>
            submit({ ...base, followedCharacterIds: toggled(base.followedCharacterIds, characterId) }),
          onToggleArc: (arcId) =>
            submit({ ...base, followedArcIds: toggled(base.followedArcIds, arcId) }),
          onSpoilerModeChange: (mode: SpoilerMode) => submit({ ...base, spoilerMode: mode }),
          onMarkWatched: () => {
            if (vm.markableEpisodeId === null) return;
            submit({ ...base, lastViewedEpisodeId: vm.markableEpisodeId });
          },
          statusMessage: status,
          controlsEnabled: deviceKey !== null && !pending,
        }}
      />
    </PublicPageFrame>
  );
}
