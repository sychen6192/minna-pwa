"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PitchAccent } from "@/components/PitchAccent";
import { RatingButtons } from "@/components/RatingButtons";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { getLesson } from "@/lib/content";
import { findExampleSentence } from "@/lib/examples";
import { getSetting, type CardRow } from "@/lib/db";
import {
  baseVocabId,
  buildQueue,
  cardDirection,
  countDueByTomorrow,
  hasAnyCards,
  previewIntervals,
  queueCounts,
  rate,
  setSuspended,
  type IntervalPreviews,
  type QueueCounts,
  type ReviewRating,
} from "@/lib/srs";
import { studyDayKey } from "@/lib/studyDay";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

/** ruby 分段的表面文字(TTS 讀例句用) */
function plainText(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

interface SessionItem {
  card: CardRow;
  vocab: VocabItem;
  lessonTitle: string;
  example: Sentence | null;
}

type Phase = "loading" | "empty" | "review" | "summary" | "error";

/** 空狀態的區分依據:尚未加入單字 / 今日新卡已達上限 / 今日完成 */
interface EmptyInfo {
  hasCards: boolean;
  counts: QueueCounts;
}

async function loadEmptyInfo(now: number): Promise<EmptyInfo> {
  const [hasCards, counts] = await Promise.all([hasAnyCards(), queueCounts(now)]);
  return { hasCards, counts };
}

/** 「可在設定調整」:連到設定頁的每日新卡上限 */
function SettingsHint({ prefix }: { prefix: string }) {
  return (
    <p className="mt-2 text-sm text-foreground/60">
      {prefix}可在
      <Link href="/settings" className="text-sky-700 underline">
        設定
      </Link>
      調整
    </p>
  );
}

/** 今日新卡已達上限(`newCapReached`)時的說明;`newPerDay` 為 0 時另給文案。 */
function NewCapMessage({ counts }: { counts: QueueCounts }) {
  if (counts.newPerDay === 0) {
    return (
      <>
        <p className="text-lg font-medium">每日新卡上限設為 0</p>
        <SettingsHint prefix="暫不引入新卡;" />
      </>
    );
  }
  // 設定於今日調低時 newToday 可能大於上限,以上限封頂
  const introduced = Math.min(counts.newToday, counts.newPerDay);
  return (
    <>
      <p className="text-lg font-medium">
        今日新卡已達上限({introduced}/{counts.newPerDay})
      </p>
      {/* 只有因額度而延後的新卡,調高上限才能今天引入;bury 的回想卡本來就明天才出 */}
      {counts.newCapped > 0 ? (
        <SettingsHint prefix="明天繼續;" />
      ) : (
        <p className="mt-2 text-sm text-foreground/60">明天繼續</p>
      )}
    </>
  );
}

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
  const [emptyInfo, setEmptyInfo] = useState<EmptyInfo | null>(null);
  // 遞增即重新載入佇列(頁面重新可見時,見下)
  const [loadSeq, setLoadSeq] = useState(0);
  // 最近一次載入的時刻(判斷是否已跨學習日)
  const loadedAt = useRef(0);

  // 載入佇列與卡片內容
  useEffect(() => {
    let active = true;
    (async () => {
      const now = Date.now();
      loadedAt.current = now;
      const showEmpty = async () => {
        const [due, info] = await Promise.all([countDueByTomorrow(now), loadEmptyInfo(now)]);
        if (active) {
          setTomorrowDue(due);
          setEmptyInfo(info);
          setPhase("empty");
        }
      };
      const cards = await buildQueue(now);
      if (!active) return;
      if (cards.length === 0) {
        await showEmpty();
        return;
      }
      const furi = await getSetting("furigana");
      const lessonIds = [...new Set(cards.map((c) => c.lessonId))];
      const lessons = new Map<number, Lesson>();
      for (const id of lessonIds) lessons.set(id, await getLesson(id));
      const built = cards
        .map((card): SessionItem | null => {
          const lesson = lessons.get(card.lessonId);
          const vocab = lesson?.vocab.find((v) => v.id === baseVocabId(card.cardId));
          return lesson && vocab
            ? {
                card,
                vocab,
                lessonTitle: lesson.title,
                example: findExampleSentence(vocab, lesson),
              }
            : null;
        })
        .filter((x): x is SessionItem => x !== null);
      if (!active) return;
      if (built.length === 0) {
        await showEmpty();
        return;
      }
      setFurigana(furi);
      setItems(built);
      setIndex(0);
      setFlipped(false);
      setPreviews(null);
      setStats(ZERO_STATS);
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
  }, [loadSeq]);

  // 頁面重新可見(切回 App、bfcache 還原)時重算「今天」;不打斷進行中的 session:
  // 空狀態一律重載;結算頁只在跨學習日時重載(同日短暫切走不丟失結算)
  useEffect(() => {
    if (phase !== "empty" && phase !== "summary") return;
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (phase === "summary" && studyDayKey(Date.now()) === studyDayKey(loadedAt.current)) {
        return;
      }
      setLoadSeq((n) => n + 1);
    }
    // 只處理 bfcache 還原;首次載入的 pageshow 不重複載入
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) onVisible();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [phase]);

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

  const advance = useCallback(async () => {
    const next = index + 1;
    if (next >= items.length) {
      const due = await countDueByTomorrow(Date.now());
      setTomorrowDue(due);
      setPhase("summary");
    } else {
      setIndex(next);
      setFlipped(false);
      setPreviews(null);
    }
  }, [index, items.length]);

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      const item = items[index];
      if (!item) return;
      await rate(item.card.cardId, rating, Date.now());
      setStats((s) => ({ ...s, [STAT_KEY[rating]]: s[STAT_KEY[rating]] + 1 }));
      await advance();
    },
    [items, index, advance],
  );

  // 「已會」:暫停此卡(不再進入複習)並跳下一張
  const handleSuspend = useCallback(async () => {
    const item = items[index];
    if (!item) return;
    await setSuspended(item.card.cardId, true);
    await advance();
  }, [items, index, advance]);

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
    if (emptyInfo && !emptyInfo.hasCards) {
      return (
        <Centered>
          <p className="text-lg font-medium">還沒有加入任何單字</p>
          <p className="mt-2 text-sm text-foreground/60">從課程挑一課,把單字加入複習吧。</p>
          <Link href="/lessons" className="mt-4 text-sm text-sky-700 underline">
            瀏覽課程
          </Link>
        </Centered>
      );
    }
    return (
      <Centered>
        {emptyInfo?.counts.newCapReached ? (
          <NewCapMessage counts={emptyInfo.counts} />
        ) : (
          <p className="text-lg font-medium">今日複習完成 🎉</p>
        )}
        <p className="mt-2 text-sm text-foreground/60">
          明日到期:{tomorrowDue} 張
        </p>
        <Link href="/" className="mt-4 text-sm text-sky-700 underline">
          回首頁
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
        <p className="text-center text-sm text-foreground/60">張卡片</p>
        <dl className="mx-auto mt-6 max-w-xs space-y-1 text-sm">
          <Row label="重來" value={stats.again} />
          <Row label="困難" value={stats.hard} />
          <Row label="良好" value={stats.good} />
          <Row label="輕鬆" value={stats.easy} />
          <Row label="明日到期" value={tomorrowDue} />
        </dl>
        <div className="mt-8 text-center">
          <Link href="/lessons" className="text-sm text-sky-700 underline">
            回課程列表
          </Link>
        </div>
      </div>
    );
  }

  // phase === "review"
  const item = items[index];
  const isRev = cardDirection(item.card) === "rev";
  return (
    <div className="flex min-h-[80vh] flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-xs text-foreground/60">
        <span className="rounded bg-foreground/5 px-1.5 py-0.5">
          {isRev ? "中 → 日" : "日 → 中"}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSuspend()}
            className="text-foreground/50 underline transition-colors active:text-foreground"
          >
            已會·略過
          </button>
          <span>
            {index + 1} / {items.length}
          </span>
        </div>
      </div>

      <button
        type="button"
        aria-label={flipped ? "複習卡片" : "顯示答案"}
        onClick={() => !flipped && setFlipped(true)}
        className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center"
      >
        {/* 提示面:回想卡(rev)給中文,辨識卡(fwd)給日文 */}
        {isRev ? (
          <div className="text-2xl font-medium">{item.vocab.meaning}</div>
        ) : (
          <div className="text-3xl">
            <RubyText segments={item.vocab.ruby} furigana={furigana} />
          </div>
        )}
        {flipped && (
          <div className="space-y-1">
            {isRev ? (
              <>
                <div className="text-3xl">
                  <RubyText segments={item.vocab.ruby} furigana={furigana} />
                </div>
                <div className="text-base text-foreground/70">
                  <PitchAccent kana={item.vocab.kana} accent={item.vocab.accent} />
                </div>
              </>
            ) : (
              <>
                <div className="text-base text-foreground/70">
                  <PitchAccent kana={item.vocab.kana} accent={item.vocab.accent} />
                </div>
                <div className="text-lg">{item.vocab.meaning}</div>
              </>
            )}
            <div className="text-xs text-foreground/60">
              {item.vocab.pos}・{item.lessonTitle}
            </div>
          </div>
        )}
      </button>

      {/* 揭曉後的發音與例句(置於 flip button 外,避免 button 巢狀) */}
      {flipped && (
        <div className="space-y-2 px-4 pb-2">
          <div className="flex justify-center">
            <SpeakButton text={item.vocab.kana} label="發音" />
          </div>
          {item.example && (
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  <RubyText segments={item.example.ruby} furigana={furigana} />
                  <p className="mt-1 text-xs text-foreground/60">
                    {item.example.translation}
                  </p>
                </div>
                <SpeakButton
                  text={plainText(item.example.ruby)}
                  ariaLabel="播放例句發音"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pb-4">
        {flipped ? (
          <RatingButtons previews={previews} onRate={handleRate} />
        ) : (
          <p className="text-center text-sm text-foreground/60">
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
