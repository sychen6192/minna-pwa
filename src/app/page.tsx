"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StudySummary } from "@/lib/stats";

type Phase = "loading" | "ready" | "error";

// 資料層(Dexie / ts-fsrs / content)於首屏後才需要;動態載入使其不計入
// 首頁 first-load bundle(N4:首頁 JS gzip < 200 KB)。type 匯入已於編譯期抹除。
interface Dashboard {
  due: number;
  leeches: number;
  summary: StudySummary;
  streak: number;
  todayCount: number;
  dailyGoal: number;
}

async function loadDashboard(now: number): Promise<Dashboard> {
  const [{ db, getSetting }, { getLessonIndex }, srs, stats] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/content"),
    import("@/lib/srs"),
    import("@/lib/stats"),
  ]);
  const nowDate = new Date(now);
  const [cards, logs, index, due, leeches, dailyGoal] = await Promise.all([
    db.cards.toArray(),
    db.logs.toArray(),
    getLessonIndex(),
    srs.countDue(now),
    srs.countLeeches(),
    getSetting("dailyGoal"),
  ]);
  return {
    due,
    leeches,
    summary: stats.studySummary(cards, index),
    streak: stats.computeStreak(logs, nowDate),
    todayCount: stats.reviewsToday(logs, nowDate),
    dailyGoal,
  };
}

/** 連續天數 + 今日目標進度。 */
function StreakGoalCard({
  streak,
  todayCount,
  dailyGoal,
}: {
  streak: number;
  todayCount: number;
  dailyGoal: number;
}) {
  const pct = dailyGoal > 0 ? Math.min(100, Math.round((todayCount / dailyGoal) * 100)) : 100;
  const met = todayCount >= dailyGoal;
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
            <span className="text-foreground/60"> / {dailyGoal}</span>
          </div>
          <div className="text-xs text-foreground/60">今日目標</div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
        <div
          className={met ? "h-full rounded-full bg-green-600" : "h-full rounded-full bg-sky-600"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {met && (
        <p className="mt-2 text-xs text-green-700 dark:text-green-400">今日目標已達成 🎉</p>
      )}
    </section>
  );
}

/** 今日複習 Hero:依「空 DB / 有到期 / 無到期」三態切換主行動。 */
function HeroCard({ due, hasCards }: { due: number; hasCards: boolean }) {
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

  if (due === 0) {
    return (
      <section className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 text-center">
        <p className="text-lg font-medium">今天沒有到期的卡片 🎉</p>
        <p className="mt-1 text-sm text-foreground/60">要不要去課程加入新單字?</p>
        <Link href="/lessons" className="mt-4 inline-block text-sm text-sky-700 underline">
          瀏覽課程
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-sky-600/20 bg-sky-600/[0.06] p-6 text-center">
      <p className="text-sm text-foreground/60">今日到期</p>
      <p className="mt-1 text-5xl font-bold tabular-nums text-sky-700">{due}</p>
      <p className="mt-1 text-sm text-foreground/60">張卡片</p>
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
  // 進頁面時定格,避免 due 隨 render 時間飄移
  const [now] = useState(() => Date.now());

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
        <h1 className="text-2xl font-bold">みんなの日本語</h1>
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
          <HeroCard due={data.due} hasCards={data.summary.totalCards > 0} />

          {data.summary.totalCards > 0 && (
            <StreakGoalCard
              streak={data.streak}
              todayCount={data.todayCount}
              dailyGoal={data.dailyGoal}
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
              <span className="text-foreground/60">累計卡片</span>
              <span className="font-medium tabular-nums">{data.summary.totalCards} 張</span>
            </div>
          </section>

          <nav className="grid grid-cols-3 gap-3" aria-label="快捷入口">
            <QuickLink href="/lessons" label="課程" />
            <QuickLink href="/quiz" label="測驗" />
            <QuickLink href="/stats" label="統計" />
          </nav>
        </div>
      )}
    </div>
  );
}
