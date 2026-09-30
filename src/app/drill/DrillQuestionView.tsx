"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button } from "@/components/ui/button";
import {
  checkDrillAnswer,
  formLabelLang,
  formPrompt,
  grammarHref,
  grammarLinks,
  type DrillOption,
  type DrillQuestion,
} from "@/lib/drill";
import { BOTTOM_NAV_SCROLL_MARGIN, revealAboveNav } from "@/lib/scroll";
import { speechText } from "@/lib/tts";
import { tapGuarded, useShownAt } from "@/lib/useTapGuard";
import { cn } from "@/lib/utils";
import type { RubySeg } from "@/schemas/lesson";
import { markLeftForGrammar, type DrillAnswer } from "./drillState";

/** 一題:題目(基底 + 要改成的形)、選項或輸入、回饋(正解、朗讀、文法連結) */
export function DrillQuestionView({
  question: q,
  index,
  total,
  answer,
  furigana,
  tts,
  onInputChange,
  onAnswer,
  onNext,
}: {
  question: DrillQuestion;
  index: number;
  total: number;
  answer: DrillAnswer;
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  onInputChange: (input: string) => void;
  /** 作答:新的作答狀態 + 作答內容(錯題列表顯示) */
  onAnswer: (answer: DrillAnswer, given: RubySeg[]) => void;
  onNext: () => void;
}) {
  // 焦點接手:掛載(開始、換題、返回本頁)時移到題幹(已作答則移到「下一題」);
  // 作答後被選的選項/輸入框會 disabled(焦點掉到 body)→ 移到「下一題」
  const stemRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // 點擊防護(useTapGuard,同助詞搭配):題目出現、作答的時刻。雙擊「下一題」/「再練一次」的
  // 第二下不會落在新題的選項上,作答後連點也不會直接跳過回饋
  const shownAt = useShownAt();
  const answeredAt = useRef(0);
  useEffect(() => {
    if (answer.answered) nextRef.current?.focus();
    else stemRef.current?.focus({ preventScroll: true });
    // 只在掛載時(每題以 key 重新掛載)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const answered = answer.answered;
  // 作答後:焦點移到「下一題」(回饋把它推到底部導覽列下時捲出來)
  useEffect(() => {
    const next = nextRef.current;
    if (!answered || !next) return;
    next.focus();
    revealAboveNav(next);
  }, [answered]);

  // 形名與作答的形狀(可能形(辞書形)…)
  const label = formPrompt(q.group, q.form);
  const links = grammarLinks(q.item.pos, q.form);
  // 選項只差讀音(来ない きない/こない)時,選項與正解一律顯示讀音
  const answerFurigana: FuriganaMode = q.forceReading ? "show" : furigana;

  function select(option: DrillOption) {
    if (answer.answered || tapGuarded(shownAt.current)) return;
    answeredAt.current = Date.now();
    onAnswer(
      {
        ...answer,
        selectedId: option.id,
        answered: true,
        correct: option.correct,
      },
      option.ruby, // 選項的 ruby(只差讀音的選項在錯題列表才分得出來)
    );
  }

  function submit() {
    if (answer.answered || answer.input.trim() === "") return;
    answeredAt.current = Date.now();
    onAnswer(
      { ...answer, answered: true, correct: checkDrillAnswer(answer.input, q) },
      [{ b: answer.input.trim() }],
    );
  }

  function next() {
    if (tapGuarded(answeredAt.current)) return;
    onNext();
  }

  return (
    <div className="flex min-h-[80vh] flex-col">
      {/* 進度 */}
      <div className="px-4 py-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>活用練習</span>
          <span>
            第 {index + 1} / {total} 題
          </span>
        </div>
        <div className="mt-1 h-1 w-full rounded bg-muted">
          <div
            className="h-1 rounded bg-muted-foreground transition-all"
            style={{ width: `${(index / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-6 px-4">
        {/* 題幹:教材的單字表記(動詞ます形、形容詞辞書形)+ 要改成的形 */}
        <div ref={stemRef} tabIndex={-1} className="text-center outline-none">
          <div className="text-3xl">
            <RubyText segments={q.item.ruby} furigana={furigana} />
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {q.item.meaning}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-link/10 px-3 py-1 text-sm font-medium text-link">
            <span aria-hidden>→</span>
            <span className="sr-only">改成</span>
            <span lang={formLabelLang(label)}>{label}</span>
          </div>
        </div>

        {q.type === "input" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              aria-label={`輸入${label}的假名`}
              placeholder="假名或羅馬字"
              value={answer.input}
              disabled={answer.answered}
              onChange={(e) => onInputChange(e.target.value)}
              // 16px 以上:iOS Safari 不會在 focus 時放大頁面
              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3 text-base placeholder:text-muted-foreground"
              autoComplete="off"
              // 羅馬字作答:避免行動鍵盤自動大寫/自動校正
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={answer.answered || answer.input.trim() === ""}
              className="px-4 font-normal"
            >
              作答
            </Button>
          </form>
        ) : (
          <ul className="space-y-2">
            {q.options.map((o) => {
              const state = !answer.answered
                ? "idle"
                : o.correct
                  ? "correct"
                  : o.id === answer.selectedId
                    ? "wrong"
                    : "idle";
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    disabled={answer.answered}
                    onClick={() => select(o)}
                    className={cn(
                      "min-h-11 w-full rounded-lg border px-4 py-2 text-left text-lg disabled:opacity-100",
                      state === "correct"
                        ? "border-success bg-success/10"
                        : state === "wrong"
                          ? "border-destructive bg-destructive/10"
                          : "border-input",
                    )}
                  >
                    <RubyText segments={o.ruby} furigana={answerFurigana} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/*
          回饋:正解(含讀音)、朗讀、該形的文法解說連結。
          live region 先掛載、作答後再填入內容,螢幕閱讀器才會播報
        */}
        <div role="status" className="space-y-1 text-center">
          {answer.answered && (
            <>
              <p
                className={cn(
                  "font-medium",
                  answer.correct ? "text-success" : "text-destructive",
                )}
              >
                {answer.correct ? "答對 ✓" : "答錯 ✗"}
              </p>
              <div className="flex items-center justify-center gap-4">
                <span className="text-2xl leading-ruby">
                  <RubyText
                    segments={q.answer.ruby}
                    furigana={answerFurigana}
                  />
                </span>
                {tts && (
                  <SpeakButton
                    text={speechText(q.answer)}
                    ariaLabel={`播放 ${q.answer.kana} 的發音`}
                  />
                )}
              </div>
              {q.accepted.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  「<span lang="ja">じゃ</span>」也可以說「
                  <span lang="ja">では</span>」
                </p>
              )}
              {!answer.correct && q.type === "input" && (
                <p className="text-xs text-muted-foreground">
                  你的答案:<span lang="ja">{answer.input.trim()}</span>
                </p>
              )}
              <p className="flex flex-wrap items-center justify-center gap-x-4 text-sm">
                {links.map((l, i) => (
                  <Link
                    key={l.grammarId}
                    href={grammarHref(l)}
                    onClick={markLeftForGrammar}
                    className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
                  >
                    {i === 0
                      ? `看文法:第 ${l.lesson} 課`
                      : `活用規則:第 ${l.lesson} 課`}
                  </Link>
                ))}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <Button
          ref={nextRef}
          onClick={next}
          disabled={!answer.answered}
          className={cn("h-12 w-full", BOTTOM_NAV_SCROLL_MARGIN)}
        >
          {index + 1 >= total ? "看結果" : "下一題"}
        </Button>
      </div>
    </div>
  );
}
