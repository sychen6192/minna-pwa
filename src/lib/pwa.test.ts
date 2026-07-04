import { afterEach, vi } from "vitest";
import { ensurePersistentStorage, getDisplayMode, isIOS } from "./pwa";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubNavigator(overrides: Record<string, unknown>) {
  vi.stubGlobal("navigator", {
    userAgent: "jsdom",
    maxTouchPoints: 0,
    ...overrides,
  });
}

describe("ensurePersistentStorage", () => {
  it("已 persisted:回 'persisted' 且不再呼叫 persist", async () => {
    const persist = vi.fn();
    stubNavigator({
      storage: { persisted: vi.fn(async () => true), persist },
    });

    expect(await ensurePersistentStorage()).toBe("persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("未 persisted 且瀏覽器同意:回 'granted'", async () => {
    stubNavigator({
      storage: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => true),
      },
    });

    expect(await ensurePersistentStorage()).toBe("granted");
  });

  it("未 persisted 且瀏覽器拒絕:回 'denied'", async () => {
    stubNavigator({
      storage: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => false),
      },
    });

    expect(await ensurePersistentStorage()).toBe("denied");
  });

  it("navigator.storage 不存在(舊 Safari):回 'unsupported' 不 throw", async () => {
    stubNavigator({});

    expect(await ensurePersistentStorage()).toBe("unsupported");
  });

  it("persist 丟例外:回 'unsupported' 不外洩錯誤", async () => {
    stubNavigator({
      storage: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    });

    expect(await ensurePersistentStorage()).toBe("unsupported");
  });
});

describe("getDisplayMode", () => {
  it("display-mode: standalone 媒體查詢命中 → 'standalone'", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );

    expect(getDisplayMode()).toBe("standalone");
  });

  it("媒體查詢未命中但 navigator.standalone(iOS 傳統判定)→ 'standalone'", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    stubNavigator({ standalone: true });

    expect(getDisplayMode()).toBe("standalone");
  });

  it("皆未命中 → 'browser'", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    stubNavigator({});

    expect(getDisplayMode()).toBe("browser");
  });

  it("matchMedia 不存在(測試環境)→ 不 throw,回 'browser'", () => {
    stubNavigator({});

    expect(getDisplayMode()).toBe("browser");
  });
});

describe("isIOS", () => {
  it("iPhone / iPad UA → true", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(isIOS()).toBe(true);

    stubNavigator({
      userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(isIOS()).toBe(true);
  });

  it("iPadOS 13+ 偽裝 Mac(Macintosh UA + 多點觸控)→ true", () => {
    stubNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    });
    expect(isIOS()).toBe(true);
  });

  it("桌面 Mac(無觸控)與 Android → false", () => {
    stubNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 0,
    });
    expect(isIOS()).toBe(false);

    stubNavigator({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
    });
    expect(isIOS()).toBe(false);
  });
});
