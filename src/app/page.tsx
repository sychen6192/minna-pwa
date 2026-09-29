"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { QueueCounts } from "@/lib/srs";
import type { GoalProgress, StudySummary } from "@/lib/stats";

type Phase = "loading" | "ready" | "error";

// 資料層(Dexie / ts-fsrs / content)於首屏後才需要;動態載入使其不計入
// 首頁 first-load bundle(N4:首頁 JS gzip < 200 KB)。type 匯入已於編譯期抹除。
interface Dashboard {
  queue: QueueCounts;
  hasCards: boolean;
  leeches: number;
  summary: StudySummary;
  streak: number;
  todayCount: number;
  dailyGoal: number;
  goal: GoalProgress;
}

async function loadDashboard(now: number): Promise<Dashboard> {
  const [{ db, getSetting }, { getLessonIndex }, srs, stats] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/content"),
    import("@/lib/srs"),
    import("@/lib/stats"),
  ]);
  const nowDate = new Date(now);
  const [cards, logs, index, queue, hasCards, leeches, dailyGoal] = await Promise.all([
    db.cards.toArray(),
    db.logs.toArray(),
    getLessonIndex(),
    srs.queueCounts(now),
    srs.hasAnyCards(),
    srs.countLeeches(),
    getSetting("dailyGoal"),
  ]);
  const todayCount = stats.reviewsToday(logs, nowDate);
  return {
    queue,
    hasCards,
    leeches,
    summary: stats.studySummary(cards, index),
    streak: stats.computeStreak(logs, nowDate),
    todayCount,
    dailyGoal,
    goal: stats.effectiveGoal(dailyGoal, todayCount, queue.due + queue.fresh),
  };
}

/** 連續天數 + 今日目標進度(目標依今日佇列調整,見 stats.effectiveGoal)。 */
function StreakGoalCard({
  streak,
  todayCount,
  dailyGoal,
  goal: { goal, met, cleared },
}: {
  streak: number;
  todayCount: number;
  dailyGoal: number;
  goal: GoalProgress;
}) {
  const pct = goal > 0 ? Math.min(100, Math.round((todayCount / goal) * 100)) : 100;
  return (
    <section className="rounded-xl border border-foreground/10 p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold tabular-nums">🔥 {streak}</div>
          <div className="text-xs text-foreground/60">連續學習天數</div>
        </div>
        <div className="text-right">
          <div className="text-sm tabular-nums">
            <span className="font-bold">{todayCount}</span>
            <span className="text-foreground/60"> / {goal}</span>
          </div>
          <div className="text-xs text-foreground/60">
            今日目標{goal < dailyGoal && `(依今日佇列調整,原設定 ${dailyGoal})`}
          </div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
        <div
          className={met ? "h-full rounded-full bg-green-600" : "h-full rounded-full bg-sky-600"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {met && (
        <p className="mt-2 text-xs text-green-700 dark:text-green-400">
          {cleared ? "今日佇列已清空 ✓" : "今日目標已達成 🎉"}
        </p>
      )}
    </section>
  );
}

/**
 * 今日佇列已空、但仍有卡因每日上限等到明天時的說明;此時不建議「加入新單字」
 * (新卡額度已用完,今天加了也學不到)。
 */
function capNote(queue: QueueCounts): string | null {
  if (queue.reviewCapReached) return "今日複習已達上限,明天繼續";
  if (!queue.newCapReached) return null;
  return queue.newPerDay === 0 ? "每日新卡上限設為 0,暫不引入新卡" : "今日新卡已達上限,明天繼續";
}

/** 今日複習 Hero:依「空 DB / 今日佇列有卡 / 今日完成」三態切換主行動。 */
function HeroCard({ queue, hasCards }: { queue: QueueCounts; hasCards: boolean }) {
  if (!hasCards) {
    return (
      <section className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 text-center">
        <p className="text-base font-medium">還沒有加入任何單字</p>
        <p className="mt-1 text-sm text-foreground/60">從課程挑一課,把單字加入複習吧。</p>
        <Link
          href="/lessons"
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-sky-600 px-5 py-2.5 font-medium text-white transition-colors active:bg-sky-700"
        >
          瀏覽課程
        </Link>
      </section>
    );
  }

  const total = queue.due + queue.fresh;
  if (total === 0) {
    const note = capNote(queue);
    return (
      <section className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 text-center">
        <p className="text-lg font-medium">今日任務完成 🎉</p>
        {note ? (
          <p className="mt-1 text-sm text-foreground/60">{note}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-foreground/60">要不要去課程加入新單字?</p>
            <Link href="/lessons" className="mt-4 inline-block text-sm text-sky-700 underline">
              瀏覽課程
            </Link>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-sky-600/20 bg-sky-600/[0.06] p-6 text-center">
      <p className="text-sm text-foreground/60">今日待複習</p>
      <p className="mt-1 text-5xl font-bold tabular-nums text-sky-700">{total}</p>
      <p className="mt-1 text-sm text-foreground/60">
        複習 {queue.due} · 新卡 {queue.fresh}
      </p>
      <Link
        href="/review"
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-sky-600 px-6 py-2.5 font-medium text-white transition-colors active:bg-sky-700"
      >
        開始複習
      </Link>
    </section>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center rounded-lg border border-foreground/10 py-3 text-sm font-medium transition-colors active:bg-foreground/5"
    >
      {label}
    </Link>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  // 進頁面時定格,避免 due 隨 render 時間飄移;頁面重新可見時更新(見下)
  const [now, setNow] = useState(() => Date.now());

  // 從背景恢復(切回 App、bfcache 還原)時以當下時刻重算,跨過換日點後「今天」隨之更新
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") setNow(Date.now());
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
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await loadDashboard(now);
        if (!active) return;
        setData(d);
        setPhase("ready");
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [now]);

  return (
    <div className="px-4 py-6">
      <header className="mb-6">
        <h1 lang="ja" className="text-2xl font-bold">
          みんなの日本語
        </h1>
        <p className="mt-1 text-sm text-foreground/60">《大家的日本語》初級 I・II</p>
      </header>

      {phase === "error" && (
        <p className="py-8 text-center text-sm text-red-600">載入失敗:{error}</p>
      )}

      {phase === "loading" && (
        <p className="py-8 text-center text-sm text-foreground/60">載入中…</p>
      )}

      {phase === "ready" && data && (
        <div className="space-y-6">
          <HeroCard queue={data.queue} hasCards={data.hasCards} />

          {data.hasCards && (
            <StreakGoalCard
              streak={data.streak}
              todayCount={data.todayCount}
              dailyGoal={data.dailyGoal}
              goal={data.goal}
            />
          )}

          {data.leeches > 0 && (
            <Link
              href="/practice"
              className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 transition-colors active:bg-amber-500/[0.15]"
            >
              <div>
                <div className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {data.leeches} 張頑固卡需要加強
                </div>
                <div className="text-xs text-foreground/60">一再答錯的字,點此集中練習</div>
              </div>
              <span aria-hidden className="text-amber-700 dark:text-amber-400">
                →
              </span>
            </Link>
          )}

          <section className="rounded-xl border border-foreground/10 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/60">已開始課程</span>
              <span className="font-medium tabular-nums">
                {data.summary.startedLessons} / {data.summary.totalLessons} 課
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-foreground/60">累計單字</span>
              <span className="font-medium tabular-nums">{data.summary.totalWords} 字</span>
            </div>
          </section>

          <nav className="grid grid-cols-4 gap-3" aria-label="快捷入口">
            <QuickLink href="/lessons" label="課程" />
            <QuickLink href="/grammar" label="文法" />
            <QuickLink href="/quiz" label="測驗" />
            <QuickLink href="/stats" label="統計" />
          </nav>
        </div>
      )}
    </div>
  );
}
