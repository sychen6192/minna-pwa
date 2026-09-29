// PWA 環境判定與儲存持久化(SPEC N3)。
// 全部函式永不 throw:PWA 加值功能失敗不得影響 app 本體。

export type PersistOutcome = "persisted" | "granted" | "denied" | "unsupported";

/**
 * 要求持久化儲存,防止瀏覽器在儲存壓力下清除 IndexedDB(SRS 學習紀錄)。
 * 冪等:已持久化就不重複要求。
 */
export async function ensurePersistentStorage(): Promise<PersistOutcome> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.persisted || !storage.persist) return "unsupported";
  try {
    if (await storage.persisted()) return "persisted";
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/** 是否以已安裝(standalone)模式執行。 */
export function getDisplayMode(): "standalone" | "browser" {
  if (typeof window === "undefined") return "browser";
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  }
  // iOS Safari 傳統判定(非標準屬性,僅 iOS 提供)
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return "standalone";
  return "browser";
}

/** iOS 裝置判定;iPadOS 13+ 的 UA 偽裝 Mac,以多點觸控辨識。 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
}

// ── Chromium 一鍵安裝(beforeinstallprompt)──────────────────────────

/** Chromium 的安裝提示事件(非標準,lib.dom 未收錄;只列用到的成員)。 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function setDeferredInstall(event: BeforeInstallPromptEvent | null): void {
  deferredInstall = event;
  installListeners.forEach((listener) => listener());
}

/**
 * 攔截 beforeinstallprompt:取消瀏覽器自帶的安裝橫幅,保存事件供首頁安裝卡片「一鍵安裝」;
 * 安裝完成(appinstalled)即清除。由 layout 的 PwaSetup 於每頁啟動時呼叫;回傳取消註冊。
 * 事件若早於註冊觸發則收不到,首頁卡片退回文字說明(瀏覽器自帶橫幅照常)。
 * 取捨:按過「知道了」後也照樣攔截(瀏覽器自帶橫幅不再出現,仍可從瀏覽器選單安裝)——
 * 判斷旗標須讀 IndexedDB,而 layout 的每頁啟動不載入 Dexie。
 */
export function captureInstallPrompt(): () => void {
  if (typeof window === "undefined") return () => {};
  const onPrompt = (e: Event) => {
    e.preventDefault();
    setDeferredInstall(e as BeforeInstallPromptEvent);
  };
  const onInstalled = () => setDeferredInstall(null);
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/** 目前可用的安裝事件(無則 null);搭配 subscribeInstallPrompt 供 useSyncExternalStore。 */
export function getInstallPromptEvent(): BeforeInstallPromptEvent | null {
  return deferredInstall;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

/**
 * 顯示瀏覽器的安裝對話框(須在使用者操作的事件內呼叫;事件只能用一次,用後清除)。
 * 永不 throw:沒有可用事件或瀏覽器拒絕時回傳 "unavailable"。
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredInstall;
  if (!event) return "unavailable";
  setDeferredInstall(null);
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}
