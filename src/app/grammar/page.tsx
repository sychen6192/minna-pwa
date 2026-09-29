"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loading } from "@/components/Loading";
import { getLesson, getLessonIndex } from "@/lib/content";
import { jaLang } from "@/lib/lang";
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

/** 徽章沿用課程頁分頁名(単語/文型 為日文用語,標 lang=ja;例句為中文) */
const KIND_META: Record<SearchKind, { label: string; lang?: "ja"; cls: string }> = {
  grammar: { label: "文型", lang: "ja", cls: "bg-tag-grammar/10 text-tag-grammar" },
  example: { label: "例句", cls: "bg-tag-example/10 text-tag-example" },
  vocab: { label: "単語", lang: "ja", cls: "bg-tag-vocab/10 text-tag-vocab" },
};

function hitHref(h: SearchHit): string {
  return h.anchor ? `/lessons/${h.lessonId}#${h.anchor}` : `/lessons/${h.lessonId}`;
}

/** 搜尋字串寫回網址(?q=)的延遲:打字中不每鍵改寫 */
const QUERY_SYNC_MS = 300;

/** 目前網址對應 `query` 的版本(?q= 存搜尋字串,空白查詢則移除);已相同時回傳 null。 */
function urlWithQuery(query: string): string | null {
  const url = new URL(window.location.href);
  if (query.trim()) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  return url.href === window.location.href ? null : `${url.pathname}${url.search}${url.hash}`;
}

export default function GrammarPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // 搜尋字串存於網址 ?q=(replaceState,不新增歷史紀錄):點結果再返回時還原。
  // 掛載後才讀 location(不用 useSearchParams:靜態匯出下需 Suspense 邊界,且預先渲染時無查詢字串)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
  }, []);
  // 延遲中的寫入(沒有則為 null):點連結時先寫入,見下方 capture 監聽
  const flushQuery = useRef<(() => void) | null>(null);
  useEffect(() => {
    const pathname = window.location.pathname;
    let timer = 0;
    const sync = () => {
      window.clearTimeout(timer);
      flushQuery.current = null;
      // 已離開本頁(如延遲中按上一頁):不改寫別頁的網址
      if (window.location.pathname !== pathname) return;
      const next = urlWithQuery(query);
      if (next !== null) window.history.replaceState(null, "", next);
    };
    timer = window.setTimeout(sync, QUERY_SYNC_MS);
    flushQuery.current = sync;
    return () => {
      window.clearTimeout(timer);
      flushQuery.current = null;
    };
  }, [query]);
  // 點任何連結(搜尋結果、底部導覽…)時先寫入延遲中的查詢:返回時還原到剛輸入的字串。
  // capture 階段早於 Link 的導覽;Next 會把 replaceState 同步進 router(ACTION_RESTORE),
  // 若等導覽開始後計時器才寫入,會取消尚在載入中的導覽
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a[href]")) flushQuery.current?.();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

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
      <h1 className="px-4 pt-3 pb-1 text-lg font-bold">文法速查</h1>

      {/* 黏在頂端:捲動長列表時仍可改查詢 */}
      <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-2">
        <input
          type="search"
          aria-label="搜尋文型、解說、例句、單字"
          placeholder="搜尋文型、解說、例句、單字…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!data}
          // 16px 以上:iOS Safari 不會在 focus 時放大頁面
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
        />
      </div>

      {error && (
        <p className="px-4 py-8 text-center text-sm text-destructive">載入失敗:{error}</p>
      )}
      {!error && !data && <Loading label="載入全部課程資料中…" />}

      {/* 搜尋結果 */}
      {data && hits && (
        <ul aria-label="搜尋結果">
          {hits.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              找不到「{query}」的結果
            </p>
          )}
          {hits.map((h) => {
            const meta = KIND_META[h.kind];
            return (
              <li key={`${h.kind}-${h.id}`}>
                <Link
                  href={hitHref(h)}
                  className="flex items-start gap-2 border-b border-border px-4 py-3 transition-colors active:bg-muted"
                >
                  <span
                    lang={meta.lang}
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* 單字/例句必為日文;文型 pattern 少數是中文說明 */}
                    <span
                      lang={h.kind === "grammar" ? jaLang(h.title) : "ja"}
                      className="block truncate font-medium"
                    >
                      {h.title}
                    </span>
                    {h.snippet && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {h.snippet}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
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
                className="flex items-center justify-between border-b border-border px-4 py-3 transition-colors active:bg-muted"
              >
                <span lang={jaLang(g.pattern)} className="min-w-0 truncate font-medium">
                  {g.pattern}
                </span>
                <span className="ml-3 shrink-0 text-xs text-muted-foreground">
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
