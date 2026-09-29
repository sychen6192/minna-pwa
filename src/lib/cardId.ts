import type { CardRow } from "./db";

// 卡片 id / 方向的共用小工具(純函式,不依賴 ts-fsrs)。srs.ts 轉匯出;
// stats.ts 等不需 FSRS 的模組直接由此匯入,避免把 ts-fsrs 帶進只做聚合的頁面。

/** 回想方向卡的 cardId 尾綴(義→日,T9.2) */
export const REVERSE_SUFFIX = "@r";

/** 由 cardId 取回原單字 id(去除回想卡尾綴)。 */
export function baseVocabId(cardId: string): string {
  return cardId.endsWith(REVERSE_SUFFIX)
    ? cardId.slice(0, -REVERSE_SUFFIX.length)
    : cardId;
}

/** 卡片方向(缺省視為 fwd,相容舊資料)。 */
export function cardDirection(card: Pick<CardRow, "direction">): "fwd" | "rev" {
  return card.direction ?? "fwd";
}
