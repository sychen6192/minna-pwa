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
