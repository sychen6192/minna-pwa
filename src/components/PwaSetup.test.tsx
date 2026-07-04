import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { db, getSetting, setSetting } from "@/lib/db";
import { PwaSetup } from "./PwaSetup";

/** 等待 useEffect 內的非同步鏈(display-mode 判定 + IndexedDB 讀取)完成 */
const flushEffects = () => act(() => new Promise((resolve) => setTimeout(resolve, 25)));

function stubNavigator(overrides: Record<string, unknown>) {
  vi.stubGlobal("navigator", {
    userAgent: "jsdom",
    maxTouchPoints: 0,
    ...overrides,
  });
}

beforeEach(async () => {
  await db.settings.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PwaSetup 安裝提示", () => {
  it("未安裝且未關閉過:顯示提示", async () => {
    render(<PwaSetup />);

    expect(await screen.findByRole("region", { name: "安裝提示" })).toBeInTheDocument();
  });

  it("已安裝(standalone):不顯示", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );

    render(<PwaSetup />);
    await flushEffects();

    expect(screen.queryByRole("region", { name: "安裝提示" })).not.toBeInTheDocument();
  });

  it("iOS 裝置:顯示 Safari 加入主畫面引導文案", async () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });

    render(<PwaSetup />);

    await screen.findByRole("region", { name: "安裝提示" });
    expect(screen.getByText(/加入主畫面/)).toBeInTheDocument();
    expect(screen.getByText(/分享/)).toBeInTheDocument();
  });

  it("點「知道了」:提示消失且旗標寫入 DB", async () => {
    const user = userEvent.setup();
    render(<PwaSetup />);
    await screen.findByRole("region", { name: "安裝提示" });

    await user.click(screen.getByRole("button", { name: "知道了" }));

    expect(screen.queryByRole("region", { name: "安裝提示" })).not.toBeInTheDocument();
    expect(await getSetting("installPromptDismissed")).toBe(true);
  });

  it("先前已關閉(旗標為 true):不顯示", async () => {
    await setSetting("installPromptDismissed", true);

    render(<PwaSetup />);
    await flushEffects();

    expect(screen.queryByRole("region", { name: "安裝提示" })).not.toBeInTheDocument();
  });
});
