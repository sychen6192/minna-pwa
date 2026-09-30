"use client";

import { useEffect, useRef } from "react";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button } from "@/components/ui/button";
import {
  collocationMeaning,
  collocationRuby,
  collocationSpeech,
  collocationText,
  type Particle,
  type ParticleQuestion,
} from "@/lib/particles";
import { BOTTOM_NAV_SCROLL_MARGIN, revealAboveNav } from "@/lib/scroll";
import { speechText } from "@/lib/tts";
import { tapGuarded, useShownAt } from "@/lib/useTapGuard";
import { cn } from "@/lib/utils";

/** 設定畫面、回饋與結果頁共用的說明:教材搭配之外的助詞不一定錯(已知者不列為選項,particles.ts ALSO_NATURAL) */
export function CollocationCaveat({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      以教材搭配為準;有些情況其他助詞也自然(如
      <span lang="ja">友達に／と 会う</span>),已知的這類助詞不列為選項。
    </p>
  );
}

/** 助詞搭配一題(T11.7):題幹「名詞（　）述語」、4 個助詞選項、回饋(完整搭配、朗讀、中譯) */
export function ParticleQuestionView({
  question: q,
  index,
  total,
  selected,
  furigana,
  tts,
  onAnswer,
  onNext,
}: {
  question: ParticleQuestion;
  index: number;
  total: number;
  /** 已選的助詞(返回本頁時接續);未作答為 null */
  selected: Particle | null;
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  onAnswer: (particle: Particle) => void;
  onNext: () => void;
}) {
  const answered = selected !== null;
  const correct = selected === q.answer;
  // 焦點接手:掛載(開始、換題、返回本頁)時移到題幹(已作答則移到「下一題」);
  // 作答後選項 disabled(焦點掉到 body)→ 移到「下一題」
  const stemRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // 點擊防護(useTapGuard):題目出現、作答的時刻。雙擊「下一題」/「再練一次」的第二下不會落在
  // 新題的選項上,點選項後連點也不會直接跳過回饋
  const shownAt = useShownAt();
  const answeredAt = useRef(0);
  useEffect(() => {
    if (answered) nextRef.current?.focus();
    else stemRef.current?.focus({ preventScroll: true });
    // 只在掛載時(每題以 key 重新掛載)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 作答後:焦點移到「下一題」(回饋把它推到底部導覽列下時捲出來)
  useEffect(() => {
    const next = nextRef.current;
    if (!answered || !next) return;
    next.focus();
    revealAboveNav(next);
  }, [answered]);

  function select(particle: Particle) {
    if (answered || tapGuarded(shownAt.current)) return;
    answeredAt.current = Date.now();
    onAnswer(particle);
  }

  function next() {
    if (tapGuarded(answeredAt.current)) return;
    onNext();
  }

  const text = collocationText(q);

  return (
    <div className="flex min-h-[80vh] flex-col">
      {/* 進度 */}
      <div className="px-4 py-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>助詞搭配</span>
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
        {/* 題幹:名詞（　）述語;作答後空格填入正解 */}
        <div ref={stemRef} tabIndex={-1} className="text-center outline-none">
          <p className="sr-only">選出空格中的助詞:</p>
          <div className="text-3xl leading-ruby">
            <RubyText segments={q.before} furigana={furigana} />
            <span
              aria-hidden
              lang="ja"
              className={cn(
                "mx-1 inline-flex h-[1.4em] min-w-[1.4em] items-center justify-center rounded-lg border-2 px-1 align-middle leading-none",
                answered
                  ? "border-success text-success"
                  : "border-dashed border-muted-foreground",
              )}
            >
              {answered ? q.answer : ""}
            </span>
            <span className="sr-only">
              {answered ? (
                <>
                  (<span lang="ja">{q.answer}</span>)
                </>
              ) : (
                "(空格)"
              )}
            </span>
            <RubyText segments={q.after} furigana={furigana} />
          </div>
          <div className="mt-3 inline-flex rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            教材搭配
          </div>
        </div>

        {/* 選項:依 を・に・が・で・へ・と 的順序 */}
        <div role="group" aria-label="選項" className="grid grid-cols-4 gap-2">
          {q.options.map((p) => {
            const state = !answered
              ? "idle"
              : p === q.answer
                ? "correct"
                : p === selected
                  ? "wrong"
                  : "rest";
            return (
              <button
                key={p}
                type="button"
                lang="ja"
                disabled={answered}
                onClick={() => select(p)}
                className={cn(
                  "h-14 rounded-lg border text-2xl transition-colors disabled:opacity-100",
                  state === "correct"
                    ? "border-success bg-success/10 text-success"
                    : state === "wrong"
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : state === "rest"
                        ? "border-border text-muted-foreground"
                        : "border-input bg-card hover:bg-muted active:bg-muted",
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/*
          回饋:完整搭配(含讀音)、朗讀、中譯。
          live region 先掛載、作答後再填入內容,螢幕閱讀器才會播報
        */}
        <div role="status" className="space-y-1 text-center">
          {answered && (
            <>
              <p
                className={cn(
                  "font-medium",
                  correct ? "text-success" : "text-destructive",
                )}
              >
                {correct ? "答對 ✓" : "答錯 ✗"}
              </p>
              <div className="flex items-center justify-center gap-4">
                <span className="text-2xl leading-ruby">
                  <RubyText segments={collocationRuby(q)} furigana={furigana} />
                </span>
                {tts && (
                  <SpeakButton
                    text={speechText(collocationSpeech(q))}
                    ariaLabel={`播放 ${text} 的發音`}
                  />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {collocationMeaning(q)}
              </p>
              {!correct && <CollocationCaveat className="pt-1" />}
            </>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <Button
          ref={nextRef}
          onClick={next}
          disabled={!answered}
          className={cn("h-12 w-full", BOTTOM_NAV_SCROLL_MARGIN)}
        >
          {index + 1 >= total ? "看結果" : "下一題"}
        </Button>
      </div>
    </div>
  );
}
