import { afterEach, beforeEach, vi } from "vitest";

// 測試專用:時間相關的共用 helper。點擊防護(useTapGuard,300ms)以明確的方式控制,
// 不依賴測試跑得多快。

/**
 * 點擊防護的測試:時鐘停住(只 fake Date;RTL 的 findBy/waitFor 照常用真實計時器),
 * 防護由 passTapGuard() 明確撥過。搭配 afterEach 的 vi.useRealTimers()。
 */
export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
}

/** 把停住的時鐘撥過點擊防護(換題、作答、進結果頁後 300ms);時鐘未停住時先停住 */
export function passTapGuard(): void {
  if (!vi.isFakeTimers()) freezeClock();
  vi.setSystemTime(Date.now() + 1_000);
}

/**
 * 不測點擊防護的 describe:每次讀 Date.now() 前進 `step`(預設 1 秒),防護永遠不擋,
 * 與元件何時記下起點無關。只替換 Date.now(new Date() 與計時器照常);
 * 同一 describe 內不要再 freezeClock()。
 */
export function useSteppingClock(step = 1_000): void {
  let spy: { mockRestore: () => void } | undefined;
  beforeEach(() => {
    let t = Date.now();
    spy = vi.spyOn(Date, "now").mockImplementation(() => (t += step));
  });
  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });
}
