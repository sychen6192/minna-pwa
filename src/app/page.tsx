"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Loading } from "@/components/Loading";
import { buttonVariants } from "@/components/ui/button";
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
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold tabular-nums">🔥 {streak}</div>
          <div className="text-xs text-muted-foreground">連續學習天數</div>
        </div>
        <div className="text-right">
          <div className="text-sm tabular-nums">
            <span className="font-bold">{todayCount}</span>
            <span className="text-muted-foreground"> / {goal}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            今日目標{goal < dailyGoal && `(依今日佇列調整,原設定 ${dailyGoal})`}
          </div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={met ? "h-full rounded-full bg-success" : "h-full rounded-full bg-primary"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {met && (
        <p className="mt-2 text-xs text-success">
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
      <section className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-base font-medium">還沒有加入任何單字</p>
        <p className="mt-1 text-sm text-muted-foreground">從課程挑一課,把單字加入複習吧。</p>
        <Link href="/lessons" className={buttonVariants({ className: "mt-4" })}>
          瀏覽課程
        </Link>
      </section>
    );
  }

  const total = queue.due + queue.fresh;
  if (total === 0) {
    const note = capNote(queue);
    return (
      <section className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-lg font-medium">今日任務完成 🎉</p>
        {note ? (
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">要不要去課程加入新單字?</p>
            <Link
              href="/lessons"
              className={buttonVariants({ variant: "link", className: "mt-1 px-3 text-sm" })}
            >
              瀏覽課程
            </Link>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/[0.06] p-6 text-center">
      <p className="text-sm text-muted-foreground">今日待複習</p>
      <p className="mt-1 text-5xl font-bold tabular-nums text-link">{total}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        複習 {queue.due} · 新卡 {queue.fresh}
      </p>
      <Link href="/review" className={buttonVariants({ className: "mt-4 px-6" })}>
        開始複習
      </Link>
    </section>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center rounded-lg border border-border bg-card py-3 text-sm font-medium transition-colors active:bg-muted"
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
        <p className="mt-1 text-sm text-muted-foreground">《大家的日本語》初級 I・II</p>
      </header>

      {phase === "error" && (
        <p className="py-8 text-center text-sm text-destructive">載入失敗:{error}</p>
      )}

      {phase === "loading" && <Loading className="px-0" />}

      {phase === "ready" && data && (
        <div className="space-y-6">
          <HeroCard queue={data.queue} hasCards={data.hasCards} />

          {/* 安裝提示:一般排版(不以浮層蓋住操作),首次造訪即顯示,直到安裝或按「知道了」 */}
          <InstallPrompt />

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
              className="flex items-center justify-between rounded-xl border border-warning-accent/30 bg-warning-accent/[0.08] px-4 py-3 transition-colors active:bg-warning-accent/15"
            >
              <div>
                <div className="text-sm font-medium text-warning">
                  {data.leeches} 張頑固卡需要加強
                </div>
                <div className="text-xs text-muted-foreground">一再答錯的字,點此集中練習</div>
              </div>
              <span aria-hidden className="text-warning">
                →
              </span>
            </Link>
          )}

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已開始課程</span>
              <span className="font-medium tabular-nums">
                {data.summary.startedLessons} / {data.summary.totalLessons} 課
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">累計單字</span>
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
