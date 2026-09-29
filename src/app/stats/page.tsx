"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Heatmap } from "@/components/Heatmap";
import { buttonVariants } from "@/components/ui/button";
import { getLessonIndex } from "@/lib/content";
import { db, type CardRow, type LogRow } from "@/lib/db";
import { jaLang } from "@/lib/lang";
import {
  cardTotals,
  dailyReviewCounts,
  dueForecast,
  lastRatingByCard,
  lessonProgress,
  MATURE_STABILITY,
  retentionRate,
  stageDistribution,
  weeklyRetention,
  type StageCounts,
} from "@/lib/stats";
import type { LessonIndex } from "@/schemas/lesson";

// 顏色為 globals.css 的 --stage-* token(兩種配色各自定義);圖例另有文字標籤與張數
const STAGES: { key: keyof StageCounts; label: string; cls: string }[] = [
  { key: "new", label: "新卡", cls: "bg-stage-new" },
  { key: "learning", label: "學習中", cls: "bg-stage-learning" },
  { key: "young", label: "未成熟", cls: "bg-stage-young" },
  { key: "mature", label: "已成熟", cls: "bg-stage-mature" },
  { key: "suspended", label: "已會", cls: "bg-stage-suspended" },
];

function StageBar({ counts }: { counts: StageCounts }) {
  const total = STAGES.reduce((sum, s) => sum + counts[s.key], 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">尚無卡片。</p>;
  }
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {STAGES.map((s) =>
          counts[s.key] > 0 ? (
            <div
              key={s.key}
              className={s.cls}
              style={{ width: `${(counts[s.key] / total) * 100}%` }}
              aria-label={`${s.label} ${counts[s.key]} 張`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {STAGES.map((s) => (
          <li key={s.key} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`inline-block size-2.5 rounded-full ${s.cls}`} aria-hidden />
              {s.label}
            </span>
            <span className="font-medium tabular-nums">
              {counts[s.key]}
              {/* 以卡片計,與上方「單字」(以字計)區分 */}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">張</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Phase = "loading" | "empty" | "ready" | "error";

// Recharts 以 CSS 變數上色(SVG 屬性支援 var()),深色模式隨 token 切換
const SERIES = "var(--color-chart-1)"; // 單一系列,單色相
const GRID = "var(--color-border)"; // 格線後退
const TICK = { fontSize: 10, fill: "var(--color-muted-foreground)" };
// Tooltip:卡片底 + 前景色文字(labelStyle/itemStyle 不設時,標籤會繼承 body 色而在某一配色下看不見)
const TOOLTIP = {
  contentStyle: {
    fontSize: 12,
    background: "var(--color-card)",
    borderColor: "var(--color-border)",
  },
  labelStyle: { color: "var(--color-foreground)" },
  itemStyle: { color: "var(--color-foreground)" },
};

/** "YYYY-MM-DD" → "M/D"(圖表刻度用) */
function shortDate(key: string): string {
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
}

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function StatTile({
  label,
  value,
  notes = [],
}: {
  label: string;
  value: string;
  notes?: string[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {notes.map((note) => (
        <div key={note} className="mt-0.5 text-xs text-muted-foreground">
          {note}
        </div>
      ))}
    </div>
  );
}

// 各課進度條兩段的顏色(圖例色塊共用同一 class)
const ADDED_CLS = "bg-chart-1/30";
const LEARNED_CLS = "bg-chart-1";

/** 各課進度圖例色塊:疊在與進度條相同的 muted 軌道上,兩種配色下都與條內顏色一致 */
function ProgressSwatch({ cls }: { cls: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-3 overflow-hidden rounded-sm bg-muted align-middle"
    >
      <span className={`block size-full ${cls}`} />
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

export default function StatsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [forecastDays, setForecastDays] = useState<7 | 30>(7);
  // 進頁面時定格,聚合結果穩定不隨 render 飄移
  const [now] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [cardRows, logRows, lessonIndex] = await Promise.all([
          db.cards.toArray(),
          db.logs.toArray(),
          getLessonIndex(),
        ]);
        if (!active) return;
        setCards(cardRows);
        setLogs(logRows);
        setIndex(lessonIndex);
        setPhase(cardRows.length === 0 && logRows.length === 0 ? "empty" : "ready");
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
  }, []);

  const daily = useMemo(() => dailyReviewCounts(logs, now), [logs, now]);
  const forecast = useMemo(
    () =>
      dueForecast(cards, now, forecastDays).map((d) => ({
        ...d,
        label: shortDate(d.date),
      })),
    [cards, now, forecastDays],
  );
  const weekly = useMemo(
    () =>
      weeklyRetention(logs, now).map((w) => ({
        label: shortDate(w.weekStart),
        rate: w.rate === null ? null : Math.round(w.rate * 100),
      })),
    [logs, now],
  );
  // 最後一次評分:「重來」者不算已學會、歸入學習中
  const lastRating = useMemo(() => lastRatingByCard(logs), [logs]);
  const progress = useMemo(
    () => (index ? lessonProgress(cards, index, lastRating) : []),
    [cards, index, lastRating],
  );
  const stages = useMemo(() => stageDistribution(cards, lastRating), [cards, lastRating]);
  // 單字 = 正向卡數(與首頁「累計單字」同口徑);卡片另含義→日回想卡
  const totals = useMemo(() => cardTotals(cards), [cards]);
  const hasReverse = totals.cards > totals.words;
  const todayCount = daily.length ? daily[daily.length - 1].count : 0;

  if (phase === "loading") {
    return <p className="p-6 text-center text-sm text-muted-foreground">載入中…</p>;
  }

  if (phase === "error") {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive">統計載入失敗:{error}</p>
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-muted-foreground">尚無學習紀錄。</p>
        <p className="text-sm text-muted-foreground">
          先到課程頁把單字加入複習,完成幾次複習後這裡就會有統計。
        </p>
        <Link href="/lessons" className={buttonVariants()}>
          前往課程
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">統計</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="單字"
          value={String(totals.words)}
          notes={[
            ...(totals.suspendedWords > 0 ? [`其中已會 ${totals.suspendedWords} 字`] : []),
            ...(hasReverse ? [`卡片 ${totals.cards} 張(含回想卡)`] : []),
          ]}
        />
        <StatTile label="今日已複習" value={String(todayCount)} />
        <StatTile label="整體留存率" value={formatPercent(retentionRate(logs))} />
        <StatTile
          label="近 30 天留存率"
          value={formatPercent(retentionRate(logs, { sinceDays: 30, now }))}
        />
      </div>

      <Section title="卡片階段分布">
        <p className="mb-2 text-xs text-muted-foreground">
          以卡片計{hasReverse && "(回想卡另計一張)"};學習中=最近一次評「重來」,已成熟=穩定度 ≥{" "}
          {MATURE_STABILITY} 天。
        </p>
        <StageBar counts={stages} />
      </Section>

      <Section title="複習熱力圖(過去 12 週)">
        <Heatmap data={daily} />
      </Section>

      <Section title="到期預測">
        <div className="mb-3 flex gap-1" role="group" aria-label="預測範圍">
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={forecastDays === days}
              onClick={() => setForecastDays(days)}
              className={buttonVariants({
                variant: forecastDays === days ? "default" : "secondary",
                size: "sm",
              })}
            >
              {days} 天
            </button>
          ))}
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={forecast} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={TICK}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} />
              <Tooltip
                formatter={(value) => [`${value} 張`, "到期"]}
                {...TOOLTIP}
                cursor={{ fill: "var(--color-muted)" }}
              />
              <Bar dataKey="count" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="留存率(12 週)">
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weekly} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={TICK}
                interval="preserveStartEnd"
              />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={TICK} unit="%" />
              <Tooltip
                formatter={(value) => [`${value}%`, "留存率"]}
                {...TOOLTIP}
                cursor={{ stroke: "var(--color-border)" }}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={SERIES}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES }}
                activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="各課進度">
        {/* 圖例用色塊而非「淺色/深色」字樣:深色模式下兩段的明暗關係相反 */}
        <p className="mb-2 text-xs text-muted-foreground">
          <ProgressSwatch cls={ADDED_CLS} /> 已加入複習,{" "}
          <ProgressSwatch cls={LEARNED_CLS} />{" "}
          已學會(已複習且最近一次不是「重來」,或標為已會);右側為已加入/單字總數。
        </p>
        <ul className="flex flex-col gap-2">
          {progress.map((lesson) => (
            <li key={lesson.lessonId} className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">
                L{lesson.lessonId}
              </span>
              <div className="min-w-0 flex-1">
                <div lang={jaLang(lesson.title)} className="truncate text-xs">
                  {lesson.title}
                </div>
                <div
                  className="relative mt-1 h-2 overflow-hidden rounded bg-muted"
                  title={`已加入 ${lesson.added}/${lesson.total},已學會 ${lesson.learned}`}
                >
                  <div
                    className={`absolute inset-y-0 left-0 rounded ${ADDED_CLS}`}
                    style={{ width: `${Math.min(100, (lesson.added / lesson.total) * 100)}%` }}
                  />
                  <div
                    className={`absolute inset-y-0 left-0 rounded ${LEARNED_CLS}`}
                    style={{ width: `${Math.min(100, (lesson.learned / lesson.total) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {lesson.added}/{lesson.total}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
