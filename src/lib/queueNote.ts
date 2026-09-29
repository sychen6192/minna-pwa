import type { QueueCounts } from "@/lib/srs";

/**
 * 今日佇列已空、但仍有卡因每日上限等到明天時的說明(首頁 Hero、課程頁「整課加入」);
 * 沒有因上限而等待的卡則回傳 null。判斷順序:複習額度 → 新卡額度(複習頁空狀態同此順序)。
 * 純函式、只匯入型別:首頁可靜態引入,不把 Dexie 帶進首屏 bundle。
 */
export function capNote(queue: QueueCounts): string | null {
  if (queue.reviewCapReached) return "今日複習已達上限,明天繼續";
  if (!queue.newCapReached) return null;
  return queue.newPerDay === 0 ? "每日新卡上限設為 0,暫不引入新卡" : "今日新卡已達上限,明天繼續";
}
