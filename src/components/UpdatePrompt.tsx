"use client";

import type { Serwist } from "@serwist/window";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    // @serwist/next 的 sw-entry 於主 bundle 同步指派;dev(SW 停用)或不支援時不存在
    serwist?: Serwist;
  }
}

/** 元件實際用到的最小介面;測試以假物件注入 */
export type SerwistLike = Pick<
  Serwist,
  "addEventListener" | "removeEventListener" | "messageSkipWaiting"
>;

// 模組層常數:identity 穩定,避免 effect 因預設參數每次 render 重建而反覆掛卸
const defaultGetSerwist = (): SerwistLike | undefined =>
  typeof window === "undefined" ? undefined : window.serwist;
const defaultReload = () => window.location.reload();

interface UpdatePromptProps {
  /** 測試注入用 */
  getSerwist?: () => SerwistLike | undefined;
  /** 測試注入用(jsdom 的 location.reload 不可 stub) */
  reload?: () => void;
}

/**
 * SW 更新提示(T6.4):sw.ts 設 skipWaiting: false,新版安裝完成會停在
 * waiting;此元件收到 waiting 事件即提示,使用者同意才送 SKIP_WAITING,
 * 待新 SW 接管(controlling)後重新整理。首次安裝無 waiting,不打擾。
 */
export function UpdatePrompt({
  getSerwist = defaultGetSerwist,
  reload = defaultReload,
}: UpdatePromptProps) {
  const [updateReady, setUpdateReady] = useState(false);
  const serwistRef = useRef<SerwistLike | null>(null);

  useEffect(() => {
    const serwist = getSerwist();
    if (!serwist) return;
    serwistRef.current = serwist;
    const onWaiting = () => setUpdateReady(true);
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [getSerwist]);

  if (!updateReady) return null;

  const applyUpdate = () => {
    const serwist = serwistRef.current;
    if (!serwist) return;
    serwist.addEventListener("controlling", () => reload());
    serwist.messageSkipWaiting();
  };

  return (
    <section
      aria-label="更新提示"
      className="fixed inset-x-0 bottom-16 z-50 mx-auto max-w-screen-sm px-4 pb-2"
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
        <p className="text-sm text-neutral-800">新版本已就緒。</p>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setUpdateReady(false)}
            className="rounded px-3 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            稍後
          </button>
          <button
            type="button"
            onClick={applyUpdate}
            className="rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700"
          >
            立即更新
          </button>
        </div>
      </div>
    </section>
  );
}
