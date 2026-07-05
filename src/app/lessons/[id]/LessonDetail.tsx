"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Volume2 } from "lucide-react";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { getLesson } from "@/lib/content";
import { addCards, existingCardIds } from "@/lib/srs";
import { speak } from "@/lib/tts";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/schemas/lesson";

type Tab = "vocab" | "grammar" | "dialogue";

const TABS: { key: Tab; label: string }[] = [
  { key: "vocab", label: "単語" },
  { key: "grammar", label: "文型" },
  { key: "dialogue", label: "会話" },
];

export function LessonDetail({ id }: { id: number }) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("vocab");
  const [furigana, setFurigana] = useState<FuriganaMode>("show");
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    getLesson(id)
      .then((data) => {
        if (active) setLesson(data);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [id]);

  // 初始化「已加入複習」狀態
  useEffect(() => {
    if (!lesson) return;
    let active = true;
    existingCardIds(lesson.vocab.map((v) => v.id))
      .then((ids) => {
        if (active) setAdded(new Set(ids));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [lesson]);

  const addOne = useCallback(
    async (cardId: string) => {
      if (!lesson) return;
      await addCards([cardId], lesson.id);
      setAdded((prev) => new Set(prev).add(cardId));
    },
    [lesson],
  );

  const addAll = useCallback(async () => {
    if (!lesson) return;
    const ids = lesson.vocab.map((v) => v.id);
    await addCards(ids, lesson.id);
    setAdded(new Set(ids));
  }, [lesson]);

  if (error) {
    return (
      <p className="px-4 py-8 text-center text-sm text-red-600">
        載入課程失敗:{error}
      </p>
    );
  }

  if (!lesson) {
    return (
      <p className="px-4 py-8 text-center text-sm text-foreground/60">
        載入中…
      </p>
    );
  }

  return (
    <div>
      <header className="flex items-start justify-between px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-foreground/60">第 {lesson.id} 課</div>
          <h1 className="text-lg font-bold">{lesson.title}</h1>
        </div>
        <button
          type="button"
          aria-pressed={furigana === "show"}
          onClick={() => setFurigana((f) => (f === "show" ? "hide" : "show"))}
          className="ml-3 shrink-0 rounded border border-foreground/20 px-2 py-1 text-xs"
        >
          {furigana === "show" ? "隱藏假名" : "顯示假名"}
        </button>
      </header>

      <div role="tablist" className="flex border-b border-foreground/10">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 py-2 text-sm transition-colors",
              tab === key
                ? "border-b-2 border-foreground font-medium"
                : "text-foreground/60",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "vocab" && (
        <VocabList
          lesson={lesson}
          furigana={furigana}
          added={added}
          onAddOne={addOne}
          onAddAll={addAll}
        />
      )}
      {tab === "grammar" && <GrammarList lesson={lesson} furigana={furigana} />}
      {tab === "dialogue" && (
        <DialogueList lesson={lesson} furigana={furigana} />
      )}
    </div>
  );
}

function VocabList({
  lesson,
  furigana,
  added,
  onAddOne,
  onAddAll,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
  added: Set<string>;
  onAddOne: (cardId: string) => void;
  onAddAll: () => void;
}) {
  const allAdded = lesson.vocab.every((v) => added.has(v.id));
  return (
    <div>
      <div className="flex justify-end px-4 py-2">
        <button
          type="button"
          onClick={onAddAll}
          disabled={allAdded}
          className="rounded border border-foreground/20 px-3 py-1 text-xs disabled:opacity-40"
        >
          {allAdded ? "整課已加入" : "整課加入複習"}
        </button>
      </div>
      <ul>
        {lesson.vocab.map((v) => {
          const isAdded = added.has(v.id);
          return (
            <li key={v.id} className="border-b border-foreground/10 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-lg">
                  <RubyText segments={v.ruby} furigana={furigana} />
                  <button
                    type="button"
                    aria-label={`播放 ${v.kana} 的發音`}
                    onClick={() => speak(v.kana)}
                    className="shrink-0 text-foreground/60 transition-colors active:text-foreground"
                  >
                    <Volume2 className="size-4" aria-hidden />
                  </button>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-foreground/60">{v.pos}</span>
                  {isAdded ? (
                    <span
                      aria-label={`${v.kana} 已加入複習`}
                      className="text-green-700"
                    >
                      <Check className="size-4" aria-hidden />
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`加入複習:${v.kana}`}
                      onClick={() => onAddOne(v.id)}
                      className="text-foreground/60 transition-colors active:text-foreground"
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-sm text-foreground/70">{v.meaning}</div>
              {v.note && (
                <div className="text-xs text-foreground/60">{v.note}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GrammarList({
  lesson,
  furigana,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
}) {
  if (lesson.grammar.length === 0) {
    return <Empty>本課沒有文型</Empty>;
  }
  return (
    <div>
      {lesson.grammar.map((g) => (
        <section
          key={g.id}
          id={g.id}
          className="scroll-mt-4 border-b border-foreground/10 px-4 py-3"
        >
          <h2 className="font-medium">{g.pattern}</h2>
          <p className="mt-1 text-sm text-foreground/70">{g.explanation}</p>
          <ul className="mt-2 space-y-2">
            {g.examples.map((s) => (
              <li key={s.id}>
                <div>
                  <RubyText segments={s.ruby} furigana={furigana} />
                </div>
                <div className="text-xs text-foreground/60">
                  {s.translation}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DialogueList({
  lesson,
  furigana,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
}) {
  if (lesson.dialogues.length === 0) {
    return <Empty>本課沒有会話</Empty>;
  }
  return (
    <ul className="px-4 py-2">
      {lesson.dialogues.map((d) => (
        <li key={d.id} className="py-2">
          {d.speaker && (
            <div className="text-xs text-foreground/60">{d.speaker}</div>
          )}
          <div>
            <RubyText segments={d.ruby} furigana={furigana} />
          </div>
          <div className="text-xs text-foreground/60">{d.translation}</div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-foreground/60">
      {children}
    </p>
  );
}
