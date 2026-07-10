import type { LessonIndex } from "@/schemas/lesson";
import type { CardRow, LogRow } from "./db";

// 統計聚合(SPEC F5)。全部純函式:頁面撈 rows 進來,這裡不碰 DB。
// 分日/分週一律以「本地時區」為準(DATA_MODEL §4:儲存 epoch ms,顯示層轉時區)。

export interface DayCount {
  date: string; // YYYY-MM-DD(本地時區)
  count: number;
}

export interface WeekRate {
  weekStart: string; // 該週週一 YYYY-MM-DD(本地時區)
  rate: number | null; // 無資料週為 null
}

export interface LessonProgress {
  lessonId: number;
  title: string;
  total: number; // 該課單字總數(index.json)
  added: number; // 已加入複習的卡數
  learned: number; // 已進入 Review 狀態(state === 2)的卡數
}

export interface StudySummary {
  startedLessons: number; // 至少加入 1 張卡的相異課數
  totalLessons: number; // index 總課數
  totalCards: number; // 已加入的卡片總數
}

export type LessonStatus = "not-started" | "in-progress" | "done";

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 以日期欄位加減天數(而非 ms 運算),跨 DST 安全 */
function shiftDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** 該日所屬週的週一 */
function mondayOf(date: Date): Date {
  return shiftDays(date, -((date.getDay() + 6) % 7));
}

/** 過去 days 天(含今日)的每日複習量,zero-fill 全視窗 */
export function dailyReviewCounts(logs: LogRow[], now: Date, days = 84): DayCount[] {
  const result: DayCount[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const key = localDateKey(shiftDays(now, -i));
    indexByDate.set(key, result.length);
    result.push({ date: key, count: 0 });
  }
  for (const entry of logs) {
    const idx = indexByDate.get(localDateKey(new Date(entry.reviewedAt)));
    if (idx !== undefined) result[idx].count++;
  }
  return result;
}

/** 未來 days 天(含今日)的到期卡量;逾期歸入今日;New 卡不列入(由 newPerDay 配額管理) */
export function dueForecast(cards: CardRow[], now: Date, days: number): DayCount[] {
  const result: DayCount[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const key = localDateKey(shiftDays(now, i));
    indexByDate.set(key, result.length);
    result.push({ date: key, count: 0 });
  }
  const todayKey = localDateKey(now);
  for (const c of cards) {
    if (c.state === 0) continue;
    const key = c.due <= now.getTime() ? todayKey : localDateKey(new Date(c.due));
    const idx = indexByDate.get(key);
    if (idx !== undefined) result[idx].count++;
  }
  return result;
}

/** 留存率:Review 狀態(state === 2)評分中非 Again(rating > 1)的佔比;無資料回 null */
export function retentionRate(
  logs: LogRow[],
  options?: { sinceDays: number; now: Date },
): number | null {
  const cutoff = options ? options.now.getTime() - options.sinceDays * 86_400_000 : undefined;
  let total = 0;
  let kept = 0;
  for (const entry of logs) {
    if (entry.state !== 2) continue;
    if (cutoff !== undefined && entry.reviewedAt < cutoff) continue;
    total++;
    if (entry.rating > 1) kept++;
  }
  return total === 0 ? null : kept / total;
}

/** 過去 weeks 週(含本週)的週別留存率,weekStart 為週一 */
export function weeklyRetention(logs: LogRow[], now: Date, weeks = 12): WeekRate[] {
  const thisMonday = mondayOf(now);
  const buckets = new Map<string, { total: number; kept: number }>();
  const order: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const key = localDateKey(shiftDays(thisMonday, -7 * i));
    order.push(key);
    buckets.set(key, { total: 0, kept: 0 });
  }
  for (const entry of logs) {
    if (entry.state !== 2) continue;
    const bucket = buckets.get(localDateKey(mondayOf(new Date(entry.reviewedAt))));
    if (!bucket) continue;
    bucket.total++;
    if (entry.rating > 1) bucket.kept++;
  }
  return order.map((weekStart) => {
    const { total, kept } = buckets.get(weekStart) as { total: number; kept: number };
    return { weekStart, rate: total === 0 ? null : kept / total };
  });
}

/** 各課進度:index 全課列出,join 卡片計數 */
export function lessonProgress(cards: CardRow[], index: LessonIndex): LessonProgress[] {
  const added = new Map<number, number>();
  const learned = new Map<number, number>();
  // 只計正向卡:進度以「相異單字」為準,義→日回想卡(direction rev)不重複計
  for (const c of cards) {
    if ((c.direction ?? "fwd") !== "fwd") continue;
    added.set(c.lessonId, (added.get(c.lessonId) ?? 0) + 1);
    if (c.state === 2) learned.set(c.lessonId, (learned.get(c.lessonId) ?? 0) + 1);
  }
  return index.lessons.map((lesson) => ({
    lessonId: lesson.id,
    title: lesson.title,
    total: lesson.vocabCount,
    added: added.get(lesson.id) ?? 0,
    learned: learned.get(lesson.id) ?? 0,
  }));
}

/**
 * 課程學習狀態:未開始(未加入任何卡)/ 已完成(全部單字皆已學會,state=Review)/
 * 進行中(其餘)。
 */
export function lessonStatus(p: LessonProgress): LessonStatus {
  if (p.added === 0) return "not-started";
  if (p.total > 0 && p.learned >= p.total) return "done";
  return "in-progress";
}

/** 首頁儀表板摘要:已開始課數、總課數、累計卡片數。 */
export function studySummary(cards: CardRow[], index: LessonIndex): StudySummary {
  // 只計正向卡(相異單字):累計卡片與已開始課數不因雙向卡而膨脹
  const fwd = cards.filter((c) => (c.direction ?? "fwd") === "fwd");
  const startedIds = new Set<number>();
  for (const c of fwd) startedIds.add(c.lessonId);
  return {
    startedLessons: startedIds.size,
    totalLessons: index.lessons.length,
    totalCards: fwd.length,
  };
}

/** 今日(本地時區)已複習張數。 */
export function reviewsToday(logs: LogRow[], now: Date): number {
  const key = localDateKey(now);
  return logs.filter((l) => localDateKey(new Date(l.reviewedAt)) === key).length;
}

/**
 * 連續學習天數:從今天(若今日已複習)或昨天(今日尚未複習的寬限)往回,
 * 連續每天都有 ≥1 筆複習紀錄的天數。今日與昨日皆無紀錄則為 0。
 */
export function computeStreak(logs: LogRow[], now: Date): number {
  const days = new Set(logs.map((l) => localDateKey(new Date(l.reviewedAt))));
  if (days.size === 0) return 0;

  let anchor = shiftDays(now, 0); // 今日 00:00(本地)
  if (!days.has(localDateKey(anchor))) {
    anchor = shiftDays(now, -1); // 今日未複習 → 從昨日起算(寬限)
    if (!days.has(localDateKey(anchor))) return 0;
  }

  let streak = 0;
  for (let d = anchor; days.has(localDateKey(d)); d = shiftDays(d, -1)) {
    streak++;
  }
  return streak;
}
