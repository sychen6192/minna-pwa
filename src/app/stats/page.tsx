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
import { getLessonIndex } from "@/lib/content";
import { db, type CardRow, type LogRow } from "@/lib/db";
import {
  dailyReviewCounts,
  dueForecast,
  lessonProgress,
  retentionRate,
  weeklyRetention,
} from "@/lib/stats";
import type { LessonIndex } from "@/schemas/lesson";

type Phase = "loading" | "empty" | "ready" | "error";

const ACCENT = "#0284c7"; // sky-600,與全站 accent 一致(單一系列,單色相)
const GRID = "#e5e5e5"; // neutral-200,格線後退

/** "YYYY-MM-DD" → "M/D"(圖表刻度用) */
function shortDate(key: string): string {
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
}

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-medium text-neutral-900">{title}</h2>
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
  const progress = useMemo(
    () => (index ? lessonProgress(cards, index) : []),
    [cards, index],
  );
  const todayCount = daily.length ? daily[daily.length - 1].count : 0;

  if (phase === "loading") {
    return <p className="p-6 text-center text-sm text-neutral-500">載入中…</p>;
  }

  if (phase === "error") {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-red-600">統計載入失敗:{error}</p>
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-neutral-600">尚無學習紀錄。</p>
        <p className="text-sm text-neutral-500">
          先到課程頁把單字加入複習,完成幾次複習後這裡就會有統計。
        </p>
        <Link
          href="/lessons"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          前往課程
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">統計</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="總卡數" value={String(cards.length)} />
        <StatTile label="今日已複習" value={String(todayCount)} />
        <StatTile label="整體留存率" value={formatPercent(retentionRate(logs))} />
        <StatTile
          label="近 30 天留存率"
          value={formatPercent(retentionRate(logs, { sinceDays: 30, now }))}
        />
      </div>

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
              className={`rounded px-3 py-1 text-xs font-medium ${
                forecastDays === days
                  ? "bg-sky-600 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
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
                tick={{ fontSize: 10, fill: "#737373" }}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "#737373" }}
              />
              <Tooltip
                formatter={(value) => [`${value} 張`, "到期"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="count" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={18} />
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
                tick={{ fontSize: 10, fill: "#737373" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "#737373" }}
                unit="%"
              />
              <Tooltip
                formatter={(value) => [`${value}%`, "留存率"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={ACCENT}
                strokeWidth={2}
                dot={{ r: 3, fill: ACCENT }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="各課進度">
        <p className="mb-2 text-xs text-neutral-500">
          淺色=已加入複習,深色=已學會(進入長期複習);右側為 已加入/單字總數。
        </p>
        <ul className="flex flex-col gap-2">
          {progress.map((lesson) => (
            <li key={lesson.lessonId} className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-xs text-neutral-500">
                L{lesson.lessonId}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-neutral-700">{lesson.title}</div>
                <div
                  className="relative mt-1 h-2 overflow-hidden rounded bg-neutral-100"
                  title={`已加入 ${lesson.added}/${lesson.total},已學會 ${lesson.learned}`}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-sky-200"
                    style={{ width: `${Math.min(100, (lesson.added / lesson.total) * 100)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-sky-600"
                    style={{ width: `${Math.min(100, (lesson.learned / lesson.total) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                {lesson.added}/{lesson.total}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
