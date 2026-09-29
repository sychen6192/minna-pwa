"use client";

import { useEffect } from "react";
import { captureInstallPrompt, ensurePersistentStorage } from "@/lib/pwa";

/**
 * PWA 啟動例行(layout,每一頁都執行):要求持久化儲存(防 IndexedDB 被清,SPEC N3),
 * 並攔截 Chromium 的 beforeinstallprompt 供首頁安裝卡片使用。不渲染任何 UI——
 * 安裝提示只在首頁以一般排版的卡片顯示(InstallPrompt),不以浮層蓋住各頁操作。
 */
export function PwaSetup() {
  useEffect(() => {
    // 結果不影響 UI;lib 保證不 throw,失敗即靜默降級
    void ensurePersistentStorage();
    return captureInstallPrompt();
  }, []);

  return null;
}
