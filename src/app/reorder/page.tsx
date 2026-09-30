"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Loading } from "@/components/Loading";
import { getLessonIndex } from "@/lib/content";
import { jaLang } from "@/lib/lang";
import type { LessonIndex } from "@/schemas/lesson";

/** 例句重組入口(T11.6,F7.4):選一課 → /reorder/[id](/quiz 的「練習」區塊連到這裡) */
export default function ReorderIndexPage() {
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
      <h1 className="px-4 pt-3 text-lg font-bold">例句重組</h1>
      <p className="px-4 pt-1 pb-3 text-sm text-muted-foreground">
        看中譯,把課本例句與<span lang="ja">会話</span>的詞塊排回原句(JLPT 文法「
        <span lang="ja">並べ替え</span>
        」題型)。選擇一課開始;單次練習,不影響複習排程。
      </p>

      {error && (
        <p className="px-4 py-8 text-center text-sm text-destructive">
          載入課程失敗:{error}
        </p>
      )}

      {!error && !index && <Loading />}

      {index && (
        <ul className="border-t border-border">
          {index.lessons.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/reorder/${lesson.id}`}
                className="flex items-center justify-between border-b border-border px-4 py-3 transition-colors active:bg-muted"
              >
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    第 {lesson.id} 課
                  </div>
                  <div
                    lang={jaLang(lesson.title)}
                    className="truncate font-medium"
                  >
                    {lesson.title}
                  </div>
                </div>
                <ChevronRight
                  className="ml-3 size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
