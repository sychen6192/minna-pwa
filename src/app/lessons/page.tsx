"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLessonIndex } from "@/lib/content";
import { db } from "@/lib/db";
import { lessonProgress, lessonStatus, type LessonStatus } from "@/lib/stats";
import type { LessonIndex } from "@/schemas/lesson";

const STATUS_META: Record<LessonStatus, { label: string; cls: string }> = {
  "not-started": { label: "未開始", cls: "text-foreground/50" },
  "in-progress": { label: "進行中", cls: "text-sky-700 dark:text-sky-400" },
  done: { label: "已完成 ✓", cls: "text-green-700 dark:text-green-400" },
};

export default function LessonsPage() {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [statusById, setStatusById] = useState<Map<number, LessonStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [idx, cards] = await Promise.all([getLessonIndex(), db.cards.toArray()]);
      if (!active) return;
      setIndex(idx);
      const byId = new Map<number, LessonStatus>(
        lessonProgress(cards, idx).map((p) => [p.lessonId, lessonStatus(p)]),
      );
      setStatusById(byId);
    })().catch((e: unknown) => {
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
        <p className="px-4 py-8 text-center text-sm text-foreground/60">
          載入中…
        </p>
      )}

      {index && (
        <ul>
          {index.lessons.map((lesson) => {
            const status = statusById.get(lesson.id) ?? "not-started";
            const meta = STATUS_META[status];
            return (
              <li key={lesson.id}>
                <Link
                  href={`/lessons/${lesson.id}`}
                  className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 transition-colors active:bg-foreground/5"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-foreground/60">
                      第 {lesson.id} 課
                    </div>
                    <div className="truncate font-medium">{lesson.title}</div>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <div className="text-sm">{lesson.vocabCount} 字</div>
                    <div className={`text-xs ${meta.cls}`}>{meta.label}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
