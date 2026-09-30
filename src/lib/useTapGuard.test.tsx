import { fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { freezeClock, passTapGuard } from "@/test/clock";
import {
  TAP_GUARD_MS,
  tapGuarded,
  useEntryClickGuard,
  useShownAt,
} from "./useTapGuard";

const T = new Date(2026, 8, 30, 12, 0).getTime();

beforeEach(() => {
  freezeClock();
  vi.setSystemTime(T);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tapGuarded", () => {
  it("起點後 TAP_GUARD_MS 內為 true,之後為 false", () => {
    expect(TAP_GUARD_MS).toBe(300);
    expect(tapGuarded(T)).toBe(true);
    expect(tapGuarded(T - TAP_GUARD_MS + 1)).toBe(true);
    expect(tapGuarded(T - TAP_GUARD_MS)).toBe(false);
    // 未起算(0):不擋
    expect(tapGuarded(0)).toBe(false);
  });
});

describe("useShownAt", () => {
  it("在 layout 階段(與新畫面的 DOM 同一個 commit)就記下掛載時刻", () => {
    // 同一元件中宣告在後的 layout effect 看得到起點:若改成 useEffect(另排 task,
    // 可能晚於第一個點擊)這裡會讀到 0
    const seen: number[] = [];
    function Probe() {
      const shownAt = useShownAt();
      useLayoutEffect(() => {
        seen.push(shownAt.current);
      }, [shownAt]);
      return null;
    }
    render(<Probe />);
    expect(seen).toEqual([T]);
  });
});

describe("useEntryClickGuard", () => {
  function Page({
    onAction,
    onLink,
  }: {
    onAction: () => void;
    onLink: () => void;
  }) {
    const guardClick = useEntryClickGuard();
    return (
      <div onClickCapture={guardClick}>
        <button type="button" onClick={onAction}>
          再練一次
        </button>
        <a href="/next" onClick={onLink}>
          下一課
        </a>
      </div>
    );
  }

  it("掛載後 TAP_GUARD_MS 內的點擊不觸發按鈕與連結(連結的導覽也擋下),之後照常", () => {
    const onAction = vi.fn();
    const onLink = vi.fn();
    render(<Page onAction={onAction} onLink={onLink} />);

    fireEvent.click(screen.getByRole("button", { name: "再練一次" }));
    // fireEvent 回傳 false = 預設動作(連結導覽)被擋下
    expect(fireEvent.click(screen.getByRole("link", { name: "下一課" }))).toBe(
      false,
    );
    expect(onAction).not.toHaveBeenCalled();
    expect(onLink).not.toHaveBeenCalled();

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "再練一次" }));
    fireEvent.click(screen.getByRole("link", { name: "下一課" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onLink).toHaveBeenCalledOnce();
  });
});
