/**
 * Unit tests for the watch-only help content (ART-113, FR-N002 AC#8).
 *
 * The point of these assertions is the *absence* of a promise: after the a16z
 * engine retirement there is no way to join, control or chat with a character,
 * so help content that says otherwise is a product defect, not a copy nit.
 */

import { composeHelpViewModel, parseHelpRoute } from './helpRoute';

const WORLD_ID = 'mistwood';

describe('parseHelpRoute', () => {
  test('accepts the help route with and without a world', () => {
    expect(parseHelpRoute('#help')).toEqual({ worldId: null });
    expect(parseHelpRoute(`#help/${WORLD_ID}`)).toEqual({ worldId: WORLD_ID });
    expect(parseHelpRoute('#help/a%20b')).toEqual({ worldId: 'a b' });
  });

  test('rejects other routes', () => {
    expect(parseHelpRoute('#home/mistwood')).toBeNull();
    expect(parseHelpRoute('#helpful')).toBeNull();
    expect(parseHelpRoute('')).toBeNull();
  });
});

describe('composeHelpViewModel', () => {
  const vm = composeHelpViewModel({ worldId: WORLD_ID });
  const text = [
    vm.title,
    vm.intro,
    ...vm.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
  ].join('\n');

  test('describes watching, navigating, character cards, scenes, episodes and replay', () => {
    expect(vm.sections.map((section) => section.id)).toEqual([
      'help-watching',
      'help-navigating',
      'help-characters',
      'help-scenes',
      'help-episodes',
    ]);
    for (const topic of ['觀看', '拖曳', '角色卡', '場景', 'Episode', 'replay']) {
      expect(text).toContain(topic);
    }
  });

  test('never offers joining, controlling or chatting with characters', () => {
    // The retired affordances, in the words the old a16z help offered them
    // with. Each of these can only appear as an invitation.
    for (const offer of ['Interact', '加入模擬', '控制角色', '玩家控制', '與角色對話']) {
      expect(text).not.toContain(offer);
    }
    // ...and the capability is denied outright rather than left ambiguous.
    expect(text).toContain('無法加入世界或指揮角色');
    expect(text).toContain('點擊地圖不會指派任何角色移動');
  });

  test('points at the text Live View as the non-map fallback', () => {
    expect(vm.textLiveHref).toBe(`#live/${WORLD_ID}`);
    // Without a world in scope there is nothing to link to, and the page must
    // not render a broken href.
    expect(composeHelpViewModel({ worldId: null }).textLiveHref).toBeNull();
  });
});
