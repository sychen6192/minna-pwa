/**
 * 課程內頁的 URL hash(T10.11):分頁狀態與深連結錨點共用 `location.hash`。
 * - 文法點 `#Lxx-Gxx` → 文型分頁並捲動到該文法點(文法速查、例句搜尋結果)
 * - 單字 `#Lxx-Vxxx` → 単語分頁、捲動到該字並短暫高亮(單字搜尋結果)
 * - `#vocab` / `#grammar` / `#dialogue` → 該分頁(切換分頁時以 replaceState 寫入,返回本頁時還原)
 * 錨點規則優先於分頁名;其餘 hash 不處理(維持預設的単語分頁)。
 */

export type LessonTab = "vocab" | "grammar" | "dialogue";

export const LESSON_TABS: readonly LessonTab[] = ["vocab", "grammar", "dialogue"];

export interface LessonHashTarget {
  tab: LessonTab;
  /** 要捲動到的元素 id(文法點或單字);只切換分頁時為 null */
  anchor: string | null;
  /** 捲動後是否短暫高亮(單字錨點) */
  highlight: boolean;
}

const GRAMMAR_ANCHOR = /-G\d+$/;
const VOCAB_ANCHOR = /-V\d+$/;

function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null; // 不合法的百分比編碼(手打網址):當作沒有 hash
  }
}

/** 解析 `location.hash`(含或不含開頭的 `#`);無法對應時回傳 null。 */
export function parseLessonHash(hash: string): LessonHashTarget | null {
  const value = decode(hash.startsWith("#") ? hash.slice(1) : hash);
  if (!value) return null;
  if (GRAMMAR_ANCHOR.test(value)) return { tab: "grammar", anchor: value, highlight: false };
  if (VOCAB_ANCHOR.test(value)) return { tab: "vocab", anchor: value, highlight: true };
  const tab = LESSON_TABS.find((t) => t === value);
  return tab ? { tab, anchor: null, highlight: false } : null;
}

/** 分頁寫入 URL 的 hash(`#grammar` 等)。 */
export function lessonTabHash(tab: LessonTab): string {
  return `#${tab}`;
}
