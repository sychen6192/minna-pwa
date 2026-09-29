import { afterAll, beforeAll } from "vitest";

// 測試專用:切換 Node 執行期時區。Node 在設定/刪除 process.env.TZ 時即重設時區快取,
// 之後建構的 Date 立即以新時區解讀。

/** 設定(或以 undefined 清除)process.env.TZ,回傳原值以便還原。 */
export function setTimeZone(tz: string | undefined): string | undefined {
  const prev = process.env.TZ;
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
  return prev;
}

/**
 * 在目前 describe 範圍內切換時區,結束後還原。
 * 依賴時區的 Date 須在測試內建構(模組層級常數在切換前就已求值)。
 */
export function useTimeZone(tz: string): void {
  let prev: string | undefined;
  beforeAll(() => {
    prev = setTimeZone(tz);
  });
  afterAll(() => {
    setTimeZone(prev);
  });
}
