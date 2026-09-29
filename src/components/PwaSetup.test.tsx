import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting } from "@/lib/db";
import { getInstallPromptEvent } from "@/lib/pwa";
import { PwaSetup } from "./PwaSetup";

/** 等待 useEffect 內的非同步鏈完成 */
const flushEffects = () => act(() => new Promise((resolve) => setTimeout(resolve, 25)));

function stubStorage() {
  const persist = vi.fn(async () => true);
  vi.stubGlobal("navigator", {
    userAgent: "jsdom",
    maxTouchPoints: 0,
    storage: { persisted: vi.fn(async () => false), persist },
  });
  return persist;
}

beforeEach(async () => {
  await db.settings.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PwaSetup(layout,每一頁)", () => {
  it("掛在 root layout(每一頁都執行);安裝提示不在 layout", () => {
    // 不 import layout.tsx(會連帶載入 globals.css 走 PostCSS),直接讀原始碼
    const layout = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/<PwaSetup \/>/);
    expect(layout).not.toMatch(/InstallPrompt/);
  });

  it("啟動即要求持久化儲存,且不渲染任何提示(安裝提示只在首頁)", async () => {
    const persist = stubStorage();

    const { container } = render(<PwaSetup />);
    await flushEffects();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("未安裝、未關閉過安裝提示時同樣不渲染(不以浮層蓋住各頁操作)", async () => {
    stubStorage();
    await setSetting("installPromptDismissed", false);

    const { container } = render(<PwaSetup />);
    await flushEffects();

    expect(container).toBeEmptyDOMElement();
  });

  it("攔截 beforeinstallprompt(取消瀏覽器橫幅、保存事件);卸載後不再攔截", async () => {
    stubStorage();
    const { unmount } = render(<PwaSetup />);
    await flushEffects();

    const event = new Event("beforeinstallprompt", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallPromptEvent()).toBe(event);

    window.dispatchEvent(new Event("appinstalled"));
    expect(getInstallPromptEvent()).toBeNull();

    unmount();
    const later = new Event("beforeinstallprompt", { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    expect(getInstallPromptEvent()).toBeNull();
  });
});
