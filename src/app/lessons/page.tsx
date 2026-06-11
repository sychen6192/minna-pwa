"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLessonIndex } from "@/lib/content";
import type { LessonIndex } from "@/schemas/lesson";

export default function LessonsPage() {
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
      <h1 className="px-4 py-3 text-lg font-bold">課程</h1>

      {error && (
        <p className="px-4 py-8 text-center text-sm text-red-600">
          載入課程失敗:{error}
        </p>
      )}

      {!error && !index && (
        <p className="px-4 py-8 text-center text-sm text-foreground/50">
          載入中…
        </p>
      )}

      {index && (
        <ul>
          {index.lessons.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/lessons/${lesson.id}`}
                className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 transition-colors active:bg-foreground/5"
              >
                <div className="min-w-0">
                  <div className="text-xs text-foreground/50">
                    第 {lesson.id} 課
                  </div>
                  <div className="truncate font-medium">{lesson.title}</div>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-sm">{lesson.vocabCount} 字</div>
                  {/* 進度佔位:Phase 3 接 DB 後改為實際狀態 */}
                  <div className="text-xs text-foreground/40">未開始</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
