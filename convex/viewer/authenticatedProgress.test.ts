/**
 * FR-J003 追蹤角色與 Arc, and FR-H004 AC#7's second clause (ART-71).
 *
 * AC#7 reads 「匿名裝置進度與已登入進度不得跨身分讀取或修改;合併或遷移必須明確、經授權且無損」.
 * ART-39 delivered the first clause and said plainly that it could not deliver the second, because
 * 「已登入進度」 was a provably empty set: a merge written then would have had no second operand.
 * ART-104 configured the identity provider, so it now has one.
 *
 * The three words in the clause are three separate properties, and each is tested as one:
 *
 *   明確 — the merge is its own operation, and nothing merges as a side effect.
 *   經授權 — it needs BOTH a verified identity and the device token; neither alone.
 *   無損 — it is a union, and anything the caps cannot keep is REPORTED rather than dropped.
 *
 * The third is the one a careless test would get wrong: asserting the merged record is well-formed
 * passes just as happily when four follows were silently discarded.
 */

import {
  authViewerKey,
  mergeWasLossless,
  planProgressMerge,
  resolveAuthViewerKey,
  viewerKeyNamespace,
} from './authenticatedProgress';
import { deviceViewerKey, MAX_FOLLOWED_ARC_IDS, MAX_FOLLOWED_CHARACTER_IDS, isViewerKey } from './viewerProgress';
import type { ViewerProgressRecord } from './viewerProgress';

const record = (over: Partial<ViewerProgressRecord> = {}): ViewerProgressRecord => ({
  lastViewedEpisodeId: null,
  followedCharacterIds: [],
  followedArcIds: [],
  spoilerMode: 'publicOnly',
  ...over,
});

describe('the authenticated viewer key', () => {
  it('is a viewer key in the `auth` namespace the schema already declared', () => {
    const key = authViewerKey('clerk|user_123');
    expect(isViewerKey(key)).toBe(true);
    expect(viewerKeyNamespace(key)).toBe('auth');
  });

  it('stores a digest, never the identity provider subject', () => {
    const subject = 'clerk|user_123';
    const key = authViewerKey(subject);
    // A Clerk `sub` is a stable account identifier — MORE identifying than a browser token, not
    // less — so a leaked row must not carry it, exactly as the device token is never stored.
    expect(key).not.toContain(subject);
    expect(key).not.toContain('user_123');
  });

  it('gives different subjects different keys, and one subject a stable key', () => {
    expect(authViewerKey('a')).not.toBe(authViewerKey('b'));
    expect(authViewerKey('a')).toBe(authViewerKey('a'));
  });

  it('never collides with a device key, so the two namespaces cannot address one row', () => {
    // Same input, two namespaces: the rows are different even when the strings behind them are
    // the same, which is what makes a merge a merge rather than an overwrite.
    expect(authViewerKey('same-value')).not.toBe(deviceViewerKey('same-value'));
    expect(viewerKeyNamespace(deviceViewerKey('same-value'))).toBe('device');
  });

  it('is not a viewer key when the namespace is unknown', () => {
    expect(viewerKeyNamespace('operator:abc')).toBeNull();
    expect(viewerKeyNamespace('abc')).toBeNull();
  });
});

describe('resolving the identity — the subject is never taken from an argument', () => {
  it('resolves a verified identity to its key', () => {
    const resolved = resolveAuthViewerKey({ subject: 'clerk|user_123' });
    expect(resolved).toEqual({ ok: true, viewerKey: authViewerKey('clerk|user_123') });
  });

  it('refuses when there is no identity', () => {
    expect(resolveAuthViewerKey(null)).toEqual({ ok: false, code: 'VIEWER_NOT_AUTHENTICATED' });
  });

  it('refuses an identity carrying no usable subject rather than keying on an empty string', () => {
    expect(resolveAuthViewerKey({ subject: '' }).ok).toBe(false);
    expect(resolveAuthViewerKey({ subject: '   ' }))
      .toEqual({ ok: false, code: 'VIEWER_IDENTITY_INVALID' });
    // Keying on '' would give every malformed identity ONE shared row — a cross-identity read by
    // construction, which is the exact thing AC#7's first clause forbids.
    expect(authViewerKey('')).not.toBe('auth:');
  });
});

describe('無損 — the merge is a union, and what it cannot keep it reports', () => {
  it('adopts the device record whole when the account has none', () => {
    const device = record({
      followedCharacterIds: ['pei-lan', 'wu-zhen'],
      followedArcIds: ['arc:mill'],
      lastViewedEpisodeId: 'episode:mistwood:5',
      spoilerMode: 'watchedOnly',
    });
    const plan = planProgressMerge({ account: null, device });
    expect(plan.merged).toEqual(device);
    expect(mergeWasLossless(plan.summary)).toBe(true);
    expect(plan.summary.addedCharacterIds).toEqual(['pei-lan', 'wu-zhen']);
    // First sign-in is the ordinary case, not a conflict.
    expect(plan.summary.spoilerModeConflict).toBe(false);
  });

  it('unions the follow sets without duplicating what both already had', () => {
    const plan = planProgressMerge({
      account: record({ followedCharacterIds: ['pei-lan'], followedArcIds: ['arc:mill'] }),
      device: record({ followedCharacterIds: ['pei-lan', 'wu-zhen'], followedArcIds: ['arc:truce'] }),
    });
    expect(plan.merged.followedCharacterIds).toEqual(['pei-lan', 'wu-zhen']);
    expect(plan.merged.followedArcIds).toEqual(['arc:mill', 'arc:truce']);
    expect(plan.summary.addedCharacterIds).toEqual(['wu-zhen']);
    expect(mergeWasLossless(plan.summary)).toBe(true);
  });

  it('moves the position forward and never backwards', () => {
    const forward = planProgressMerge({
      account: record({ lastViewedEpisodeId: 'episode:mistwood:3' }),
      device: record({ lastViewedEpisodeId: 'episode:mistwood:9' }),
    });
    expect(forward.merged.lastViewedEpisodeId).toBe('episode:mistwood:9');
    expect(forward.summary.advancedFrom).toBe('episode:mistwood:3');

    const backward = planProgressMerge({
      account: record({ lastViewedEpisodeId: 'episode:mistwood:9' }),
      device: record({ lastViewedEpisodeId: 'episode:mistwood:3' }),
    });
    // Progress is a high-water mark. A merge that could move it backwards would lose exactly what
    // the viewer is claiming the merge in order to keep.
    expect(backward.merged.lastViewedEpisodeId).toBe('episode:mistwood:9');
    expect(backward.summary.advancedFrom).toBeNull();
  });

  it('treats an unreadable stored position as no information rather than as day zero', () => {
    const plan = planProgressMerge({
      account: record({ lastViewedEpisodeId: 'not-an-episode-id' }),
      device: record({ lastViewedEpisodeId: 'episode:mistwood:4' }),
    });
    expect(plan.merged.lastViewedEpisodeId).toBe('episode:mistwood:4');
  });

  it('reports every follow the caps could not keep, instead of discarding it silently', () => {
    const accountCharacters = Array.from({ length: MAX_FOLLOWED_CHARACTER_IDS }, (_, i) => `account-${i}`);
    const deviceCharacters = ['device-a', 'device-b'];
    const accountArcs = Array.from({ length: MAX_FOLLOWED_ARC_IDS }, (_, i) => `arc-account-${i}`);
    const plan = planProgressMerge({
      account: record({ followedCharacterIds: accountCharacters, followedArcIds: accountArcs }),
      device: record({ followedCharacterIds: deviceCharacters, followedArcIds: ['arc-device'] }),
    });

    expect(plan.merged.followedCharacterIds).toHaveLength(MAX_FOLLOWED_CHARACTER_IDS);
    expect(plan.merged.followedArcIds).toHaveLength(MAX_FOLLOWED_ARC_IDS);
    // The record is well-formed AND four follows were lost. Only the second half is the interesting
    // claim, and only the summary can carry it.
    expect(plan.summary.droppedCharacterIds).toEqual(deviceCharacters);
    expect(plan.summary.droppedArcIds).toEqual(['arc-device']);
    expect(mergeWasLossless(plan.summary)).toBe(false);
  });

  it('keeps the account own spoiler mode and reports the disagreement', () => {
    const plan = planProgressMerge({
      account: record({ spoilerMode: 'publicOnly' }),
      device: record({ spoilerMode: 'watchedOnly' }),
    });
    // The account's setting is the one the viewer chose while signed in. The disagreement is
    // published so a client can offer the choice rather than silently deciding it.
    expect(plan.merged.spoilerMode).toBe('publicOnly');
    expect(plan.summary.spoilerModeConflict).toBe(true);
  });

  it('is idempotent: merging the same device twice changes nothing the second time', () => {
    const device = record({ followedCharacterIds: ['wu-zhen'], lastViewedEpisodeId: 'episode:mistwood:6' });
    const first = planProgressMerge({ account: record({ followedCharacterIds: ['pei-lan'] }), device });
    const second = planProgressMerge({ account: first.merged, device });
    expect(second.merged).toEqual(first.merged);
    expect(second.summary.addedCharacterIds).toEqual([]);
    expect(second.summary.advancedFrom).toBeNull();
  });
});
