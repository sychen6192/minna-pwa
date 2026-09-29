"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loading } from "@/components/Loading";
import { getLessonIndex } from "@/lib/content";
import { db } from "@/lib/db";
import { jaLang } from "@/lib/lang";
import {
  lastRatingByCard,
  lessonProgress,
  lessonStatus,
  type LessonStatus,
} from "@/lib/stats";
import type { LessonIndex } from "@/schemas/lesson";

const STATUS_META: Record<LessonStatus, { label: string; cls: string }> = {
  "not-started": { label: "未開始", cls: "text-muted-foreground" },
  "in-progress": { label: "進行中", cls: "text-link" },
  done: { label: "已完成 ✓", cls: "text-success" },
};

export default function LessonsPage() {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [statusById, setStatusById] = useState<Map<number, LessonStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [idx, cards, logs] = await Promise.all([
        getLessonIndex(),
        db.cards.toArray(),
        db.logs.toArray(),
      ]);
      if (!active) return;
      setIndex(idx);
      // 最後一次評「重來」的字不算已學會(stats.lessonProgress)
      const byId = new Map<number, LessonStatus>(
        lessonProgress(cards, idx, lastRatingByCard(logs)).map((p) => [
          p.lessonId,
          lessonStatus(p),
        ]),
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
        <p className="px-4 py-8 text-center text-sm text-destructive">
          載入課程失敗:{error}
        </p>
      )}

      {!error && !index && <Loading />}

      {index && (
        <ul>
          {index.lessons.map((lesson) => {
            const status = statusById.get(lesson.id) ?? "not-started";
            const meta = STATUS_META[status];
            return (
              <li key={lesson.id}>
                <Link
                  href={`/lessons/${lesson.id}`}
                  className="flex items-center justify-between border-b border-border px-4 py-3 transition-colors active:bg-muted"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">
                      第 {lesson.id} 課
                    </div>
                    <div lang={jaLang(lesson.title)} className="truncate font-medium">
                      {lesson.title}
                    </div>
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
