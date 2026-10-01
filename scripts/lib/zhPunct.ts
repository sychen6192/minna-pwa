/**
 * 教材中文欄位的標點全形化(DQ-08、SPEC F1.6):規則與欄位清單。
 *
 * 純函式,scripts/normalize-zh-punct.ts(寫回資料)與 scripts/content-lint.ts(error 規則
 * zh-punct)共用,兩邊檢查的欄位與規則因此一致。非執行期程式(資料已於建置期寫回),不放 src/lib。
 */
import { SECTION_MARKER_NOTES } from "../../src/lib/notes";
import type { Lesson } from "../../src/schemas/lesson";

// ---------- 規則 ----------

/** R1–R5:ASCII 標點 → 全形 */
const ASCII_TO_FULL: Readonly<Record<string, string>> = {
  ",": "，",
  ";": "；",
  ":": "：",
  "?": "？",
  "!": "！",
  "(": "（",
  ")": "）",
};

/** R7:小型變體(U+FE50–FE5A)→ 一般全形;資料只有 ﹐﹑﹖,其餘防禦性處理 */
const SMALL_TO_FULL: Readonly<Record<string, string>> = {
  "﹐": "，",
  "﹑": "、",
  "﹔": "；",
  "﹕": "：",
  "﹖": "？",
  "﹗": "！",
  "﹙": "（",
  "﹚": "）",
};

const isDigit = (c: string | undefined) =>
  c !== undefined && c >= "0" && c <= "9";

/** R1 的例外:千分位 `\d,\d{3}(?!\d)`(15,000、1,000,000 的每個逗號) */
const isThousands = (cs: readonly string[], i: number) =>
  cs[i] === "," &&
  isDigit(cs[i - 1]) &&
  isDigit(cs[i + 1]) &&
  isDigit(cs[i + 2]) &&
  isDigit(cs[i + 3]) &&
  !isDigit(cs[i + 4]);

/** R3 的例外:數字之間的冒號 `\d:\d`(時刻 10:00) */
const isTime = (cs: readonly string[], i: number) =>
  cs[i] === ":" && isDigit(cs[i - 1]) && isDigit(cs[i + 1]);

/**
 * 教材中文的標點統一為全形(純函式、冪等):
 * - R1 `,` → `，`,千分位(`\d,\d{3}(?!\d)`:15,000、1,000,000)保留
 * - R2 `;` → `；`
 * - R3 `:` → `：`,數字之間(`\d:\d`,時刻)保留
 * - R4 `?` → `？`、`!` → `！`
 * - R5 `(` → `（`、`)` → `）`,不論是否成對(「1)」列舉與寬度不一的括號對一併修好)
 * - R6 被 R1–R5、R7 轉換的標點兩側緊鄰的 ASCII 空白刪除(全形標點自帶間距);其他空白
 *   (分かち書き、數字旁)保留
 * - R7 小型變體 ﹐﹑﹖(與防禦性的 ﹔﹕﹗﹙﹚)→ 一般全形
 * - R8 ASCII `"` 為偶數個時依序轉為 “ ”;奇數個不動(無從配對,不猜)
 * - R9 `～`(U+FF5E)→ `〜`(U+301C,與資料其餘的〜一致)
 *
 * 不動:`.`(7. 節次)、`-`(871-6813)、`/`(はい/いいえ)、`…`、`、`、全形英數、U+2011。
 */
export function normalizeZhPunct(text: string): string {
  const cs = [...text];
  // mark:R1–R5、R7 轉換而來的標點(R6 刪除其兩側空白)
  const out = cs.map((c, i): { ch: string; mark: boolean } => {
    if (c === "～") return { ch: "〜", mark: false }; // R9
    const full = ASCII_TO_FULL[c] ?? SMALL_TO_FULL[c];
    if (full === undefined || isThousands(cs, i) || isTime(cs, i)) {
      return { ch: c, mark: false };
    }
    return { ch: full, mark: true };
  });
  // R6:空白(含連續空白)的左右最近非空白字元為轉換標點時刪除
  const marked = (from: number, step: 1 | -1) => {
    let j = from;
    while (out[j]?.ch === " ") j += step;
    return out[j]?.mark === true;
  };
  let s = out
    .filter((o, i) => o.ch !== " " || !(marked(i - 1, -1) || marked(i + 1, 1)))
    .map((o) => o.ch)
    .join("");
  // R8:成對的 ASCII 引號
  const quotes = s.split('"').length - 1;
  if (quotes > 0 && quotes % 2 === 0) {
    let open = true;
    s = s.replace(/"/g, () => {
      const q = open ? "“" : "”";
      open = !open;
      return q;
    });
  }
  return s;
}

// ---------- 欄位 ----------

/** 中文欄位(原始 JSON 的 key) */
export type ZhField = "meaning" | "note" | "explanation" | "translation";

/** 摘要分組:單字釋義、單字 note、文法解說、例句中譯、会話中譯(含会話標題) */
export type ZhGroup =
  | "meaning"
  | "note"
  | "explanation"
  | "examples"
  | "dialogues";

export const ZH_GROUPS: readonly ZhGroup[] = [
  "meaning",
  "note",
  "explanation",
  "examples",
  "dialogues",
];

/** 課程中一個要正規化的中文值 */
export interface ZhValue {
  /** VocabItem、GrammarPoint、Sentence 的 id;会話標題為「L15:dialogueTitle」(同 content-lint) */
  id: string;
  field: ZhField;
  group: ZhGroup;
  value: string;
}

/** 会話標題沒有 id:以「L15:dialogueTitle」標示 */
export const dialogueTitleId = (lesson: number) =>
  `L${String(lesson).padStart(2, "0")}:dialogueTitle`;

/**
 * 段落標記 note(補充單字(自行練習發音)、読み物、会話)不正規化:那是 isSupplementary、
 * noteSection 比對的常數(src/lib/notes.ts),不當提示文字顯示。
 */
export const isSectionMarker = (note: string) =>
  SECTION_MARKER_NOTES.includes(note);

/**
 * 課程中要正規化的中文值,依檔案順序:vocab.meaning、vocab.note(段落標記除外)、
 * grammar.explanation、例句 translation、dialogueTitle.translation、会話 translation。
 * pattern、title、speaker、ruby、kana(日文)不在其中。
 */
export function zhValues(l: Lesson): ZhValue[] {
  const out: ZhValue[] = [];
  for (const v of l.vocab) {
    out.push({
      id: v.id,
      field: "meaning",
      group: "meaning",
      value: v.meaning,
    });
    if (v.note !== undefined && !isSectionMarker(v.note)) {
      out.push({ id: v.id, field: "note", group: "note", value: v.note });
    }
  }
  for (const g of l.grammar) {
    if (g.explanation !== undefined) {
      out.push({
        id: g.id,
        field: "explanation",
        group: "explanation",
        value: g.explanation,
      });
    }
    for (const s of g.examples) {
      out.push({
        id: s.id,
        field: "translation",
        group: "examples",
        value: s.translation,
      });
    }
  }
  if (l.dialogueTitle !== undefined) {
    out.push({
      id: dialogueTitleId(l.id),
      field: "translation",
      group: "dialogues",
      value: l.dialogueTitle.translation,
    });
  }
  for (const d of l.dialogues) {
    out.push({
      id: d.id,
      field: "translation",
      group: "dialogues",
      value: d.translation,
    });
  }
  return out;
}
