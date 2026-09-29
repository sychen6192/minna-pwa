import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { db, getSetting, setSetting } from "@/lib/db";
import { captureInstallPrompt, getInstallPromptEvent } from "@/lib/pwa";
import { InstallPrompt } from "./InstallPrompt";

/** 等待 useEffect 內的非同步鏈(display-mode 判定 + 動態載入 db + IndexedDB 讀取)完成 */
const flushEffects = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

const REGION = { name: "安裝到主畫面" } as const;

function stubNavigator(overrides: Record<string, unknown>) {
  vi.stubGlobal("navigator", { userAgent: "jsdom", maxTouchPoints: 0, ...overrides });
}

/** 模擬 Chromium 送出 beforeinstallprompt(經 PwaSetup 同一套攔截) */
function fireInstallPrompt(outcome: "accepted" | "dismissed") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

let release: () => void = () => {};

beforeEach(async () => {
  await db.settings.clear();
  release = captureInstallPrompt();
});

afterEach(() => {
  window.dispatchEvent(new Event("appinstalled")); // 清掉保存的事件
  release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InstallPrompt(首頁安裝提示)", () => {
  it("首次造訪(未安裝、未關閉):顯示一般排版的卡片,非固定浮層", async () => {
    render(<InstallPrompt />);

    const region = await screen.findByRole("region", REGION);
    expect(region.className).not.toMatch(/\bfixed\b/);
    expect(region).toHaveTextContent("可完全離線使用");
    expect(screen.queryByRole("button", { name: "安裝" })).not.toBeInTheDocument();
  });

  it("已安裝(standalone):不顯示", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );

    render(<InstallPrompt />);
    await flushEffects();

    expect(screen.queryByRole("region", REGION)).not.toBeInTheDocument();
  });

  it("先前已關閉(旗標為 true):不顯示", async () => {
    await setSetting("installPromptDismissed", true);
    const get = vi.spyOn(db.settings, "get");

    render(<InstallPrompt />);
    // 先等旗標確實讀完(正向訊號),「不顯示」才不會是還沒讀到的假通過
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith("installPromptDismissed"));
    await act(async () => {
      await get.mock.results[0].value;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByRole("region", REGION)).not.toBeInTheDocument();
  });

  it("點「知道了」:卡片消失且旗標寫入 DB", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    await screen.findByRole("region", REGION);

    await user.click(screen.getByRole("button", { name: "知道了" }));

    expect(screen.queryByRole("region", REGION)).not.toBeInTheDocument();
    await vi.waitFor(async () => expect(await getSetting("installPromptDismissed")).toBe(true));
  });

  it("iOS:Safari 加入主畫面步驟,並提醒先安裝再學習(Safari 紀錄不會帶進 App)", async () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });

    render(<InstallPrompt />);

    const region = await screen.findByRole("region", REGION);
    expect(region).toHaveTextContent(/分享.*加入主畫面/);
    expect(region).toHaveTextContent("請在開始學習前安裝:Safari 裡的學習紀錄不會帶進主畫面 App");
  });

  it("Chromium 有 beforeinstallprompt:顯示「安裝」,接受後呼叫 prompt、卡片消失並記錄", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    await screen.findByRole("region", REGION);

    const event = fireInstallPrompt("accepted");
    await user.click(await screen.findByRole("button", { name: "安裝" }));

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallPromptEvent()).toBeNull(); // 事件只能用一次
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", REGION)).not.toBeInTheDocument(),
    );
    await vi.waitFor(async () => expect(await getSetting("installPromptDismissed")).toBe(true));
  });

  it("安裝對話框被拒:卡片保留(退回文字說明),不記錄已關閉", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    await screen.findByRole("region", REGION);

    fireInstallPrompt("dismissed");
    await user.click(await screen.findByRole("button", { name: "安裝" }));
    await flushEffects();

    expect(screen.getByRole("region", REGION)).toHaveTextContent("從瀏覽器選單");
    expect(screen.queryByRole("button", { name: "安裝" })).not.toBeInTheDocument();
    expect(await getSetting("installPromptDismissed")).toBe(false);
    // 「安裝」鈕已消失:焦點留在卡片的「知道了」上(不掉到 body)
    expect(screen.getByRole("button", { name: "知道了" })).toHaveFocus();
  });

  it("鍵盤按「知道了」:卡片消失,焦點交給其後的下一個可聚焦元素", async () => {
    const user = userEvent.setup();
    render(
      <>
        <InstallPrompt />
        <p>非互動內容</p>
        <button type="button">下一個操作</button>
      </>,
    );
    await screen.findByRole("region", REGION);

    screen.getByRole("button", { name: "知道了" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("region", REGION)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一個操作" })).toHaveFocus();
  });
});
