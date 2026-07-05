"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLessonIndex } from "@/lib/content";
import type { LessonIndex } from "@/schemas/lesson";

/** 測驗選課入口(T7.4):選一課開始 10 題測驗 */
export default function QuizIndexPage() {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getLessonIndex()
      .then((data) => {
        if (active) setIndex(data);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <h1 className="px-4 py-3 text-lg font-bold">測驗</h1>
      <p className="px-4 pb-2 text-sm text-foreground/60">選擇一課開始測驗。</p>

      {error && (
        <p className="px-4 py-8 text-center text-sm text-red-600">
          載入課程失敗:{error}
        </p>
      )}

      {!error && !index && (
        <p className="px-4 py-8 text-center text-sm text-foreground/60">載入中…</p>
      )}

      {index && (
        <ul>
          {index.lessons.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/quiz/${lesson.id}`}
                className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 transition-colors active:bg-foreground/5"
              >
                <div className="min-w-0">
                  <div className="text-xs text-foreground/60">第 {lesson.id} 課</div>
                  <div className="truncate font-medium">{lesson.title}</div>
                </div>
                <div className="ml-3 shrink-0 text-sm text-foreground/60">
                  {lesson.vocabCount} 字
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
