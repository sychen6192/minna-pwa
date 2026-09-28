import type { LessonIndex } from "@/schemas/lesson";
import { useTimeZone } from "@/test/timeZone";
import type { CardRow, LogRow } from "./db";
import {
  computeStreak,
  dailyReviewCounts,
  dueForecast,
  lessonProgress,
  lessonStatus,
  retentionRate,
  reviewsToday,
  stageDistribution,
  studySummary,
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

  it("以學習日分日(凌晨 4 點換日):23:59、翌日 00:01 與 03:59 同屬前一日,04:00 起屬當日", () => {
    const res = dailyReviewCounts(
      [
        log({ reviewedAt: new Date(2026, 6, 3, 23, 59).getTime() }),
        log({ reviewedAt: new Date(2026, 6, 4, 0, 1).getTime() }),
        log({ reviewedAt: new Date(2026, 6, 4, 3, 59).getTime() }),
        log({ reviewedAt: new Date(2026, 6, 4, 4, 0).getTime() }),
        log({ reviewedAt: new Date(2026, 6, 4, 8, 0).getTime() }),
      ],
      now,
      84,
    );
    const byDate = new Map(res.map((d) => [d.date, d.count]));

    expect(byDate.get("2026-07-03")).toBe(3);
    expect(byDate.get("2026-07-04")).toBe(2);
  });

  it("視窗外(過早或未來)的 log 不計", () => {
    const res = dailyReviewCounts(
      [
        log({ reviewedAt: new Date(2026, 3, 11, 12, 0).getTime() }), // 窗前一日
        log({ reviewedAt: new Date(2026, 3, 12, 3, 59).getTime() }), // 仍屬窗前一日(4/11)
        log({ reviewedAt: new Date(2026, 6, 5, 4, 1).getTime() }), // 未來(明日學習日)
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

  it("逾期卡與今日(學習日)稍晚到期的卡都歸入今日", () => {
    const res = dueForecast(
      [
        card({ due: now.getTime() - 5 * DAY }), // 逾期
        card({ due: new Date(2026, 6, 4, 23, 0).getTime() }), // 今晚
        card({ due: new Date(2026, 6, 5, 3, 0).getTime() }), // 翌日凌晨仍屬今日學習日
      ],
      now,
      7,
    );

    expect(res[0].count).toBe(3);
    expect(res[1].count).toBe(0);
  });

  it("未來到期按學習日分桶;超出視窗不計", () => {
    const cards = [
      card({ due: new Date(2026, 6, 8, 9, 0).getTime() }),
      card({ due: new Date(2026, 6, 11, 3, 0).getTime() }), // 凌晨 → 屬 7/10(第 7 天)
      card({ due: new Date(2026, 6, 11, 9, 0).getTime() }), // 第 8 天
    ];

    const week = dueForecast(cards, now, 7);
    expect(week.find((d) => d.date === "2026-07-08")?.count).toBe(1);
    expect(week.find((d) => d.date === "2026-07-10")?.count).toBe(1);
    expect(week.reduce((sum, d) => sum + d.count, 0)).toBe(2);

    const month = dueForecast(cards, now, 30);
    expect(month.find((d) => d.date === "2026-07-11")?.count).toBe(1);
  });

  it("New 卡(state 0)不列入到期預測(由 newPerDay 配額管理)", () => {
    const res = dueForecast([card({ state: 0 })], now, 7);

    expect(res[0].count).toBe(0);
  });

  it("暫停卡(已會)不列入到期預測(與 srs 到期判定一致)", () => {
    const res = dueForecast(
      [card({ due: now.getTime() - DAY, suspended: true })],
      now,
      7,
    );

    expect(res.every((d) => d.count === 0)).toBe(true);
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

  it("週界同樣以學習日換日:週一 03:00 屬上週日", () => {
    const res = weeklyRetention(
      [
        log({ rating: 1, reviewedAt: new Date(2026, 5, 29, 3, 0).getTime() }), // 週一凌晨 → 上週
        log({ rating: 3, reviewedAt: new Date(2026, 5, 29, 4, 0).getTime() }), // 週一 04:00 → 本週
      ],
      now,
      12,
    );

    expect(res[11]).toEqual({ weekStart: "2026-06-29", rate: 1 });
    expect(res[10]).toEqual({ weekStart: "2026-06-22", rate: 0 });
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

describe("studySummary", () => {
  const index: LessonIndex = {
    lessons: [
      { id: 1, title: "第一課", vocabCount: 10, grammarCount: 3 },
      { id: 2, title: "第二課", vocabCount: 5, grammarCount: 2 },
      { id: 3, title: "第三課", vocabCount: 8, grammarCount: 1 },
    ],
  };

  it("空卡:started 0、totalCards 0、totalLessons 為 index 課數", () => {
    expect(studySummary([], index)).toEqual({
      startedLessons: 0,
      totalLessons: 3,
      totalCards: 0,
    });
  });

  it("startedLessons = 至少 1 張卡的相異課數;totalCards = 卡片總數", () => {
    const cards = [
      card({ cardId: "L01-V001", lessonId: 1 }),
      card({ cardId: "L01-V002", lessonId: 1 }),
      card({ cardId: "L02-V001", lessonId: 2 }),
    ];

    expect(studySummary(cards, index)).toEqual({
      startedLessons: 2,
      totalLessons: 3,
      totalCards: 3,
    });
  });
});

describe("reviewsToday", () => {
  it("只計今日(學習日)的複習筆數", () => {
    const logs = [
      log({ reviewedAt: now.getTime() }),
      log({ reviewedAt: now.getTime() - 3 * 3600_000 }), // 今日稍早
      log({ reviewedAt: now.getTime() - DAY }), // 昨日
      log({ reviewedAt: new Date(2026, 6, 4, 3, 0).getTime() }), // 今天凌晨 03:00 → 屬昨日
    ];
    expect(reviewsToday(logs, now)).toBe(2);
    expect(reviewsToday([], now)).toBe(0);
  });

  it("凌晨 03:00 時,前一晚的複習仍算「今日」", () => {
    const lateNight = new Date(2026, 6, 5, 3, 0); // 仍屬 7/4 學習日
    const logs = [
      log({ reviewedAt: new Date(2026, 6, 4, 22, 0).getTime() }),
      log({ reviewedAt: new Date(2026, 6, 5, 2, 30).getTime() }),
      log({ reviewedAt: new Date(2026, 6, 4, 3, 59).getTime() }), // 7/3 學習日
    ];
    expect(reviewsToday(logs, lateNight)).toBe(2);
  });
});

describe("computeStreak", () => {
  it("無紀錄為 0", () => {
    expect(computeStreak([], now)).toBe(0);
  });

  it("今日 + 連續前幾日 → 累計天數", () => {
    const logs = [
      log({ reviewedAt: now.getTime() }),
      log({ reviewedAt: now.getTime() - DAY }),
      log({ reviewedAt: now.getTime() - 2 * DAY }),
    ];
    expect(computeStreak(logs, now)).toBe(3);
  });

  it("中斷即停止(缺前天則只算今日與昨日)", () => {
    const logs = [
      log({ reviewedAt: now.getTime() }),
      log({ reviewedAt: now.getTime() - DAY }),
      // 缺 -2 天
      log({ reviewedAt: now.getTime() - 3 * DAY }),
    ];
    expect(computeStreak(logs, now)).toBe(2);
  });

  it("今日尚未複習但昨日有 → 寬限,仍計昨日往前", () => {
    const logs = [
      log({ reviewedAt: now.getTime() - DAY }),
      log({ reviewedAt: now.getTime() - 2 * DAY }),
    ];
    expect(computeStreak(logs, now)).toBe(2);
  });

  it("最近一次在兩天前(今日與昨日皆無)→ 0", () => {
    const logs = [log({ reviewedAt: now.getTime() - 2 * DAY })];
    expect(computeStreak(logs, now)).toBe(0);
  });

  it("同一天多筆只算一天", () => {
    const logs = [
      log({ reviewedAt: now.getTime() }),
      log({ reviewedAt: now.getTime() - 3600_000 }),
      log({ reviewedAt: now.getTime() - DAY }),
    ];
    expect(computeStreak(logs, now)).toBe(2);
  });

  it("凌晨 03:00 的複習算前一天:接續 streak", () => {
    const logs = [
      log({ reviewedAt: new Date(2026, 6, 2, 12, 0).getTime() }), // 7/2
      log({ reviewedAt: new Date(2026, 6, 4, 3, 0).getTime() }), // 7/4 03:00 → 7/3
    ];
    // 今日(7/4)未複習 → 寬限從昨日(7/3)起算:7/3、7/2 連續
    expect(computeStreak(logs, now)).toBe(2);
    // 凌晨 03:00 查看時,「今日」仍是 7/3
    expect(computeStreak(logs, new Date(2026, 6, 4, 3, 30))).toBe(2);
  });
});

describe("lessonStatus", () => {
  const p = (added: number, learned: number, total = 5) => ({
    lessonId: 1,
    title: "課",
    total,
    added,
    learned,
  });

  it("未加入任何卡 → not-started", () => {
    expect(lessonStatus(p(0, 0))).toBe("not-started");
  });

  it("已加入但未全部學會 → in-progress", () => {
    expect(lessonStatus(p(3, 1))).toBe("in-progress");
    expect(lessonStatus(p(5, 4))).toBe("in-progress"); // 差一張
  });

  it("全部單字皆已學會(learned = total)→ done", () => {
    expect(lessonStatus(p(5, 5))).toBe("done");
  });

  it("total 為 0 的防禦:不誤判為 done", () => {
    expect(lessonStatus(p(0, 0, 0))).toBe("not-started");
  });
});

describe("stageDistribution", () => {
  it("依 state 與 stability 分桶;suspended 優先", () => {
    const cards = [
      card({ state: 0 }), // new
      card({ state: 1 }), // learning
      card({ state: 3 }), // relearning → learning
      card({ state: 2, stability: 5 }), // young
      card({ state: 2, stability: 21 }), // mature(門檻值)
      card({ state: 2, stability: 100 }), // mature
      card({ state: 2, stability: 100, suspended: true }), // suspended 優先
    ];
    expect(stageDistribution(cards)).toEqual({
      new: 1,
      learning: 2,
      young: 1,
      mature: 2,
      suspended: 1,
    });
  });

  it("空集合全為 0", () => {
    expect(stageDistribution([])).toEqual({
      new: 0,
      learning: 0,
      young: 0,
      mature: 0,
      suspended: 0,
    });
  });
});

describe("學習日分日跨 DST(America/New_York,2026-03-08)", () => {
  useTimeZone("America/New_York");

  /** 2026-03-dd hh:mm(紐約時間)。須在測試內呼叫。 */
  const at = (d: number, h: number, mi = 0) => new Date(2026, 2, d, h, mi).getTime();

  it("dailyReviewCounts:23 小時的 3/7 學習日仍以 04:00 為界,日期鍵連續", () => {
    const res = dailyReviewCounts(
      [
        log({ reviewedAt: at(8, 3, 30) }), // EDT 03:30 → 3/7
        log({ reviewedAt: at(8, 4, 0) }), // → 3/8
        log({ reviewedAt: at(8, 23, 0) }),
        log({ reviewedAt: at(9, 3, 0) }), // → 3/8
      ],
      new Date(at(9, 12)),
      7,
    );

    expect(res.map((d) => d.date)).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
    expect(res.slice(-3).map((d) => d.count)).toEqual([1, 3, 0]);
  });

  it("dueForecast:DST 當晚凌晨到期仍屬今日,之後按學習日分桶", () => {
    const res = dueForecast(
      [
        card({ due: at(8, 3, 30) }), // 3/7 學習日
        card({ due: at(9, 4, 0) }),
      ],
      new Date(at(7, 12)),
      3,
    );

    expect(res).toEqual([
      { date: "2026-03-07", count: 1 },
      { date: "2026-03-08", count: 0 },
      { date: "2026-03-09", count: 1 },
    ]);
  });

  it("reviewsToday / computeStreak:跨 DST 仍以學習日計", () => {
    const logs = [
      log({ reviewedAt: at(7, 12) }),
      log({ reviewedAt: at(9, 3, 0) }), // → 3/8
    ];
    expect(reviewsToday(logs, new Date(at(9, 3, 30)))).toBe(1); // 今日 = 3/8
    expect(reviewsToday(logs, new Date(at(9, 12)))).toBe(0);
    expect(computeStreak(logs, new Date(at(9, 12)))).toBe(2); // 寬限:3/8、3/7
    const withToday = [...logs, log({ reviewedAt: at(9, 4, 10) })];
    expect(computeStreak(withToday, new Date(at(9, 12)))).toBe(3);
  });

  it("weeklyRetention:週一(3/9)03:00 屬上週,04:00 起屬本週", () => {
    const res = weeklyRetention(
      [
        log({ rating: 1, reviewedAt: at(9, 3, 0) }),
        log({ rating: 3, reviewedAt: at(9, 4, 0) }),
      ],
      new Date(at(10, 12)),
      2,
    );

    expect(res).toEqual([
      { weekStart: "2026-03-02", rate: 0 },
      { weekStart: "2026-03-09", rate: 1 },
    ]);
  });
});
