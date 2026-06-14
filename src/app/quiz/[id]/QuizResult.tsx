"use client";

import { useState } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { addCards } from "@/lib/srs";
import type { QuizCandidate } from "@/lib/quiz";

export interface QuizResultItem {
  card: QuizCandidate;
  correct: boolean;
}

export function QuizResult({
  results,
  lessonId,
  furigana = "show",
}: {
  results: QuizResultItem[];
  lessonId: number;
  furigana?: FuriganaMode;
}) {
  const wrong = results.filter((r) => !r.correct);
  const correct = results.length - wrong.length;
  const [added, setAdded] = useState(false);

  async function addWrongToReview() {
    await addCards(
      wrong.map((r) => r.card.id),
      lessonId,
    );
    setAdded(true);
  }

  return (
    <div className="px-4 py-8">
      <h1 className="text-center text-lg font-bold">測驗完成</h1>
      <p className="mt-4 text-center text-3xl font-bold">
        {correct} / {results.length}
      </p>

      {wrong.length === 0 ? (
        <p className="mt-6 text-center text-sm text-green-600">全部答對 🎉</p>
      ) : (
        <>
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">錯題({wrong.length})</h2>
              <button
                type="button"
                onClick={addWrongToReview}
                disabled={added}
                className="rounded border border-foreground/20 px-3 py-1 text-xs disabled:opacity-40"
              >
                {added ? "已加入複習" : "錯題加入複習"}
              </button>
            </div>
            <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
              {wrong.map((r) => (
                <li
                  key={r.card.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="text-lg">
                    <RubyText segments={r.card.ruby} furigana={furigana} />
                  </span>
                  <span className="text-sm text-foreground/60">
                    {r.card.meaning}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className="mt-8 text-center">
        <Link
          href={`/lessons/${lessonId}`}
          className="text-sm text-sky-600 underline"
        >
          回課程
        </Link>
      </div>
    </div>
  );
}
