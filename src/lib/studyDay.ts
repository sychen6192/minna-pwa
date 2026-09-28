/**
 * 學習日(DATA_MODEL §4-5):以本地時區凌晨 ROLLOVER_HOUR 點換日(對標 Anki)。
 * 00:00–03:59 仍屬前一個學習日。全部純函式,不碰 DB。
 *
 * 邊界一律以本地日期欄位建構(`new Date(y, m, d, ROLLOVER_HOUR)`),而非 ms 加減,
 * 故 DST 切換日不會讓換日點偏移一小時(該學習日只是變成 23 或 25 小時)。
 */

/** 換日時刻(本地時,0–23)。 */
export const ROLLOVER_HOUR = 4;

const DAY_MS = 86_400_000;

interface CalendarDate {
  y: number;
  m: number; // 0-based(同 Date#getMonth)
  d: number;
}

/** `ms` 所屬學習日的日曆日期(本地):早於換日時刻者屬前一日。 */
function studyDate(ms: number): CalendarDate {
  const t = new Date(ms);
  const back = t.getHours() < ROLLOVER_HOUR ? 1 : 0;
  // 取中午建構,避開少數時區午夜不存在的 DST 日;日期欄位溢位由 Date 正規化
  const date = new Date(t.getFullYear(), t.getMonth(), t.getDate() - back, 12);
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

/**
 * 以 `ms` 所屬學習日為基準,往後(n < 0 為往前)第 `n` 個學習日的**起點**(epoch ms)。
 * `addStudyDays(ms, 0)` 即 `studyDayStart(ms)`。
 */
export function addStudyDays(ms: number, n: number): number {
  const { y, m, d } = studyDate(ms);
  return new Date(y, m, d + n, ROLLOVER_HOUR).getTime();
}

/** `ms` 所屬學習日的起點(本地 ROLLOVER_HOUR 點,epoch ms)。 */
export function studyDayStart(ms: number): number {
  return addStudyDays(ms, 0);
}

/** 下一個學習日的起點,即 `ms` 所屬學習日的結束(不含)。 */
export function nextStudyDayStart(ms: number): number {
  return addStudyDays(ms, 1);
}

/** `ms` 所屬學習日的日期鍵 `YYYY-MM-DD`(分日統計、heatmap 用)。 */
export function studyDayKey(ms: number): string {
  const { y, m, d } = studyDate(ms);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ── ts-fsrs 時間平移(只供 srs.ts 使用;DB 永遠存真實時刻)──────────────
// ts-fsrs 以 UTC 日期(getUTC*)計算 elapsed_days,等於在 UTC 00:00(台灣 08:00)換日。
// 餵入前把時刻平移成「UTC 日期 = 本地學習日」,輸出再以呼叫當下的 now 為基準換回。

/**
 * 真實時刻 → ts-fsrs 時刻:UTC 日期等於 `ms` 的學習日,時刻為距學習日起點的經過時間。
 * 經過時間上限為 1 天減 1 ms(DST 回撥日的學習日長 25 小時,仍須留在同一 UTC 日)。
 */
export function toFsrsTime(ms: number): number {
  const { y, m, d } = studyDate(ms);
  const sinceStart = ms - new Date(y, m, d, ROLLOVER_HOUR).getTime();
  return Date.UTC(y, m, d) + Math.min(Math.max(sinceStart, 0), DAY_MS - 1);
}

/**
 * ts-fsrs 輸出時刻 → 真實時刻。以同一次呼叫的 `now` 為基準:取兩者在 ts-fsrs 時間軸上
 * 相差的整日數 n,回傳 `now` 的本地牆上時間 n 個日曆日之後(日期欄位運算)。
 * 不對平移後的時刻再查一次時差,避免 DST 前後偏一小時。
 * 牆上時間在目標日不存在(DST 跳時缺口,如 Europe/Helsinki 03:00→04:00)時 Date 會往後
 * 挪一小時而跨入下一學習日,故結果截在目標學習日 [addStudyDays(now, n), 下一學習日起點) 內。
 */
export function fromFsrsTime(fsrsMs: number, now: number): number {
  const n = Math.round((fsrsMs - toFsrsTime(now)) / DAY_MS);
  if (n === 0) return now;
  const t = new Date(now);
  const wall = new Date(
    t.getFullYear(),
    t.getMonth(),
    t.getDate() + n,
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
    t.getMilliseconds(),
  ).getTime();
  return Math.min(
    Math.max(wall, addStudyDays(now, n)),
    addStudyDays(now, n + 1) - 1,
  );
}
