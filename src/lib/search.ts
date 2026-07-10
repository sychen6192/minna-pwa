import MiniSearch from "minisearch";
import type { Lesson, RubySeg } from "@/schemas/lesson";

// 全文檢索(SPEC F4.2):文型、解說、例句、單字。
// 日文/中文無空格,MiniSearch 預設斷詞不適用 → CJK run 切 bigram(索引與查詢共用),
// 搭配 prefix 匹配讓單字元查詢也可用。

export type SearchKind = "grammar" | "vocab" | "example";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  lessonId: number;
  title: string; // 主顯示:文型 pattern / 單字表面形 / 例句原文
  snippet: string; // 次要顯示:解說 / 釋義 / 翻譯
  anchor: string; // 課程內頁錨點(文法點 id;單字無錨點為空字串)
}

// 內部文件:ja / kana / zh 三個檢索欄位 + SearchHit 展示欄位
interface SearchDoc extends SearchHit {
  ja: string;
  kana: string;
  zh: string;
}

const CJK_OR_WORD = /[぀-ヿ㐀-鿿豈-﫿]+|[A-Za-z0-9]+/g;

/** CJK run 切 bigram;拉丁/數字 run 整詞;標點與空白不入 token。 */
export function cjkTokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const [run] of text.matchAll(CJK_OR_WORD)) {
    if (/[A-Za-z0-9]/.test(run)) {
      tokens.push(run);
    } else if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

function surface(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

function toDocs(lessons: Lesson[]): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const lesson of lessons) {
    for (const g of lesson.grammar) {
      docs.push({
        id: g.id,
        kind: "grammar",
        lessonId: lesson.id,
        title: g.pattern,
        snippet: g.explanation ?? "",
        anchor: g.id,
        ja: g.pattern,
        kana: "",
        zh: g.explanation ?? "",
      });
      for (const s of g.examples) {
        docs.push({
          id: s.id,
          kind: "example",
          lessonId: lesson.id,
          title: surface(s.ruby),
          snippet: s.translation,
          anchor: g.id, // 跳至所屬文法點
          ja: surface(s.ruby),
          kana: "",
          zh: s.translation,
        });
      }
    }
    for (const v of lesson.vocab) {
      docs.push({
        id: v.id,
        kind: "vocab",
        lessonId: lesson.id,
        title: surface(v.ruby),
        snippet: v.meaning,
        anchor: "",
        ja: surface(v.ruby),
        kana: v.kana,
        zh: v.note ? `${v.meaning} ${v.note}` : v.meaning,
      });
    }
  }
  return docs;
}

export type SearchIndex = MiniSearch<SearchDoc>;

/** 以全部課程建構檢索索引(呼叫端負責快取)。 */
export function buildSearchIndex(lessons: Lesson[]): SearchIndex {
  const index = new MiniSearch<SearchDoc>({
    fields: ["ja", "kana", "zh"],
    storeFields: ["kind", "lessonId", "title", "snippet", "anchor"],
    tokenize: cjkTokenize,
    searchOptions: {
      prefix: true,
      combineWith: "AND",
      boost: { ja: 2, kana: 2, zh: 1 },
    },
  });
  index.addAll(toDocs(lessons));
  return index;
}

/** 查詢,依相關度排序,回傳前 `limit` 筆。空查詢回空陣列。 */
export function searchAll(index: SearchIndex, query: string, limit = 50): SearchHit[] {
  if (!query.trim()) return [];
  return index.search(query).slice(0, limit).map((r) => ({
    id: String(r.id),
    kind: r.kind as SearchKind,
    lessonId: r.lessonId as number,
    title: r.title as string,
    snippet: r.snippet as string,
    anchor: r.anchor as string,
  }));
}
