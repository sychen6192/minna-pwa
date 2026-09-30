import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

// 測試專用:時間相關的共用 helper。點擊防護(useTapGuard,300ms)、effect 移的焦點、
// 長計時器都以明確的方式控制,不依賴測試跑得多快。

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

/**
 * 非同步載入後由 effect 移的焦點:掛載 effect 可能在 findBy 看到新 DOM 之後才執行
 * (非同步更新的 passive effect 另排 task),等它到位再斷言。
 */
export function expectFocusSoon(get: () => Element): Promise<void> {
  return waitFor(() => {
    expect(get()).toHaveFocus();
  });
}

/**
 * 只攔下延遲恰為 `ms` 的 setTimeout(如語音清單的 VOICE_TIMEOUT_MS):不自動執行、可被 clearTimeout
 * 取消,由測試以 fire() 明確觸發;其他計時器(RTL 的 findBy/waitFor 等)照常。
 * 測試結束時呼叫 restore()(或由 afterEach 的 vi.restoreAllMocks() 還原)。
 */
export function holdTimeouts(ms: number): {
  /** 執行並清空攔下的計時器 */
  fire: () => void;
  /** 攔下且尚未執行、未取消的計時器數 */
  pending: () => number;
  restore: () => void;
} {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const held = new Map<number, () => void>();
  let nextId = -1; // 負數 id:不與真實計時器衝突
  const set = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== ms) return realSet(fn, delay, ...args);
    held.set(nextId, () => fn(...args));
    return nextId--;
  }) as typeof setTimeout);
  const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation(((
    id?: Parameters<typeof clearTimeout>[0],
  ) => {
    if (typeof id !== "number" || !held.delete(id)) realClear(id);
  }) as typeof clearTimeout);
  return {
    fire: () => {
      const fns = [...held.values()];
      held.clear();
      fns.forEach((f) => f());
    },
    pending: () => held.size,
    restore: () => {
      set.mockRestore();
      clear.mockRestore();
    },
  };
}
