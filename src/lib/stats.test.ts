import type { LessonIndex } from "@/schemas/lesson";
import type { CardRow, LogRow } from "./db";
import {
  dailyReviewCounts,
  dueForecast,
  lessonProgress,
  retentionRate,
  weeklyRetention,
} from "./stats";

const DAY = 86_400_000;

// 固定基準:2026-07-04(六)12:00,本地時區
const now = new Date(2026, 6, 4, 12, 0, 0);

function log(overrides: Partial<LogRow> = {}): LogRow {
  return {
    cardId: "L01-V001",
    rating: 3,
    state: 2,
    due: now.getTime(),
    elapsedDays: 1,
    reviewedAt: now.getTime(),
    ...overrides,
  };
}

function card(overrides: Partial<CardRow> = {}): CardRow {
  return {
    cardId: "L01-V001",
    lessonId: 1,
    type: "vocab",
    due: now.getTime(),
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 2,
    ...overrides,
  };
}

describe("dailyReviewCounts", () => {
  it("zero-fill 整個視窗:84 天、首日與末日正確", () => {
    const res = dailyReviewCounts([], now, 84);

    expect(res).toHaveLength(84);
    expect(res[0]).toEqual({ date: "2026-04-12", count: 0 });
    expect(res[83]).toEqual({ date: "2026-07-04", count: 0 });
  });

  it("以本地時區分日:同日累計,23:59 與翌日 00:01 分屬兩日", () => {
    const res = dailyReviewCounts(
      [
        log({ reviewedAt: new Date(2026, 6, 3, 23, 59).getTime() }),
        log({ reviewedAt: new Date(2026, 6, 4, 0, 1).getTime() }),
        log({ reviewedAt: new Date(2026, 6, 4, 8, 0).getTime() }),
      ],
      now,
      84,
    );
    const byDate = new Map(res.map((d) => [d.date, d.count]));

    expect(byDate.get("2026-07-03")).toBe(1);
    expect(byDate.get("2026-07-04")).toBe(2);
  });

  it("視窗外(過早或未來)的 log 不計", () => {
    const res = dailyReviewCounts(
      [
        log({ reviewedAt: new Date(2026, 3, 11, 12, 0).getTime() }), // 窗前一日
        log({ reviewedAt: new Date(2026, 6, 5, 0, 1).getTime() }), // 未來
      ],
      now,
      84,
    );

    expect(res.every((d) => d.count === 0)).toBe(true);
  });
});

describe("dueForecast", () => {
  it("zero-fill:7 天視窗自今日起", () => {
    const res = dueForecast([], now, 7);

    expect(res).toHaveLength(7);
    expect(res[0]).toEqual({ date: "2026-07-04", count: 0 });
    expect(res[6]).toEqual({ date: "2026-07-10", count: 0 });
  });

  it("逾期卡與今日稍晚到期的卡都歸入今日", () => {
    const res = dueForecast(
      [
        card({ due: now.getTime() - 5 * DAY }), // 逾期
        card({ due: new Date(2026, 6, 4, 23, 0).getTime() }), // 今晚
      ],
      now,
      7,
    );

    expect(res[0].count).toBe(2);
  });

  it("未來到期按本地日分桶;超出視窗不計", () => {
    const cards = [
      card({ due: new Date(2026, 6, 8, 9, 0).getTime() }),
      card({ due: new Date(2026, 6, 11, 9, 0).getTime() }), // 第 8 天
    ];

    const week = dueForecast(cards, now, 7);
    expect(week.find((d) => d.date === "2026-07-08")?.count).toBe(1);
    expect(week.reduce((sum, d) => sum + d.count, 0)).toBe(1);

    const month = dueForecast(cards, now, 30);
    expect(month.find((d) => d.date === "2026-07-11")?.count).toBe(1);
  });

  it("New 卡(state 0)不列入到期預測(由 newPerDay 配額管理)", () => {
    const res = dueForecast([card({ state: 0 })], now, 7);

    expect(res[0].count).toBe(0);
  });
});

describe("retentionRate", () => {
  it("整體:Review 狀態評分中非 Again 佔比", () => {
    const logs = [
      log({ rating: 1 }),
      log({ rating: 3 }),
      log({ rating: 3 }),
      log({ rating: 4 }),
    ];

    expect(retentionRate(logs)).toBeCloseTo(0.75);
  });

  it("只計 state === 2 的 log(Learning / Relearning 不算留存)", () => {
    const logs = [
      log({ rating: 3 }),
      log({ rating: 1, state: 1 }),
      log({ rating: 1, state: 3 }),
    ];

    expect(retentionRate(logs)).toBe(1);
  });

  it("sinceDays 視窗:窗外 log 排除", () => {
    const logs = [
      log({ rating: 1, reviewedAt: now.getTime() - 40 * DAY }),
      log({ rating: 3, reviewedAt: now.getTime() - 5 * DAY }),
    ];

    expect(retentionRate(logs, { sinceDays: 30, now })).toBe(1);
    expect(retentionRate(logs)).toBeCloseTo(0.5);
  });

  it("無可計資料回 null", () => {
    expect(retentionRate([])).toBeNull();
    expect(retentionRate([log({ state: 1 })])).toBeNull();
  });
});

describe("weeklyRetention", () => {
  it("12 週分桶,weekStart 為週一;本週與空週", () => {
    const res = weeklyRetention(
      [
        log({ rating: 3, reviewedAt: new Date(2026, 5, 30, 10, 0).getTime() }), // 本週二
        log({ rating: 1, reviewedAt: new Date(2026, 5, 29, 10, 0).getTime() }), // 本週一
      ],
      now,
      12,
    );

    expect(res).toHaveLength(12);
    expect(res[11]).toEqual({ weekStart: "2026-06-29", rate: 0.5 });
    expect(res[10]).toEqual({ weekStart: "2026-06-22", rate: null }); // 無資料週
    expect(res[0].weekStart).toBe("2026-04-13"); // 12 週前的週一
  });
});

describe("lessonProgress", () => {
  const index: LessonIndex = {
    lessons: [
      { id: 1, title: "第一課", vocabCount: 10, grammarCount: 3 },
      { id: 2, title: "第二課", vocabCount: 5, grammarCount: 2 },
    ],
  };

  it("join index:added / learned(state===2)計數;無卡課為 0", () => {
    const cards = [
      card({ cardId: "L01-V001", lessonId: 1, state: 2 }),
      card({ cardId: "L01-V002", lessonId: 1, state: 2 }),
      card({ cardId: "L01-V003", lessonId: 1, state: 0 }),
    ];

    expect(lessonProgress(cards, index)).toEqual([
      { lessonId: 1, title: "第一課", total: 10, added: 3, learned: 2 },
      { lessonId: 2, title: "第二課", total: 5, added: 0, learned: 0 },
    ]);
  });
});
