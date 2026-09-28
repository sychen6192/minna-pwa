import type { LessonIndex } from "@/schemas/lesson";
import type { CardRow, LogRow } from "./db";
import {
  addStudyDays,
  nextStudyDayStart,
  studyDayKey,
  studyDayStart,
} from "./studyDay";

// 統計聚合(SPEC F5)。全部純函式:頁面撈 rows 進來,這裡不碰 DB。
// 分日/分週一律以「學習日」為準(DATA_MODEL §4-5:本地時區凌晨 4 點換日,studyDay.ts)。

export interface DayCount {
  date: string; // YYYY-MM-DD(學習日)
  count: number;
}

export interface WeekRate {
  weekStart: string; // 該週週一 YYYY-MM-DD(學習日)
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

export interface GoalProgress {
  goal: number; // 有效目標張數
  met: boolean; // 已達標
  cleared: boolean; // 未達設定目標,但今日佇列已清空而視為達標
}

export interface StageCounts {
  new: number; // state New
  learning: number; // state Learning / Relearning
  young: number; // Review 但未成熟(stability < MATURE_STABILITY)
  mature: number; // Review 且已成熟
  suspended: number; // 已會/暫停(不論 state)
}

/** 成熟門檻(天):對標 Anki 的 mature 定義(interval ≥ 21 天)。 */
export const MATURE_STABILITY = 21;

/** 該學習日所屬週的週一(學習日起點,epoch ms) */
function studyWeekStart(ms: number): number {
  const weekday = new Date(studyDayStart(ms)).getDay(); // 0 = 週日
  return addStudyDays(ms, -((weekday + 6) % 7));
}

/** 過去 days 個學習日(含今日)的每日複習量,zero-fill 全視窗 */
export function dailyReviewCounts(logs: LogRow[], now: Date, days = 84): DayCount[] {
  const result: DayCount[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const key = studyDayKey(addStudyDays(now.getTime(), -i));
    indexByDate.set(key, result.length);
    result.push({ date: key, count: 0 });
  }
  for (const entry of logs) {
    const idx = indexByDate.get(studyDayKey(entry.reviewedAt));
    if (idx !== undefined) result[idx].count++;
  }
  return result;
}

/**
 * 未來 days 個學習日(含今日)的到期卡量;今日學習日結束前到期者(含逾期)歸入今日,
 * 與 srs 的到期判定一致;New 卡(由 newPerDay 配額管理)與暫停卡不列入
 */
export function dueForecast(cards: CardRow[], now: Date, days: number): DayCount[] {
  const result: DayCount[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const key = studyDayKey(addStudyDays(now.getTime(), i));
    indexByDate.set(key, result.length);
    result.push({ date: key, count: 0 });
  }
  const todayKey = studyDayKey(now.getTime());
  const todayEnd = nextStudyDayStart(now.getTime());
  for (const c of cards) {
    if (c.state === 0 || c.suspended) continue;
    const key = c.due < todayEnd ? todayKey : studyDayKey(c.due);
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

/** 過去 weeks 週(含本週)的週別留存率,weekStart 為週一(週界同樣以學習日換日) */
export function weeklyRetention(logs: LogRow[], now: Date, weeks = 12): WeekRate[] {
  const thisMonday = studyWeekStart(now.getTime());
  const buckets = new Map<string, { total: number; kept: number }>();
  const order: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const key = studyDayKey(addStudyDays(thisMonday, -7 * i));
    order.push(key);
    buckets.set(key, { total: 0, kept: 0 });
  }
  for (const entry of logs) {
    if (entry.state !== 2) continue;
    const bucket = buckets.get(studyDayKey(studyWeekStart(entry.reviewedAt)));
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

/**
 * SRS 階段分布:新卡 / 學習中 / 未成熟 / 已成熟 / 已暫停。
 * 已暫停者不論 state 一律歸入 suspended。
 */
export function stageDistribution(cards: CardRow[]): StageCounts {
  const counts: StageCounts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  for (const card of cards) {
    if (card.suspended) counts.suspended++;
    else if (card.state === 0) counts.new++;
    else if (card.state === 1 || card.state === 3) counts.learning++;
    else if (card.stability >= MATURE_STABILITY) counts.mature++;
    else counts.young++;
  }
  return counts;
}

/** 今日(學習日,凌晨 4 點換日)已複習筆數。 */
export function reviewsToday(logs: LogRow[], now: Date): number {
  const key = studyDayKey(now.getTime());
  return logs.filter((l) => studyDayKey(l.reviewedAt) === key).length;
}

/**
 * 今日目標:有效目標 = min(dailyGoal, 今日已複習 + 今日佇列剩餘),不要求佇列做不到的張數
 * (新卡/複習有每日上限)。佇列清空(剩餘 0)且今日已複習 > 0 即達標。
 * 今日無卡可做且尚未複習時維持設定目標。
 */
export function effectiveGoal(
  dailyGoal: number,
  todayCount: number,
  remaining: number,
): GoalProgress {
  const available = todayCount + remaining;
  const goal = available > 0 ? Math.min(dailyGoal, available) : dailyGoal;
  const met = todayCount >= goal;
  return { goal, met, cleared: met && todayCount < dailyGoal };
}

/**
 * 連續學習天數(以學習日計):從今天(若今日已複習)或昨天(今日尚未複習的寬限)往回,
 * 連續每天都有 ≥1 筆複習紀錄的天數。今日與昨日皆無紀錄則為 0。
 */
export function computeStreak(logs: LogRow[], now: Date): number {
  const days = new Set(logs.map((l) => studyDayKey(l.reviewedAt)));
  if (days.size === 0) return 0;

  const today = now.getTime();
  let anchor = studyDayStart(today);
  if (!days.has(studyDayKey(anchor))) {
    anchor = addStudyDays(today, -1); // 今日未複習 → 從昨日起算(寬限)
    if (!days.has(studyDayKey(anchor))) return 0;
  }

  let streak = 0;
  for (let d = anchor; days.has(studyDayKey(d)); d = addStudyDays(d, -1)) {
    streak++;
  }
  return streak;
}
