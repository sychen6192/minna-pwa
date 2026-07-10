"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { getLesson } from "@/lib/content";
import { findExampleSentence } from "@/lib/examples";
import { getSetting } from "@/lib/db";
import { getLeeches, LEECH_THRESHOLD } from "@/lib/srs";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

/** ruby 分段的表面文字(TTS 讀例句用) */
function plainText(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

interface DrillItem {
  vocab: VocabItem;
  lessonTitle: string;
  lapses: number;
  example: Sentence | null;
}

type Phase = "loading" | "empty" | "drill" | "done" | "error";

export default function PracticePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DrillItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [furigana, setFurigana] = useState<FuriganaMode>("show");

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
          const vocab = lesson?.vocab.find((v) => v.id === card.cardId);
          return lesson && vocab
            ? {
                vocab,
                lessonTitle: lesson.title,
                lapses: card.lapses,
                example: findExampleSentence(vocab, lesson),
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

  function next() {
    if (index + 1 >= items.length) {
      setPhase("done");
      return;
    }
    setIndex((i) => i + 1);
    setFlipped(false);
  }

  if (phase === "loading") {
    return <Centered>載入中…</Centered>;
  }
  if (phase === "error") {
    return (
      <Centered>
        <span className="text-red-600">載入頑固卡失敗:{error}</span>
      </Centered>
    );
  }
  if (phase === "empty") {
    return (
      <Centered>
        <p className="text-lg font-medium">目前沒有頑固卡 🎉</p>
        <p className="mt-2 text-sm text-foreground/60">
          複習中一再答錯(達 {LEECH_THRESHOLD} 次)的字會列為頑固卡,集中在這裡加強。
        </p>
        <Link href="/" className="mt-4 text-sm text-sky-700 underline">
          回首頁
        </Link>
      </Centered>
    );
  }
  if (phase === "done") {
    return (
      <Centered>
        <p className="text-lg font-medium">頑固卡練習完成 🎉</p>
        <p className="mt-2 text-sm text-foreground/60">
          本次過了 {items.length} 張;練習不影響複習排程,到期時仍會照常出現。
        </p>
        <Link href="/" className="mt-4 text-sm text-sky-700 underline">
          回首頁
        </Link>
      </Centered>
    );
  }

  // phase === "drill"
  const item = items[index];
  return (
    <div className="flex min-h-[80vh] flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-xs text-foreground/60">
        <span>頑固卡練習</span>
        <span>
          {index + 1} / {items.length}
        </span>
      </div>

      <button
        type="button"
        aria-label={flipped ? "頑固卡" : "顯示答案"}
        onClick={() => !flipped && setFlipped(true)}
        className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center"
      >
        <div className="text-3xl">
          <RubyText segments={item.vocab.ruby} furigana={furigana} />
        </div>
        {flipped && (
          <div className="space-y-1">
            <div className="text-base text-foreground/70">{item.vocab.kana}</div>
            <div className="text-lg">{item.vocab.meaning}</div>
            <div className="text-xs text-foreground/60">
              {item.vocab.pos}・{item.lessonTitle}・答錯 {item.lapses} 次
            </div>
          </div>
        )}
      </button>

      {flipped && (
        <div className="space-y-2 px-4 pb-2">
          <div className="flex justify-center">
            <SpeakButton text={item.vocab.kana} label="發音" />
          </div>
          {item.example && (
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  <RubyText segments={item.example.ruby} furigana={furigana} />
                  <p className="mt-1 text-xs text-foreground/60">
                    {item.example.translation}
                  </p>
                </div>
                <SpeakButton
                  text={plainText(item.example.ruby)}
                  ariaLabel="播放例句發音"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-4">
        {flipped ? (
          <button
            type="button"
            onClick={next}
            className="w-full rounded-lg bg-sky-600 py-3 font-medium text-white transition-colors active:bg-sky-700"
          >
            {index + 1 >= items.length ? "完成" : "下一張"}
          </button>
        ) : (
          <p className="text-center text-sm text-foreground/60">點擊卡片顯示答案</p>
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
