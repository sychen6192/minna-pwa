"use client";

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/db";
import { ensurePersistentStorage, getDisplayMode, isIOS } from "@/lib/pwa";

/**
 * PWA 啟動例行:要求持久化儲存(防 IndexedDB 被清)+ 未安裝時顯示
 * 加入主畫面提示(SPEC N3)。初次 render 一律為空,useEffect 後才判定,
 * 避免 SSG hydration 不一致。
 */
export function PwaSetup() {
  const [prompt, setPrompt] = useState<"ios" | "generic" | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 結果不影響 UI;lib 保證不 throw,失敗即靜默降級
    void ensurePersistentStorage();
    if (getDisplayMode() === "standalone") return;
    void getSetting("installPromptDismissed").then((dismissed) => {
      if (!cancelled && !dismissed) setPrompt(isIOS() ? "ios" : "generic");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prompt) return null;

  const dismiss = () => {
    setPrompt(null);
    void setSetting("installPromptDismissed", true);
  };

  return (
    <section
      aria-label="安裝提示"
      className="fixed inset-x-0 bottom-[calc(4rem_+_env(safe-area-inset-bottom))] z-50 mx-auto max-w-screen-sm px-4 pb-2"
    >
      <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
        <p className="text-sm leading-relaxed text-neutral-800">
          {prompt === "ios" ? (
            <>
              安裝到主畫面:點 Safari 的<strong>分享</strong>按鈕,選「
              <strong>加入主畫面</strong>」。安裝後可完全離線使用,學習紀錄也不會被系統清除。
            </>
          ) : (
            <>
              從瀏覽器選單將此 App <strong>安裝到主畫面</strong>
              ,可完全離線使用,學習紀錄也不會被系統清除。
            </>
          )}
        </p>
        <div className="mt-2 text-right">
          <button
            type="button"
            onClick={dismiss}
            className="rounded px-3 py-1 text-sm font-medium text-sky-700 hover:bg-sky-50"
          >
            知道了
          </button>
        </div>
      </div>
    </section>
  );
}
