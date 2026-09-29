"use client";

import { Volume2 } from "lucide-react";
import { speak } from "@/lib/tts";

/**
 * 日語發音鈕:以 Web Speech 朗讀 `text`(無可用 voice 時靜默降級)。
 * `text` 由呼叫端以 speechText 清理;設定 `ttsEnabled` 關閉時由呼叫端不渲染(useTtsEnabled)。
 */
export function SpeakButton({
  text,
  label,
  ariaLabel,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? `播放 ${text} 的發音`}
      onClick={() => speak(text)}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors active:bg-muted"
    >
      <Volume2 className="size-4" aria-hidden />
      {label}
    </button>
  );
}
