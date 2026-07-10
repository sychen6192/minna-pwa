"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getLesson, getLessonIndex } from "@/lib/content";
import {
  buildSearchIndex,
  searchAll,
  type SearchHit,
  type SearchIndex,
  type SearchKind,
} from "@/lib/search";
import type { Lesson } from "@/schemas/lesson";

interface GrammarEntry {
  id: string;
  lessonId: number;
  pattern: string;
}

interface Loaded {
  index: SearchIndex;
  entries: GrammarEntry[]; // 跨課文法列表(課號排序)
}

// 索引建構約百餘 ms,模組層快取避免重建(content.ts 另有 fetch 快取)
let cached: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  cached ??= (async () => {
    const idx = await getLessonIndex();
    const lessons: Lesson[] = await Promise.all(
      idx.lessons.map((meta) => getLesson(meta.id)),
    );
    const entries = lessons.flatMap((l) =>
      l.grammar.map((g) => ({ id: g.id, lessonId: l.id, pattern: g.pattern })),
    );
    return { index: buildSearchIndex(lessons), entries };
  })().catch((e: unknown) => {
    cached = null; // 失敗不快取,允許重試
    throw e;
  });
  return cached;
}

const KIND_META: Record<SearchKind, { label: string; cls: string }> = {
  grammar: { label: "文型", cls: "bg-sky-600/10 text-sky-700 dark:text-sky-400" },
  example: { label: "例句", cls: "bg-violet-600/10 text-violet-700 dark:text-violet-400" },
  vocab: { label: "単語", cls: "bg-green-600/10 text-green-700 dark:text-green-400" },
};

function hitHref(h: SearchHit): string {
  return h.anchor ? `/lessons/${h.lessonId}#${h.anchor}` : `/lessons/${h.lessonId}`;
}

export default function GrammarPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    load()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const hits = useMemo(
    () => (data && query.trim() ? searchAll(data.index, query) : null),
    [data, query],
  );

  return (
    <div>
      <h1 className="px-4 py-3 text-lg font-bold">文法速查</h1>

      <div className="px-4 pb-3">
        <input
          type="search"
          aria-label="搜尋文型、解說、例句、單字"
          placeholder="搜尋文型、解說、例句、單字…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!data}
          className="w-full rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <p className="px-4 py-8 text-center text-sm text-red-600">載入失敗:{error}</p>
      )}
      {!error && !data && (
        <p className="px-4 py-8 text-center text-sm text-foreground/60">
          載入全部課程資料中…
        </p>
      )}

      {/* 搜尋結果 */}
      {data && hits && (
        <ul aria-label="搜尋結果">
          {hits.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-foreground/60">
              找不到「{query}」的結果
            </p>
          )}
          {hits.map((h) => {
            const meta = KIND_META[h.kind];
            return (
              <li key={`${h.kind}-${h.id}`}>
                <Link
                  href={hitHref(h)}
                  className="flex items-start gap-2 border-b border-foreground/10 px-4 py-3 transition-colors active:bg-foreground/5"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{h.title}</span>
                    {h.snippet && (
                      <span className="block truncate text-xs text-foreground/60">
                        {h.snippet}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-foreground/50">
                    第 {h.lessonId} 課
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* 無查詢:跨課文法列表(課號排序,F4.1) */}
      {data && !hits && (
        <ul aria-label="全部文法點">
          {data.entries.map((g) => (
            <li key={g.id}>
              <Link
                href={`/lessons/${g.lessonId}#${g.id}`}
                className="flex items-center justify-between border-b border-foreground/10 px-4 py-3 transition-colors active:bg-foreground/5"
              >
                <span className="min-w-0 truncate font-medium">{g.pattern}</span>
                <span className="ml-3 shrink-0 text-xs text-foreground/50">
                  第 {g.lessonId} 課
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
