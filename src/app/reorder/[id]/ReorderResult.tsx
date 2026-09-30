"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  LAST_LESSON,
  promptText,
  surfaceText,
  type ReorderItem,
} from "@/lib/reorder";
import { speechText } from "@/lib/tts";
import { useEntryClickGuard } from "@/lib/useTapGuard";
import { cn } from "@/lib/utils";
import type { ReorderOutcome } from "./ReorderQuestion";

export interface ReorderResultItem {
  item: ReorderItem;
  outcome: ReorderOutcome;
  /** 答案列各格的文字(略過時為已排入的部分) */
  picked: string[];
}

/** 一回合的結果:分數、答錯與略過的句子(教材原句、中譯、朗讀)、再練一次、下一課;不寫入 SRS */
export function ReorderResult({
  lessonId,
  results,
  furigana,
  tts,
  onRestart,
}: {
  lessonId: number;
  results: ReorderResultItem[];
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  /** 同一課重新出題 */
  onRestart: () => void;
}) {
  const missed = results.filter((r) => r.outcome !== "correct");
  const correct = results.length - missed.length;
  // 進結果頁時「看結果」鈕已卸載:焦點移到標題(不掉到 body),螢幕閱讀器從成績開始念
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  // 剛進結果頁(TAP_GUARD_MS 內)的點擊不觸發按鈕與連結(雙擊「看結果」的第二下不會再練一次或換課)
  const guardClick = useEntryClickGuard();

  return (
    <div className="px-4 py-8" onClickCapture={guardClick}>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-center text-lg font-bold outline-none"
      >
        練習完成
      </h1>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        例句重組・第 {lessonId} 課
      </p>
      {results.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          本課沒有可重組的例句。
        </p>
      ) : (
        <p className="mt-4 text-center text-3xl font-bold tabular-nums">
          {correct} / {results.length}
        </p>
      )}

      {results.length > 0 && missed.length === 0 && (
        <p className="mt-6 text-center text-sm text-success">全部答對 🎉</p>
      )}
      {missed.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium">
            答錯與略過({missed.length})
          </h2>
          <ul className="divide-y divide-border border-y border-border">
            {missed.map(({ item, outcome }) => {
              const spoken = speechText(surfaceText(item.sentence.ruby));
              return (
                <li key={item.sentence.id} className="flex gap-4 py-2">
                  <div className="min-w-0 flex-1">
                    <RubyText
                      segments={item.sentence.ruby}
                      furigana={furigana}
                      className="leading-ruby"
                    />
                    <div className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
                      <span className="min-w-0">
                        {promptText(item.sentence.translation)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          outcome === "wrong" && "text-destructive",
                        )}
                      >
                        {outcome === "wrong" ? "答錯" : "略過"}
                      </span>
                    </div>
                  </div>
                  {tts && (
                    <SpeakButton
                      text={spoken}
                      ariaLabel={`播放例句發音:${spoken}`}
                      className="-mt-1"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">語序以教材為準。</p>
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-1">
        <div className="flex w-full max-w-xs gap-2">
          <Button variant="outline" onClick={onRestart} className="flex-1 px-4">
            再練一次
          </Button>
          {lessonId < LAST_LESSON && (
            <Link
              href={`/reorder/${lessonId + 1}`}
              className={buttonVariants({ className: "flex-1 px-4" })}
            >
              下一課 →
            </Link>
          )}
        </div>
        <Link
          href={`/lessons/${lessonId}`}
          className={buttonVariants({
            variant: "link",
            className: "px-3 text-sm",
          })}
        >
          回課程
        </Link>
        <p className="text-xs text-muted-foreground">
          單次練習,不影響複習排程。
        </p>
      </div>
    </div>
  );
}
