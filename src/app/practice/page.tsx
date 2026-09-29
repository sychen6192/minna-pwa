"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loading } from "@/components/Loading";
import { PitchAccent } from "@/components/PitchAccent";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { getLesson } from "@/lib/content";
import { findExampleSentence } from "@/lib/examples";
import { getSetting } from "@/lib/db";
import { jaLang } from "@/lib/lang";
import { displayNote } from "@/lib/notes";
import { isKanaSurface, kanaHeadword } from "@/lib/pitch";
import { baseVocabId, cardDirection, getLeeches, LEECH_THRESHOLD } from "@/lib/srs";
import { MATURE_STABILITY } from "@/lib/stats";
import { speechText } from "@/lib/tts";
import { useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

/** ruby 分段的表面文字(TTS 讀例句用) */
function plainText(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

interface DrillItem {
  vocab: VocabItem;
  lessonId: number;
  lessonTitle: string;
  lapses: number;
  example: Sentence | null;
  direction: "fwd" | "rev";
}

type Phase = "loading" | "empty" | "drill" | "done" | "error";

/** 翻卡區:未翻面為按鈕、翻面後為答案區,外觀相同 */
const CARD_CLASS = "flex flex-1 flex-col items-center justify-center gap-4 rounded-xl px-4 text-center";
/** 翻卡鈕的鍵盤焦點框:畫在卡片內側,不被螢幕邊緣裁掉 */
const CARD_FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring";

export default function PracticePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DrillItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [furigana, setFurigana] = useState<FuriganaMode>("show");
  const ttsEnabled = useTtsEnabled();
  // 焦點接手:翻面後移到答案區、換下一張後移到新卡、練完移到完成標題
  // (原本聚焦的按鈕已卸載,不讓焦點掉到 body)
  const cardRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (phase === "done") doneRef.current?.focus();
    else (flipped ? answerRef.current : cardRef.current)?.focus({ preventScroll: true });
  }, [phase, flipped, index]);

  useEffect(() => {
    let active = true;
    (async () => {
      const leeches = await getLeeches();
      if (!active) return;
      if (leeches.length === 0) {
        setPhase("empty");
        return;
      }
      const furi = await getSetting("furigana");
      const lessonIds = [...new Set(leeches.map((c) => c.lessonId))];
      const lessons = new Map<number, Lesson>();
      for (const id of lessonIds) lessons.set(id, await getLesson(id));
      const built = leeches
        .map((card): DrillItem | null => {
          const lesson = lessons.get(card.lessonId);
          const vocab = lesson?.vocab.find((v) => v.id === baseVocabId(card.cardId));
          return lesson && vocab
            ? {
                vocab,
                lessonId: card.lessonId,
                lessonTitle: lesson.title,
                lapses: card.lapses,
                example: findExampleSentence(vocab, lesson),
                direction: cardDirection(card),
              }
            : null;
        })
        .filter((x): x is DrillItem => x !== null);
      if (!active) return;
      if (built.length === 0) {
        setPhase("empty");
        return;
      }
      setFurigana(furi);
      setItems(built);
      setPhase("drill");
    })().catch((e: unknown) => {
      if (active) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function flip() {
    if (flipped) return;
    moveFocus.current = true;
    setFlipped(true);
  }

  function next() {
    moveFocus.current = true;
    if (index + 1 >= items.length) {
      setPhase("done");
      return;
    }
    setIndex((i) => i + 1);
    setFlipped(false);
  }

  if (phase === "loading") {
    return (
      <Centered>
        <Loading className="p-0" />
      </Centered>
    );
  }
  if (phase === "error") {
    return (
      <Centered>
        <span className="text-destructive">載入頑固卡失敗:{error}</span>
      </Centered>
    );
  }
  if (phase === "empty") {
    return (
      <Centered>
        <p className="text-lg font-medium">目前沒有頑固卡 🎉</p>
        <p className="mt-2 text-sm text-muted-foreground">
          複習中一再答錯(達 {LEECH_THRESHOLD} 次)的字會列為頑固卡,集中在這裡加強;記牢(穩定度達{" "}
          {MATURE_STABILITY} 天)後自動解除。
        </p>
        <Link
          href="/"
          className={buttonVariants({ variant: "link", className: "mt-1 px-3 text-sm" })}
        >
          回首頁
        </Link>
      </Centered>
    );
  }
  if (phase === "done") {
    return (
      <Centered>
        <h1 ref={doneRef} tabIndex={-1} className="text-lg font-medium outline-none">
          頑固卡練習完成 🎉
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          本次過了 {items.length} 張;練習不影響複習排程,到期時仍會照常出現。
        </p>
        <Link
          href="/"
          className={buttonVariants({ variant: "link", className: "mt-1 px-3 text-sm" })}
        >
          回首頁
        </Link>
      </Centered>
    );
  }

  // phase === "drill"
  const item = items[index];
  const isRev = item.direction === "rev";
  const note = displayNote(item.vocab.note);
  // 純假名字:標題即讀音 → 翻面後以重音標記取代標題,不再另列一行相同的假名
  const kanaOnly = isKanaSurface(item.vocab);
  const pitchHead = kanaHeadword(item.vocab);
  const answerHead =
    pitchHead !== null ? (
      <PitchAccent kana={pitchHead} accent={item.vocab.accent} />
    ) : (
      <RubyText segments={item.vocab.ruby} furigana={furigana} />
    );
  const cardFace = (
    <>
      {/* 回想卡題面加詞性・課號(同義詞消歧,不洩漏讀音) */}
      {isRev ? (
        <div>
          <div className="text-2xl font-medium">{item.vocab.meaning}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {item.vocab.pos}・第 {item.lessonId} 課
          </div>
        </div>
      ) : (
        <div className="text-3xl">
          {flipped ? answerHead : <RubyText segments={item.vocab.ruby} furigana={furigana} />}
        </div>
      )}
      {flipped && (
        <div className="space-y-1">
          {isRev ? (
            <>
              <div className="text-3xl">{answerHead}</div>
              {!kanaOnly && (
                <div className="text-base text-foreground/70">
                  <PitchAccent kana={item.vocab.kana} accent={item.vocab.accent} />
                </div>
              )}
            </>
          ) : (
            <>
              {!kanaOnly && (
                <div className="text-base text-foreground/70">
                  <PitchAccent kana={item.vocab.kana} accent={item.vocab.accent} />
                </div>
              )}
              <div className="text-lg">{item.vocab.meaning}</div>
            </>
          )}
          {/* 搭配提示;回想卡只在翻面後顯示 */}
          {note && <div className="text-sm text-foreground/70">{note}</div>}
          <div className="text-xs text-muted-foreground">
            {/* 回想卡題面已有詞性 */}
            {!isRev && `${item.vocab.pos}・`}
            <span lang={jaLang(item.lessonTitle)}>{item.lessonTitle}</span>・答錯 {item.lapses} 次
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-[80vh] flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
        <span>頑固卡練習 · {isRev ? "中 → 日" : "日 → 中"}</span>
        <span>
          {index + 1} / {items.length}
        </span>
      </div>

      {/*
        卡片:未翻面為按鈕(名稱 = 題面內容 + 「顯示答案」,不以 aria-label 蓋掉題目);
        翻面後改為可聚焦的答案區(tabIndex -1),焦點移入
      */}
      {flipped ? (
        <div ref={answerRef} tabIndex={-1} className={cn(CARD_CLASS, "outline-none")}>
          {cardFace}
        </div>
      ) : (
        <button
          ref={cardRef}
          type="button"
          onClick={flip}
          className={cn(CARD_CLASS, CARD_FOCUS)}
        >
          {cardFace}{" "}
          <span className="sr-only">顯示答案</span>
        </button>
      )}

      {flipped && (
        <div className="space-y-2 px-4 pb-2">
          {ttsEnabled && (
            <div className="flex justify-center">
              <SpeakButton text={speechText(item.vocab)} label="發音" />
            </div>
          )}
          {item.example && (
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  {/* 行高足以容納 furigana:有無讀音的行距一致 */}
                  <div className="text-base leading-ruby">
                    <RubyText segments={item.example.ruby} furigana={furigana} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.example.translation}
                  </p>
                </div>
                {ttsEnabled && (
                  <SpeakButton
                    text={speechText(plainText(item.example.ruby))}
                    ariaLabel="播放例句發音"
                    className="-m-3"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-4">
        {flipped ? (
          <Button onClick={next} className="h-12 w-full">
            {index + 1 >= items.length ? "完成" : "下一張"}
          </Button>
        ) : (
          <p className="text-center text-sm text-muted-foreground">點擊卡片顯示答案</p>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center text-sm">
      {children}
    </div>
  );
}
