"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RatingButtons } from "@/components/RatingButtons";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { getLesson } from "@/lib/content";
import { getSetting, type CardRow } from "@/lib/db";
import {
  buildQueue,
  countDue,
  previewIntervals,
  rate,
  type IntervalPreviews,
  type ReviewRating,
} from "@/lib/srs";
import type { Lesson, VocabItem } from "@/schemas/lesson";

const DAY = 86_400_000;

interface SessionItem {
  card: CardRow;
  vocab: VocabItem;
  lessonTitle: string;
}

type Phase = "loading" | "empty" | "review" | "summary" | "error";

type Stats = { again: number; hard: number; good: number; easy: number };
const ZERO_STATS: Stats = { again: 0, hard: 0, good: 0, easy: 0 };
const STAT_KEY: Record<ReviewRating, keyof Stats> = {
  1: "again",
  2: "hard",
  3: "good",
  4: "easy",
};

export default function ReviewPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [furigana, setFurigana] = useState<FuriganaMode>("show");
  const [previews, setPreviews] = useState<IntervalPreviews | null>(null);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [tomorrowDue, setTomorrowDue] = useState(0);

  // 載入佇列與卡片內容
  useEffect(() => {
    let active = true;
    (async () => {
      const now = Date.now();
      const cards = await buildQueue(now);
      if (!active) return;
      if (cards.length === 0) {
        const due = await countDue(now + DAY);
        if (active) {
          setTomorrowDue(due);
          setPhase("empty");
        }
        return;
      }
      const furi = await getSetting("furigana");
      const lessonIds = [...new Set(cards.map((c) => c.lessonId))];
      const lessons = new Map<number, Lesson>();
      for (const id of lessonIds) lessons.set(id, await getLesson(id));
      const built = cards
        .map((card): SessionItem | null => {
          const lesson = lessons.get(card.lessonId);
          const vocab = lesson?.vocab.find((v) => v.id === card.cardId);
          return lesson && vocab
            ? { card, vocab, lessonTitle: lesson.title }
            : null;
        })
        .filter((x): x is SessionItem => x !== null);
      if (!active) return;
      if (built.length === 0) {
        setPhase("empty");
        return;
      }
      setFurigana(furi);
      setItems(built);
      setPhase("review");
    })().catch((e: unknown) => {
      if (active) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // 當前卡片的預估間隔
  useEffect(() => {
    if (phase !== "review") return;
    const item = items[index];
    if (!item) return;
    let active = true;
    previewIntervals(item.card.cardId, Date.now())
      .then((p) => {
        if (active) setPreviews(p);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [phase, index, items]);

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      const item = items[index];
      if (!item) return;
      await rate(item.card.cardId, rating, Date.now());
      setStats((s) => ({ ...s, [STAT_KEY[rating]]: s[STAT_KEY[rating]] + 1 }));
      const next = index + 1;
      if (next >= items.length) {
        const due = await countDue(Date.now() + DAY);
        setTomorrowDue(due);
        setPhase("summary");
      } else {
        setIndex(next);
        setFlipped(false);
        setPreviews(null);
      }
    },
    [items, index],
  );

  // 鍵盤:空白翻面、1–4 評分
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phase !== "review") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!flipped) setFlipped(true);
        return;
      }
      if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        void handleRate(Number(e.key) as ReviewRating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, flipped, handleRate]);

  if (phase === "loading") {
    return <Centered>載入中…</Centered>;
  }

  if (phase === "error") {
    return (
      <Centered>
        <span className="text-red-600">載入複習失敗:{error}</span>
      </Centered>
    );
  }

  if (phase === "empty") {
    return (
      <Centered>
        <p className="text-lg font-medium">今日複習完成 🎉</p>
        <p className="mt-2 text-sm text-foreground/50">
          明日到期:{tomorrowDue} 張
        </p>
        <Link href="/lessons" className="mt-4 text-sm text-sky-600 underline">
          回課程列表
        </Link>
      </Centered>
    );
  }

  if (phase === "summary") {
    const total = stats.again + stats.hard + stats.good + stats.easy;
    return (
      <div className="px-4 py-8">
        <h1 className="text-center text-lg font-bold">本次複習結算</h1>
        <p className="mt-4 text-center text-3xl font-bold">{total}</p>
        <p className="text-center text-sm text-foreground/50">張卡片</p>
        <dl className="mx-auto mt-6 max-w-xs space-y-1 text-sm">
          <Row label="重來" value={stats.again} />
          <Row label="困難" value={stats.hard} />
          <Row label="良好" value={stats.good} />
          <Row label="輕鬆" value={stats.easy} />
          <Row label="明日到期" value={tomorrowDue} />
        </dl>
        <div className="mt-8 text-center">
          <Link href="/lessons" className="text-sm text-sky-600 underline">
            回課程列表
          </Link>
        </div>
      </div>
    );
  }

  // phase === "review"
  const item = items[index];
  return (
    <div className="flex min-h-[80vh] flex-col">
      <div className="px-4 py-2 text-center text-xs text-foreground/50">
        {index + 1} / {items.length}
      </div>

      <button
        type="button"
        aria-label={flipped ? "複習卡片" : "顯示答案"}
        onClick={() => !flipped && setFlipped(true)}
        className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center"
      >
        <div className="text-3xl">
          <RubyText segments={item.vocab.ruby} furigana={furigana} />
        </div>
        {flipped && (
          <div className="space-y-1">
            <div className="text-base text-foreground/70">
              {item.vocab.kana}
            </div>
            <div className="text-lg">{item.vocab.meaning}</div>
            <div className="text-xs text-foreground/50">
              {item.vocab.pos}・{item.lessonTitle}
            </div>
          </div>
        )}
      </button>

      <div className="pb-4">
        {flipped ? (
          <RatingButtons previews={previews} onRate={handleRate} />
        ) : (
          <p className="text-center text-sm text-foreground/40">
            點擊卡片或按空白鍵顯示答案
          </p>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center text-sm">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border-b border-foreground/10 py-1">
      <dt className="text-foreground/60">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
