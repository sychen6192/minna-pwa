"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { Button } from "@/components/ui/button";
import {
  formLabel,
  formLabelLang,
  grammarHref,
  grammarLinks,
} from "@/lib/drill";
import { markLeftForGrammar, type DrillResultItem } from "./drillState";

/** 一回合的結果:分數、錯題(基底 → 正解、所問的形、作答內容、文法連結);不寫入 SRS */
export function DrillResult({
  results,
  furigana,
  canRestart,
  onRestart,
  onChangeRange,
}: {
  results: DrillResultItem[];
  furigana: FuriganaMode;
  /** 出題池已載入(從別頁返回時重新載入中為 false) */
  canRestart: boolean;
  /** 以同一範圍與形重新出題 */
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

  return (
    <div className="px-4 py-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-center text-lg font-bold outline-none"
      >
        練習完成
      </h1>
      {results.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          範圍內沒有可出題的單字,請換個範圍或形。
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
            {wrong.map(({ question: q, given }, i) => {
              const label = formLabel(q.group, q.form);
              // 普通形另附規則所在的文法點(同回饋畫面)
              const links = grammarLinks(q.item.pos, q.form);
              // 只差讀音的選項(来ない きない/こない):正解與作答一律顯示讀音
              const answerFurigana: FuriganaMode = q.forceReading
                ? "show"
                : furigana;
              return (
                <li key={`${q.item.id}:${q.form}:${i}`} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-lg">
                      <RubyText segments={q.item.ruby} furigana={furigana} />
                      <span
                        aria-hidden
                        className="mx-1.5 text-muted-foreground"
                      >
                        →
                      </span>
                      <span className="sr-only">的正解是</span>
                      <RubyText
                        segments={q.answer.ruby}
                        furigana={answerFurigana}
                      />
                    </span>
                    <span
                      lang={formLabelLang(label)}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
                    <span className="min-w-0">
                      你的答案:
                      <RubyText segments={given} furigana={answerFurigana} />
                    </span>
                    <span className="flex shrink-0 flex-wrap gap-x-3">
                      {links.map((l, j) => (
                        <Link
                          key={l.grammarId}
                          href={grammarHref(l)}
                          onClick={markLeftForGrammar}
                          className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
                        >
                          {j === 0
                            ? `看文法:第 ${l.lesson} 課`
                            : `活用規則:第 ${l.lesson} 課`}
                        </Link>
                      ))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
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
