import type { Pos } from "@/schemas/lesson";

/**
 * 課程頁単語分頁的詞性篩選(T11.1,F7.1):教材的 13 種詞性標記併成 4 組 chips。
 * - 名詞:只有「名」
 * - 動詞:動I / 動II / 動III
 * - 形容詞:い形 / な形
 * - 其他:副詞、助詞、接続、疑問詞、数量詞、慣用(問候語等整句)與「其他」(接尾等)
 * 疑問詞、数量詞雖多可當名詞用,教材另立詞性,沿用教材分類歸入其他。
 */
export type PosGroup = "noun" | "verb" | "adjective" | "other";

/** 篩選值:全部或某一組 */
export type PosFilter = "all" | PosGroup;

/** 每種詞性的分組:Record 讓 PosEnum 新增值時編譯期就報缺漏 */
const POS_GROUP: Record<Pos, PosGroup> = {
  名: "noun",
  動I: "verb",
  動II: "verb",
  動III: "verb",
  い形: "adjective",
  な形: "adjective",
  副: "other",
  助詞: "other",
  接続: "other",
  疑問詞: "other",
  数量詞: "other",
  慣用: "other",
  其他: "other",
};

/** chips 的順序與名稱(介面文案) */
export const POS_FILTERS: readonly { key: PosFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "noun", label: "名詞" },
  { key: "verb", label: "動詞" },
  { key: "adjective", label: "形容詞" },
  { key: "other", label: "其他" },
];

/** 詞性所屬的組 */
export function posGroup(pos: Pos): PosGroup {
  return POS_GROUP[pos];
}

/** 依篩選值取出單字(保留原順序);"all" 回傳全部 */
export function filterByPosGroup<T extends { pos: Pos }>(
  vocab: readonly T[],
  filter: PosFilter,
): T[] {
  return filter === "all" ? [...vocab] : vocab.filter((v) => posGroup(v.pos) === filter);
}

/** 各篩選值的字數(chips 上的數字;"all" = 全部) */
export function countByPosGroup(vocab: readonly { pos: Pos }[]): Record<PosFilter, number> {
  const counts: Record<PosFilter, number> = {
    all: vocab.length,
    noun: 0,
    verb: 0,
    adjective: 0,
    other: 0,
  };
  for (const v of vocab) counts[posGroup(v.pos)] += 1;
  return counts;
}
