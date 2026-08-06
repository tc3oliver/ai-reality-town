/**
 * Watch-only help content and its hash route (ART-113 / FR-N002 AC#8).
 *
 * The inherited a16z help modal explained how to *play*: log in, press
 * "Interact", click to walk your character around, ask an agent to start a
 * conversation. None of that exists any more -- the engine that served those
 * inputs was retired in ART-112 and the public renderer has no write path at
 * all. Leaving that copy up would be the product lying about what it can do.
 *
 * This module replaces it with an honest description of the only thing a
 * visitor can do: watch. Content lives here rather than inside the component so
 * the promise ("never offer joining, controlling or chatting") is a unit-tested
 * property of data instead of a review convention.
 */

export interface HelpSection {
  /** Stable id, used for the section's `aria-labelledby` heading. */
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface HelpViewModel {
  title: string;
  intro: string;
  sections: HelpSection[];
  /** The non-map fallback (NFR-009 AC#3), or null when no world is in scope. */
  textLiveHref: string | null;
}

/** `#help` and `#help/<worldId>` both resolve; the world id is optional. */
export function parseHelpRoute(hash: string): { worldId: string | null } | null {
  const match = /^#help(?:\/([^/?#]+))?$/.exec(hash);
  if (match === null) return null;
  return { worldId: match[1] ? decodeURIComponent(match[1]) : null };
}

export function composeHelpViewModel({ worldId }: { worldId: string | null }): HelpViewModel {
  return {
    title: '觀看指南',
    intro:
      'Mistwood 是一個持續運作的 AI 世界。你是觀眾:你可以觀看、瀏覽與回顧,但無法加入世界或指揮角色。世界的走向只由已採信的正典事件決定。',
    sections: [
      {
        id: 'help-watching',
        heading: '觀看世界',
        paragraphs: [
          '地圖畫面呈現目前的 Mistwood:地點、建築,以及角色所在的位置。畫面只反映已發布的公開投影,不會因為你的操作而改變。',
          '點擊地圖不會指派任何角色移動——公開介面沒有任何控制元件。',
        ],
      },
      {
        id: 'help-navigating',
        heading: '瀏覽畫面',
        paragraphs: [
          '拖曳可以平移視角,滾動或雙指縮放可以拉近拉遠。這些都只是你自己的鏡頭,不會送出任何資料。',
          '若你不想使用地圖,文字實況提供同樣的世界狀態:地點、角色位置、活躍場景與最近事件。',
        ],
      },
      {
        id: 'help-characters',
        heading: '角色卡',
        paragraphs: [
          '每位角色都有角色卡,收錄公開的身分、關係與經歷。角色卡的視覺識別與地圖、Episode 中的一致。',
          '角色卡只顯示已公開的內容,不會揭露私人記憶或未公開的秘密。',
        ],
      },
      {
        id: 'help-scenes',
        heading: '場景與事件',
        paragraphs: [
          '活躍場景說明此刻世界正在發生什麼,並附上摘要。事件時間軸則記錄已採信的重大發展。',
          '這些內容由世界自己的推進產生;閱讀它們不會觸發任何新的生成。',
        ],
      },
      {
        id: 'help-episodes',
        heading: 'Episode 與回顧',
        paragraphs: [
          'Episode 把一段時間內的事件整理成可讀的章節,新觀眾可以從推薦的入坑點開始。',
          '回顧(replay)讓你重看已經發生的場景。重看只是重播既有的正典紀錄,不會改寫世界。',
        ],
      },
    ],
    textLiveHref: worldId === null ? null : `#live/${worldId}`,
  };
}
