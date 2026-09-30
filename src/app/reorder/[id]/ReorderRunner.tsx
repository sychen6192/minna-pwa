"use client";

import { useEffect, useState } from "react";
import { Loading } from "@/components/Loading";
import { getLesson } from "@/lib/content";
import { makeReorderRound, type ReorderItem } from "@/lib/reorder";
import { useSetting, useTtsEnabled } from "@/lib/useSetting";
import type { Lesson } from "@/schemas/lesson";
import { ReorderQuestion, type ReorderOutcome } from "./ReorderQuestion";
import { ReorderResult, type ReorderResultItem } from "./ReorderResult";

interface Round {
  items: ReorderItem[];
  index: number;
  results: ReorderResultItem[];
  done: boolean;
  /** 開始/重新開始的次數:題目元件的 key(再練一次時同一 index 也重新掛載) */
  seq: number;
}

function newRound(lesson: Lesson, seq: number): Round {
  const items = makeReorderRound(lesson);
  return { items, index: 0, results: [], done: items.length === 0, seq };
}

/** 例句重組(T11.6,F7.4):一課至多 8 題(題幹為中譯)→ 結果。單次練習,不寫入 SRS/DB。 */
export function ReorderRunner({ id }: { id: number }) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  const furigana = useSetting("furigana");
  const ttsEnabled = useTtsEnabled();

  useEffect(() => {
    let active = true;
    getLesson(id)
      .then((data) => {
        if (!active) return;
        setLesson(data);
        setRound(newRound(data, 0));
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (error) {
    return (
      <p className="px-4 py-8 text-center text-sm text-destructive">
        載入課程失敗:{error}
      </p>
    );
  }
  // 設定讀到後才渲染:詞塊不先閃出 furigana、回饋的發音鈕不晚一步出現
  if (!lesson || !round || furigana === undefined || ttsEnabled === undefined) {
    return <Loading />;
  }

  if (round.done) {
    return (
      <ReorderResult
        lessonId={id}
        results={round.results}
        furigana={furigana}
        tts={ttsEnabled}
        onRestart={() => setRound(newRound(lesson, round.seq + 1))}
      />
    );
  }

  const item = round.items[round.index];
  return (
    <ReorderQuestion
      key={`${round.seq}:${round.index}`}
      lessonId={id}
      item={item}
      index={round.index}
      total={round.items.length}
      furigana={furigana}
      tts={ttsEnabled}
      // 第一題在頁面載入時出現:不搶焦點;換題或重新開始後焦點移到題幹
      focusOnMount={round.index > 0 || round.seq > 0}
      onAnswer={(outcome: ReorderOutcome, picked: string[]) =>
        setRound({
          ...round,
          results: [...round.results, { item, outcome, picked }],
        })
      }
      onNext={() =>
        setRound(
          round.index + 1 >= round.items.length
            ? { ...round, done: true }
            : { ...round, index: round.index + 1 },
        )
      }
    />
  );
}
