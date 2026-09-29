/**
 * 複習 session 內重看(T10.3,純函式):評「重來」的卡約隔幾張後再出現一次,只曝光、
 * 不呼叫 rate()、不寫 log(同日再評分會重複扣 stability)。狀態只存在頁面 state。
 */

/** 評「重來」後約隔幾張重看 */
export const RELEARN_GAP = 5;

/** 重看項按「還不熟,再一次」最多再插入的次數(第 1 次重看來自「重來」本身) */
export const MAX_RELEARN_REPEATS = 2;

export interface Relearnable {
  /** 重看第幾次(缺省 = 一般卡) */
  relearn?: number;
}

/** 此項之後是否還能再排一次重看(一般卡評重來、重看項未達上限) */
export function canRelearnAgain(item: Relearnable): boolean {
  return (item.relearn ?? 0) <= MAX_RELEARN_REPEATS;
}

/**
 * 於 `items[index]` 之後約 `gap` 張處插入其重看副本(`relearn` + 1),位置 =
 * `min(index + 1 + gap, items.length)`。回傳新陣列,不改動原陣列;已達上限或 index
 * 無效時回傳原陣列。
 */
export function insertRelearn<T extends Relearnable>(
  items: T[],
  index: number,
  gap: number = RELEARN_GAP,
): T[] {
  const item = items[index];
  if (!item || !canRelearnAgain(item)) return items;
  const at = Math.min(index + 1 + gap, items.length);
  const copy: T = { ...item, relearn: (item.relearn ?? 0) + 1 };
  return [...items.slice(0, at), copy, ...items.slice(at)];
}
