"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Loading } from "@/components/Loading";
import { getLessonIndex } from "@/lib/content";
import { jaLang } from "@/lib/lang";
import type { LessonIndex } from "@/schemas/lesson";

/** 「練習」區塊的卡片(單次練習,不寫入 SRS):新增練習只要在這裡加一筆 */
const PRACTICES: { href: string; title: string; description: ReactNode }[] = [
  {
    href: "/drill",
    title: "活用練習",
    description: (
      <>
        動詞與形容詞的活用形(<span lang="ja">て形</span>、<span lang="ja">ない形</span>
        …),依課程進度出題
      </>
    ),
  },
];

/** 測驗入口:上方「練習」(活用練習等),下方選一課開始 10 題單字測驗(T7.4) */
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

      <section aria-labelledby="practice-heading" className="px-4 pb-4">
        <h2 id="practice-heading" className="pb-2 text-sm font-medium">
          練習
        </h2>
        <ul className="space-y-2">
          {PRACTICES.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors active:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-sm text-muted-foreground">{p.description}</div>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <h2 className="px-4 text-sm font-medium">單字測驗</h2>
      <p className="px-4 pb-2 text-sm text-muted-foreground">選擇一課開始測驗。</p>

      {error && (
        <p className="px-4 py-8 text-center text-sm text-destructive">
          載入課程失敗:{error}
        </p>
      )}

      {!error && !index && <Loading />}

      {index && (
        <ul>
          {index.lessons.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/quiz/${lesson.id}`}
                className="flex items-center justify-between border-b border-border px-4 py-3 transition-colors active:bg-muted"
              >
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">第 {lesson.id} 課</div>
                  <div lang={jaLang(lesson.title)} className="truncate font-medium">
                    {lesson.title}
                  </div>
                </div>
                <div className="ml-3 shrink-0 text-sm text-muted-foreground">
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
