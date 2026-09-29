"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loading } from "@/components/Loading";
import { getLessonIndex, getSupplementaryWords } from "@/lib/content";
import { db } from "@/lib/db";
import { jaLang } from "@/lib/lang";
import {
  lastRatingByCard,
  lessonProgress,
  lessonStatus,
  type LessonStatus,
} from "@/lib/stats";
import { cn } from "@/lib/utils";
import type { LessonIndex } from "@/schemas/lesson";

const STATUS_META: Record<LessonStatus, { label: string; cls: string }> = {
  "not-started": { label: "未開始", cls: "text-muted-foreground" },
  "in-progress": { label: "進行中", cls: "text-link" },
  done: { label: "已完成 ✓", cls: "text-success" },
};

export default function LessonsPage() {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  // null = 狀態尚未算出(列表照常顯示,狀態欄留白)
  const [statusById, setStatusById] = useState<Map<number, LessonStatus> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 列表只等索引(記憶體快取,返回本頁時幾乎立即完成):列表高度先到位,瀏覽器才能還原捲動位置
  useEffect(() => {
    let active = true;
    getLessonIndex()
      .then((idx) => {
        if (active) setIndex(idx);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  // 各課狀態另外補上(IndexedDB + 已開始各課的補充單字),不擋列表渲染
  useEffect(() => {
    let active = true;
    (async () => {
      const [idx, cards, logs] = await Promise.all([
        getLessonIndex(),
        db.cards.toArray(),
        db.logs.toArray(),
      ]);
      // 補充單字不計入進度(整課加入不含它們);只需載入已有卡片的課
      const started = [...new Set(cards.map((c) => c.lessonId))];
      const supplementary = await getSupplementaryWords(started);
      if (!active) return;
      // 最後一次評「重來」的字不算已學會(stats.lessonProgress)
      const byId = new Map<number, LessonStatus>(
        lessonProgress(cards, idx, lastRatingByCard(logs), supplementary).map((p) => [
          p.lessonId,
          lessonStatus(p),
        ]),
      );
      setStatusById(byId);
    })().catch(() => {
      // 索引失敗由上方 effect 顯示錯誤;讀不到進度時狀態欄維持留白,列表仍可使用
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
            const status = statusById?.get(lesson.id);
            const meta = status ? STATUS_META[status] : null;
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
                    {/* 狀態算出前以空白佔位:列高不變 */}
                    <div className={cn("text-xs", meta?.cls)}>{meta?.label ?? "\u00a0"}</div>
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
