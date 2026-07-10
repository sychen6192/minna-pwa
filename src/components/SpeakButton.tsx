"use client";

import { Volume2 } from "lucide-react";
import { speak } from "@/lib/tts";

/** 日語發音鈕:以 Web Speech 朗讀 `text`(無可用 voice 時靜默降級)。 */
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
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-foreground/10 px-2.5 py-1 text-xs text-foreground/70 transition-colors active:bg-foreground/5"
    >
      <Volume2 className="size-4" aria-hidden />
      {label}
    </button>
  );
}
