"use client";

import { useEffect, useRef } from "react";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { Button } from "@/components/ui/button";
import {
  collocationMeaning,
  collocationRuby,
  collocationText,
} from "@/lib/particles";
import { useEntryClickGuard } from "@/lib/useTapGuard";
import type { ParticleResultItem } from "./drillState";
import { CollocationCaveat } from "./ParticleQuestionView";

/** 助詞搭配一回合的結果(T11.7):分數、錯題(教材搭配、你選的助詞、中譯);不寫入 SRS */
export function ParticleResult({
  results,
  furigana,
  canRestart,
  onRestart,
  onChangeRange,
}: {
  results: ParticleResultItem[];
  furigana: FuriganaMode;
  /** 出題池已載入(從別頁返回時重新載入中為 false) */
  canRestart: boolean;
  /** 以同一範圍重新出題 */
  onRestart: () => void;
  /** 回到設定畫面 */
  onChangeRange: () => void;
}) {
  const wrong = results.filter((r) => !r.correct);
  const correct = results.length - wrong.length;
  // 進結果頁時「看結果」鈕已卸載:焦點移到標題(不掉到 body),螢幕閱讀器從成績開始念
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  // 剛進結果頁(TAP_GUARD_MS 內)的點擊不作用:雙擊「看結果」的第二下不會再練一次或換範圍
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
      {results.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          範圍內沒有可出題的助詞搭配,請換個範圍。
        </p>
      ) : (
        <p className="mt-4 text-center text-3xl font-bold tabular-nums">
          {correct} / {results.length}
        </p>
      )}

      {results.length > 0 && wrong.length === 0 && (
        <p className="mt-6 text-center text-sm text-success">全部答對 🎉</p>
      )}
      {wrong.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium">錯題({wrong.length})</h2>
          <ul className="divide-y divide-border border-y border-border">
            {wrong.map(({ question: q, selected }, i) => (
              <li
                key={`${q.item.id}:${collocationText(q)}:${i}`}
                className="py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <RubyText
                    segments={collocationRuby(q)}
                    furigana={furigana}
                    className="min-w-0 text-lg leading-ruby"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    第 {q.item.lessonId} 課
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
                  <span className="min-w-0">{collocationMeaning(q)}</span>
                  <span className="shrink-0">
                    你的答案:<span lang="ja">{selected}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <CollocationCaveat className="mt-2" />
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-2">
        <div className="flex w-full max-w-xs gap-2">
          <Button
            variant="outline"
            onClick={onChangeRange}
            className="flex-1 px-4"
          >
            換範圍
          </Button>
          <Button
            onClick={onRestart}
            disabled={!canRestart}
            className="flex-1 px-4"
          >
            再練一次
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          單次練習,不影響複習排程。
        </p>
      </div>
    </div>
  );
}
