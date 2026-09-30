"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button } from "@/components/ui/button";
import {
  checkOrder,
  misplacedPositions,
  pickedTexts,
  promptText,
  surfaceText,
  type ReorderChunk,
  type ReorderItem,
} from "@/lib/reorder";
import { speechText } from "@/lib/tts";
import { cn } from "@/lib/utils";

export type ReorderOutcome = "correct" | "wrong" | "skipped";

/**
 * 詞塊的外框(待選區、答案列、固定塊與空格共用,尺寸一致):leading-ruby 讓有無讀音的塊等高,
 * py-1 讓讀音不貼著上框
 */
const CHUNK =
  "inline-flex min-h-11 items-center rounded-lg border px-3 py-1 text-lg leading-ruby";
/** 可點的詞塊 */
const CHUNK_BUTTON = cn(
  CHUNK,
  "border-input bg-card transition-colors hover:bg-muted active:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);

/**
 * 換題、作答、移回後的點擊防護(同複習頁):雙擊時第二下會落在剛換到同一位置的鈕上
 * (確認 → 下一題、下一題 → 下一題的略過、答案列移回後滑過來的下一塊),此時間內忽略
 */
export const TAP_GUARD_MS = 300;

/** 確認/下一題捲入畫面(聚焦)時讓出固定的底部導覽列(4rem + safe-area) */
const BOTTOM_SCROLL_MARGIN =
  "scroll-mb-[calc(4rem_+_env(safe-area-inset-bottom))]";

/** 點選後焦點的去處(按下的鈕會消失:移到下一個可點的塊,不掉到 body) */
type FocusTarget =
  | { area: "pool" | "answer"; chunk: number }
  | { area: "check" };

/**
 * 一題:題幹(中譯)、答案列(點詞塊依序排入;排入的塊再點一下移回)、待選的詞塊、
 * 確認/略過、回饋(答錯標出位置不對的格,並顯示教材原句與朗讀)。
 */
export function ReorderQuestion({
  lessonId,
  item,
  index,
  total,
  furigana,
  tts,
  focusOnMount,
  onAnswer,
  onNext,
}: {
  lessonId: number;
  item: ReorderItem;
  index: number;
  total: number;
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  /** 掛載時焦點移到題幹(換題、重新開始;頁面初次載入不搶焦點) */
  focusOnMount: boolean;
  /** 確認或略過:結果 + 答案列各格的文字(略過時為已排入的部分) */
  onAnswer: (outcome: ReorderOutcome, picked: string[]) => void;
  onNext: () => void;
}) {
  const hintId = useId();
  // 使用者排入答案列的塊(chunks 的 index,依排入順序;固定首尾時不含首尾塊)
  const [placed, setPlaced] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<ReorderOutcome | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const answered = outcome !== null;
  const complete = placed.length === item.shuffled.length;

  const promptRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<FocusTarget | null>(null);
  // 題目出現/作答的時刻、上次移回的時刻(TAP_GUARD_MS)
  const changedAt = useRef(0);
  const removedAt = useRef(0);
  const guarded = (at: { current: number }) =>
    Date.now() - at.current < TAP_GUARD_MS;
  const chipRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) chips.current.set(key, el);
    else chips.current.delete(key);
  };

  useEffect(() => {
    changedAt.current = Date.now();
    if (focusOnMount) promptRef.current?.focus({ preventScroll: true });
    // 只在掛載時(每題以 key 重新掛載)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 排入/移回後:焦點移到下一個可點的塊(或「確認」)
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.area === "check") checkRef.current?.focus();
    else chips.current.get(`${target.area}-${target.chunk}`)?.focus();
  }, [placed]);
  // 作答後答案列的鈕改為靜態、確認鈕卸載:焦點移到「下一題」
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);

  function place(chunk: number) {
    if (answered || placed.includes(chunk)) return;
    const next = [...placed, chunk];
    const pool = item.shuffled;
    const at = pool.indexOf(chunk);
    const free = (c: number) => !next.includes(c);
    const target =
      pool.slice(at + 1).find(free) ?? pool.slice(0, at).reverse().find(free);
    pendingFocus.current =
      target === undefined
        ? { area: "check" }
        : { area: "pool", chunk: target };
    setPlaced(next);
  }

  function remove(position: number) {
    if (answered || guarded(removedAt)) return;
    removedAt.current = Date.now();
    const chunk = placed[position];
    const next = placed.filter((_, i) => i !== position);
    // 原位置的下一塊 → 前一塊 → 移回待選區的這一塊
    const target = next[position] ?? next[position - 1];
    pendingFocus.current =
      target === undefined
        ? { area: "pool", chunk }
        : { area: "answer", chunk: target };
    setPlaced(next);
  }

  function answer(result: ReorderOutcome) {
    if (answered) return;
    changedAt.current = Date.now();
    const texts = pickedTexts(item, placed);
    setOutcome(result);
    setPicked(texts);
    onAnswer(result, texts);
  }

  function check() {
    if (!complete) return;
    answer(checkOrder(pickedTexts(item, placed), item) ? "correct" : "wrong");
  }

  function skip() {
    if (guarded(changedAt)) return;
    answer("skipped");
  }

  function next() {
    if (guarded(changedAt)) return;
    onNext();
  }

  // 位置不對的格(整句中的位置;答錯時標示)
  const wrongPositions =
    outcome === "wrong" ? misplacedPositions(picked, item) : [];
  const first = item.chunks[0];
  const last = item.chunks[item.chunks.length - 1];
  const offset = item.fixedEnds ? 1 : 0;
  const slots = item.shuffled.length - placed.length;
  const spoken = speechText(surfaceText(item.sentence.ruby));

  const chunkState = (position: number) =>
    outcome === "correct"
      ? "correct"
      : outcome === "wrong"
        ? wrongPositions.includes(position)
          ? "wrong"
          : "correct"
        : "idle";

  return (
    <div className="flex min-h-[80vh] flex-col">
      {/* 進度 */}
      <div className="px-4 py-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>例句重組・第 {lessonId} 課</span>
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

      {/* 靠上排列:詞塊移動使答案列換行時,題幹與待選區不跟著上下跳動 */}
      <div className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-4">
        {/* 題幹:中譯(換題後接手焦點) */}
        <div ref={promptRef} tabIndex={-1} className="outline-none">
          <p className="text-xs text-muted-foreground">依中譯排出日文句子</p>
          <p className="mt-1 text-lg font-medium">
            {promptText(item.sentence.translation)}
          </p>
        </div>

        {/* 答案列:固定的首尾塊、排入的塊(可移回)、剩餘格數。略過後不留半成品(看下方教材原句) */}
        {outcome !== "skipped" && (
          <div>
            <ol
              aria-label="你的答案"
              className="flex min-h-15 flex-wrap items-center gap-2 rounded-xl bg-muted p-2"
            >
              {item.fixedEnds && (
                <li>
                  <FixedChunk
                    chunk={first}
                    furigana={furigana}
                    state={chunkState(0)}
                  />
                </li>
              )}
              {placed.map((c, i) => {
                const chunk = item.chunks[c];
                return (
                  <li key={c}>
                    {answered ? (
                      <StaticChunk
                        chunk={chunk}
                        furigana={furigana}
                        state={chunkState(i + offset)}
                      />
                    ) : (
                      <button
                        ref={chipRef(`answer-${c}`)}
                        type="button"
                        onClick={() => remove(i)}
                        aria-describedby={hintId}
                        className={CHUNK_BUTTON}
                      >
                        <RubyText segments={chunk.ruby} furigana={furigana} />
                      </button>
                    )}
                  </li>
                );
              })}
              {/* 剩餘的空格(與詞塊等高:以隱形的一個字撐出行高) */}
              {!answered &&
                Array.from({ length: slots }, (_, i) => (
                  <li key={`slot-${i}`} aria-hidden>
                    <span
                      className={cn(
                        CHUNK,
                        "border-dashed border-muted-foreground",
                      )}
                    >
                      <span className="invisible">あ</span>
                    </span>
                  </li>
                ))}
              {item.fixedEnds && (
                <li>
                  <FixedChunk
                    chunk={last}
                    furigana={furigana}
                    state={chunkState(item.chunks.length - 1)}
                  />
                </li>
              )}
            </ol>
            {!answered && (
              <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">
                點下方詞塊依序排入;點答案列中的詞塊可移回。
                {item.fixedEnds && "首尾兩塊已固定。"}
              </p>
            )}
          </div>
        )}

        {/* 待選的詞塊:排入後留下同尺寸的虛線佔位,其餘詞塊不跳動 */}
        {!answered && (
          <ul
            aria-label="待選詞塊"
            className="flex flex-wrap justify-center gap-2"
          >
            {item.shuffled.map((c) => {
              const chunk = item.chunks[c];
              return (
                <li key={c}>
                  {placed.includes(c) ? (
                    <span
                      aria-hidden
                      className={cn(CHUNK, "border-dashed border-border")}
                    >
                      <span className="invisible">
                        <RubyText segments={chunk.ruby} furigana={furigana} />
                      </span>
                    </span>
                  ) : (
                    <button
                      ref={chipRef(`pool-${c}`)}
                      type="button"
                      onClick={() => place(c)}
                      aria-describedby={hintId}
                      className={CHUNK_BUTTON}
                    >
                      <RubyText segments={chunk.ruby} furigana={furigana} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/*
          回饋:答對/答錯/略過;答錯與略過顯示教材原句與朗讀。
          live region 先掛載、作答後再填入內容,螢幕閱讀器才會播報
        */}
        <div role="status" className="space-y-2 text-center">
          {outcome === "correct" && (
            <div className="flex items-center justify-center gap-4">
              <p className="font-medium text-success">答對 ✓</p>
              {tts && (
                <SpeakButton
                  text={spoken}
                  ariaLabel={`播放例句發音:${spoken}`}
                />
              )}
            </div>
          )}
          {outcome !== null && outcome !== "correct" && (
            <>
              <p
                className={cn(
                  "font-medium",
                  outcome === "wrong"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {outcome === "wrong" ? "答錯 ✗" : "已略過"}
              </p>
              {outcome === "wrong" && (
                <p className="text-sm">
                  第 {wrongPositions.map((p) => p + 1).join("、")} 格位置不對
                </p>
              )}
              <div className="rounded-xl border border-border bg-card px-4 py-3 text-left">
                <p className="text-xs text-muted-foreground">教材原句</p>
                <div className="mt-1 flex items-start gap-4">
                  <RubyText
                    segments={item.sentence.ruby}
                    furigana={furigana}
                    className="min-w-0 flex-1 text-lg leading-ruby"
                  />
                  {tts && (
                    <SpeakButton
                      text={spoken}
                      ariaLabel={`播放例句發音:${spoken}`}
                      className="-mt-0.5"
                    />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                語序以教材為準;日語語序有彈性,其他排法不一定錯。
              </p>
            </>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        {answered ? (
          <Button
            ref={nextRef}
            onClick={next}
            className={cn("h-12 w-full", BOTTOM_SCROLL_MARGIN)}
          >
            {index + 1 >= total ? "看結果" : "下一題"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={skip}
              className="h-12 flex-1 font-normal"
            >
              略過
            </Button>
            <Button
              ref={checkRef}
              onClick={check}
              disabled={!complete}
              className={cn("h-12 flex-[2]", BOTTOM_SCROLL_MARGIN)}
            >
              確認
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type ChunkState = "idle" | "correct" | "wrong";

/** 作答後答案列的塊(不可點):答對綠框;答錯時位置不對的格紅框並附文字說明 */
function StaticChunk({
  chunk,
  furigana,
  state,
  children,
}: {
  chunk: ReorderChunk;
  furigana: FuriganaMode;
  state: ChunkState;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        CHUNK,
        state === "correct"
          ? "border-success bg-success/10"
          : state === "wrong"
            ? "border-destructive bg-destructive/10"
            : "border-input bg-card",
      )}
    >
      <RubyText segments={chunk.ruby} furigana={furigana} />
      {children}
      {state === "wrong" && <span className="sr-only">(位置不對)</span>}
    </span>
  );
}

/** 固定的首尾塊(6 塊以上):不可移動,作答前以無框的底色與可點的塊區分 */
function FixedChunk({
  chunk,
  furigana,
  state,
}: {
  chunk: ReorderChunk;
  furigana: FuriganaMode;
  state: ChunkState;
}) {
  if (state !== "idle") {
    return (
      <StaticChunk chunk={chunk} furigana={furigana} state={state}>
        <span className="sr-only">(固定)</span>
      </StaticChunk>
    );
  }
  return (
    <span className={cn(CHUNK, "border-transparent")}>
      <RubyText segments={chunk.ruby} furigana={furigana} />
      <span className="sr-only">(固定)</span>
    </span>
  );
}
