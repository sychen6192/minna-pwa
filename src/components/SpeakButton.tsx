"use client";

import { Volume2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { speak } from "@/lib/tts";
import { cn } from "@/lib/utils";

/**
 * 日語發音鈕:以 Web Speech 朗讀 `text`(無可用 voice 時靜默降級)。
 * `text` 由呼叫端以 speechText 清理;設定 `ttsEnabled` 關閉時由呼叫端不渲染(useTtsEnabled)。
 *
 * 觸控區 44×44,以負 margin 抵銷、不撐高所在的列。relative 讓延伸的點擊區疊在相鄰文字之上;
 * 不用 rounded-full(圓角會裁掉點擊判定)。
 * - 只有圖示:佔 16px(圖示大小);不畫 hover/按下底色(44px 底色會蓋住相鄰文字),以文字色回饋。
 * - 帶 `label`:往上延伸 12px、往下只延伸 8px——呼叫端與下方控制項間至少留 8px
 *   (space-y-2 / pb-2),點擊區才不會蓋到下一個按鈕的上緣。
 */
export function SpeakButton({
  text,
  label,
  ariaLabel,
  className,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? `播放 ${text} 的發音`}
      onClick={() => speak(text)}
      className={buttonVariants({
        variant: "ghost",
        size: label ? "sm" : "icon",
        className: cn(
          "relative font-normal text-muted-foreground active:text-foreground",
          label
            ? "-mt-3 -mb-2 gap-1 text-link active:text-link"
            : "-m-3.5 hover:bg-transparent hover:text-foreground active:bg-transparent",
          className,
        ),
      })}
    >
      <Volume2 className="size-4" aria-hidden />
      {label}
    </button>
  );
}
