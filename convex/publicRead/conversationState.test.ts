/**
 * Public conversation state (FR-O004 / ART-123).
 *
 * The three tests the task names, plus the one that keeps FR-P004 intact: withholding a scene's
 * TEXT must not change any character's STATE. If it did, the withhold would be visible on the
 * map as a behaviour change — the same reason ART-132 AC#4 requires that withholding must not
 * move anyone.
 */

import {
  CONVERSATION_MIN_PARTICIPANTS,
  applyConversationState,
  conversationStatesFor,
  type ConversationSceneInput,
} from './conversationState';
import {
  MAX_PUBLIC_CONVERSATION_HINT_LENGTH,
  PUBLIC_TRUNCATION_SUFFIX,
  truncateForPublic,
} from '../shared/publicText';

const active = (participants: string[]): ConversationSceneInput =>
  ({ status: 'active', participantCharacterIds: participants });

describe('who reads as being in conversation (AC#1)', () => {
  test('two or more participants in an active scene are speaking', () => {
    const states = conversationStatesFor([active(['he-jun', 'pei-lan'])]);
    expect(states.get('he-jun')).toBe('speaking');
    expect(states.get('pei-lan')).toBe('speaking');
  });

  test('one participant is an activity, not a conversation', () => {
    // Drawing a speech bubble over someone alone would assert a conversation the world never
    // recorded.
    expect(conversationStatesFor([active(['he-jun'])]).get('he-jun')).toBe('activity');
    expect(CONVERSATION_MIN_PARTICIPANTS).toBe(2);
  });

  test('an ended scene contributes nothing', () => {
    // A bubble over someone who finished talking an hour ago is a claim about now.
    const states = conversationStatesFor([
      { status: 'ended', participantCharacterIds: ['he-jun', 'pei-lan'] },
    ]);
    expect(states.size).toBe(0);
  });

  test('a scene with no participants contributes nothing', () => {
    expect(conversationStatesFor([{ status: 'active' }]).size).toBe(0);
    expect(conversationStatesFor([active([])]).size).toBe(0);
  });

  test('speaking wins over activity when a character is in two active scenes', () => {
    // The stronger claim is the one a viewer can check against the scene panel; downgrading it
    // because of an unrelated solo scene would make the map disagree with the panel.
    const states = conversationStatesFor([active(['he-jun']), active(['he-jun', 'pei-lan'])]);
    expect(states.get('he-jun')).toBe('speaking');

    // ...in either order, so this is not an artefact of iteration.
    const reversed = conversationStatesFor([active(['he-jun', 'pei-lan']), active(['he-jun'])]);
    expect(reversed.get('he-jun')).toBe('speaking');
  });

  test('`thinking` is never produced', () => {
    // Declared and renderable, but nothing in Canon records that a character is thinking, and
    // inventing an inner state from a participant count is exactly the RISK2-008 violation the
    // map exists to avoid.
    const states = conversationStatesFor([active(['a', 'b']), active(['c'])]);
    expect([...states.values()]).not.toContain('thinking');
  });
});

describe('conversation refines only an idle motion', () => {
  test('an idle character takes the conversation state', () => {
    expect(applyConversationState('idle', 'speaking')).toBe('speaking');
  });

  test('a WALKING character keeps walking', () => {
    // Someone mid-walk is on their way somewhere. A bubble over a walking figure would claim
    // they are standing talking, and the published motion is the more specific fact.
    expect(applyConversationState('walking', 'speaking')).toBe('walking');
  });

  test('no conversation leaves the state alone', () => {
    expect(applyConversationState('idle', undefined)).toBe('idle');
    expect(applyConversationState('walking', undefined)).toBe('walking');
  });
});

describe('the withhold cannot be seen in a character’s state (AC#5, FR-P004 AC#4)', () => {
  test('state is derived from PARTICIPATION, so a withheld scene still shows the conversation', () => {
    /**
     * The load-bearing property. `activeScenePresentation` blanks a withheld scene's `title` and
     * `summary` and leaves its existence, location and participants public — so a scene carries
     * no publication field into this function at all, and there is no branch by which one could
     * be consulted. Two scenes identical but for their text resolve identically.
     */
    const published = conversationStatesFor([active(['he-jun', 'pei-lan'])]);
    const withheld = conversationStatesFor([active(['he-jun', 'pei-lan'])]);
    expect([...withheld.entries()]).toEqual([...published.entries()]);
    expect(withheld.get('he-jun')).toBe('speaking');
  });
});

describe('shortening published text (AC#4)', () => {
  test('short text is returned whole', () => {
    expect(truncateForPublic('水車卡住了。')).toBe('水車卡住了。');
  });

  test('long text is cut, and the ellipsis fits INSIDE the budget', () => {
    const long = 'x'.repeat(MAX_PUBLIC_CONVERSATION_HINT_LENGTH + 20);
    const hint = truncateForPublic(long);
    // Appending after truncating would return one character more than the caller sized their
    // column for, which is how a hint pushes a card wider on the one screen nobody tested.
    expect(hint.length).toBe(MAX_PUBLIC_CONVERSATION_HINT_LENGTH);
    expect(hint.endsWith(PUBLIC_TRUNCATION_SUFFIX)).toBe(true);
  });

  test('text exactly at the limit is not cut', () => {
    const exact = 'x'.repeat(MAX_PUBLIC_CONVERSATION_HINT_LENGTH);
    expect(truncateForPublic(exact)).toBe(exact);
  });

  test('a withheld scene’s empty summary yields an empty hint, by construction', () => {
    // Not by a second check. FR-P004 substitutes `''`, and `''` shortens to `''` — so there is
    // no code path where a withheld scene could produce a hint.
    expect(truncateForPublic('')).toBe('');
    expect(truncateForPublic('   ')).toBe('');
  });

  test('CJK is cut by character count, with no word-boundary rule', () => {
    // Chinese has no word boundaries. A rule that only worked for the space-separated half of
    // the content would cut CJK arbitrarily anyway while looking correct in review.
    const hint = truncateForPublic('一二三四五六七八九十', 5);
    expect(hint).toBe(`一二三四${PUBLIC_TRUNCATION_SUFFIX}`);
  });

  test('a degenerate budget returns the ellipsis or nothing, never a crash', () => {
    expect(truncateForPublic('anything', 1)).toBe(PUBLIC_TRUNCATION_SUFFIX);
    expect(truncateForPublic('anything', 0)).toBe('');
    expect(truncateForPublic('anything', -5)).toBe('');
  });
});
