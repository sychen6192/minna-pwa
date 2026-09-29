"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getDisplayMode,
  getInstallPromptEvent,
  isIOS,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa";

type Kind = "ios" | "generic";

// 設定經 db.ts;動態載入使 Dexie 不計入首頁 first-load(N4:首頁 JS gzip < 200 KB)
async function loadDismissed(): Promise<boolean> {
  const { getSetting } = await import("@/lib/db");
  return getSetting("installPromptDismissed");
}

async function saveDismissed(): Promise<void> {
  const { setSetting } = await import("@/lib/db");
  await setSetting("installPromptDismissed", true);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 文件順序中 `el` 之後(不含其內)的第一個可聚焦元素 */
function focusableAfter(el: Element): HTMLElement | null {
  for (const candidate of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.contains(candidate)) continue;
    if (el.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) return candidate;
  }
  return null;
}

/**
 * 首頁的安裝提示卡片(SPEC N3):一般文件流、不遮擋任何操作。首次造訪即顯示(不等使用者
 * 先加入單字——iOS 的主畫面 App 與 Safari 儲存分開,在 Safari 累積的紀錄帶不過去);
 * 已安裝(standalone)或按過「知道了」不再顯示。Chromium 收到 beforeinstallprompt 時
 * 另給「安裝」一鍵安裝(事件由 layout 的 PwaSetup 攔截保存)。
 * 初次 render 一律為空,useEffect 後才判定,避免 SSG hydration 不一致。
 */
export function InstallPrompt() {
  const [kind, setKind] = useState<Kind | null>(null);
  const installEvent = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptEvent,
    () => null,
  );
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (getDisplayMode() === "standalone") return;
    let cancelled = false;
    loadDismissed()
      .then((dismissed) => {
        if (!cancelled && !dismissed) setKind(isIOS() ? "ios" : "generic");
      })
      .catch(() => {}); // 讀不到設定就不打擾
    return () => {
      cancelled = true;
    };
  }, []);

  if (!kind) return null;

  const dismiss = () => {
    // 焦點在卡片內時,卡片卸載前交給其後第一個可聚焦元素,不掉到 body。
    // preventScroll:卡片移除後該元素隨即上移到卡片原位,不必先捲過去
    const section = sectionRef.current;
    if (section?.contains(document.activeElement)) {
      focusableAfter(section)?.focus({ preventScroll: true });
    }
    setKind(null);
    void saveDismissed().catch(() => {});
  };

  const install = async () => {
    // 事件用掉後「安裝」鈕隨即消失:焦點先交給「知道了」(被拒時留在卡片上)
    dismissRef.current?.focus();
    if ((await promptInstall()) === "accepted") dismiss();
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      className="rounded-xl border border-border bg-card p-4"
    >
      <h2 id={titleId} className="flex items-center gap-2 text-sm font-medium">
        <Download className="size-4 text-link" aria-hidden />
        安裝到主畫面
      </h2>
      {kind === "ios" ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            點 Safari 的<strong className="text-foreground">分享</strong>按鈕,選「
            <strong className="text-foreground">加入主畫面</strong>
            」。安裝後可完全離線使用,學習紀錄也不會被系統清除。
          </p>
          <p className="mt-2 text-sm leading-relaxed text-warning">
            請在開始學習前安裝:Safari 裡的學習紀錄不會帶進主畫面 App。
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {installEvent ? (
            "安裝後可完全離線使用,學習紀錄也不會被系統清除。"
          ) : (
            <>
              從瀏覽器選單將此 App <strong className="text-foreground">安裝到主畫面</strong>
              ,可完全離線使用,學習紀錄也不會被系統清除。
            </>
          )}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button
          ref={dismissRef}
          variant="ghost"
          size="sm"
          onClick={dismiss}
          className="font-normal text-link"
        >
          知道了
        </Button>
        {kind === "generic" && installEvent && (
          <Button size="sm" onClick={() => void install()}>
            安裝
          </Button>
        )}
      </div>
    </section>
  );
}
