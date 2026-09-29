import type { LessonIndex } from "@/schemas/lesson";
import { useTimeZone } from "@/test/timeZone";
import type { CardRow, LogRow } from "./db";
import {
  cardTotals,
  computeStreak,
  dailyReviewCounts,
  dueForecast,
  effectiveGoal,
  lastRatingByCard,
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
      { lessonId: 1, title: "第一課", total: 10, added: 3, learned: 2, supplementaryAdded: 0 },
      { lessonId: 2, title: "第二課", total: 5, added: 0, learned: 0, supplementaryAdded: 0 },
    ]);
  });

  it("補充單字不計入進度(T10.11):整課加入不含補充單字也能完成;單字加入的補充單字不影響", () => {
    // 第二課 5 字,其中 L02-V004、L02-V005 為補充單字
    const supplementary = new Map([[2, new Set(["L02-V004", "L02-V005"])]]);
    const core = ["L02-V001", "L02-V002", "L02-V003"].map((cardId) =>
      card({ cardId, lessonId: 2, state: 2 }),
    );

    const [l1, l2] = lessonProgress(core, index, new Map(), supplementary);
    expect(l2).toMatchObject({ total: 3, added: 3, learned: 3, supplementaryAdded: 0 });
    expect(lessonStatus(l2)).toBe("done");
    expect(l1.total).toBe(10); // 未列出的課照 index 總數

    // 不傳 supplementary(舊行為):5 字只學會 3 → 進行中
    expect(lessonStatus(lessonProgress(core, index)[1])).toBe("in-progress");

    // 補充單字單字加入(新卡、尚未學會):不拉低進度,仍為已完成
    const withExtra = [...core, card({ cardId: "L02-V004", lessonId: 2, state: 0 })];
    const [, l2b] = lessonProgress(withExtra, index, new Map(), supplementary);
    expect(l2b).toMatchObject({ total: 3, added: 3, learned: 3, supplementaryAdded: 1 });
    expect(lessonStatus(l2b)).toBe("done");

    // 核心字未學完時,已學會的補充單字不能補足
    const partial = [
      card({ cardId: "L02-V001", lessonId: 2, state: 2 }),
      card({ cardId: "L02-V002", lessonId: 2, state: 2 }),
      card({ cardId: "L02-V004", lessonId: 2, state: 2 }),
      card({ cardId: "L02-V005", lessonId: 2, state: 2 }),
    ];
    const [, l2c] = lessonProgress(partial, index, new Map(), supplementary);
    expect(l2c).toMatchObject({ total: 3, added: 2, learned: 2, supplementaryAdded: 2 });
    expect(lessonStatus(l2c)).toBe("in-progress");
  });

  it("只單字加入補充單字的課:不計進度但已開始(進行中)", () => {
    const supplementary = new Map([[2, new Set(["L02-V005"])]]);
    const cards = [card({ cardId: "L02-V005", lessonId: 2, state: 2 })];
    const [, l2] = lessonProgress(cards, index, new Map(), supplementary);
    expect(l2).toMatchObject({ total: 4, added: 0, learned: 0, supplementaryAdded: 1 });
    expect(lessonStatus(l2)).toBe("in-progress");
  });

  it("已會(暫停)的字計為已學會,不論 state:標為已會的新卡也能讓該課完成", () => {
    const cards = [
      card({ cardId: "L02-V001", lessonId: 2, state: 0, suspended: true }), // 已會的新卡
      card({ cardId: "L02-V002", lessonId: 2, state: 2, suspended: true }),
      card({ cardId: "L02-V003", lessonId: 2, state: 2 }),
      card({ cardId: "L02-V004", lessonId: 2, state: 2 }),
      card({ cardId: "L02-V005", lessonId: 2, state: 2 }),
    ];

    const [, l2] = lessonProgress(cards, index);
    expect(l2).toMatchObject({ added: 5, learned: 5 });
    expect(lessonStatus(l2)).toBe("done");
  });

  it("已會以字為單位:只有回想卡暫停(T10.3 前的舊資料)也算該字已會;回想卡不計入 added", () => {
    const cards = [
      card({ cardId: "L02-V001", lessonId: 2, state: 0 }),
      card({ cardId: "L02-V001@r", lessonId: 2, direction: "rev", state: 0, suspended: true }),
      card({ cardId: "L02-V002", lessonId: 2, state: 0 }),
      card({ cardId: "L02-V002@r", lessonId: 2, direction: "rev", state: 2 }),
    ];

    const [, l2] = lessonProgress(cards, index);
    expect(l2).toMatchObject({ added: 2, learned: 1 });
  });

  it("最後一次評分為「重來」的卡不算已學會;之後答對即恢復", () => {
    const cards = [
      card({ cardId: "L02-V001", lessonId: 2, state: 2 }), // 只答過重來(首評 Again 後仍為 Review)
      card({ cardId: "L02-V002", lessonId: 2, state: 2 }), // 重來後又答對
      card({ cardId: "L02-V003", lessonId: 2, state: 2 }), // 無紀錄(匯入資料):依 state
    ];
    const logs = [
      log({ cardId: "L02-V001", rating: 1, state: 0, reviewedAt: now.getTime() - DAY }),
      log({ cardId: "L02-V002", rating: 1, state: 0, reviewedAt: now.getTime() - 2 * DAY }),
      log({ cardId: "L02-V002", rating: 3, state: 2, reviewedAt: now.getTime() - DAY }),
    ];

    const [, l2] = lessonProgress(cards, index, lastRatingByCard(logs));
    expect(l2).toMatchObject({ added: 3, learned: 2 });

    // 整課只答過重來:仍為進行中(修正前會顯示已完成)
    const allAgain = [
      card({ cardId: "L01-V001", lessonId: 1, state: 2 }),
      card({ cardId: "L01-V002", lessonId: 1, state: 2 }),
    ];
    const againLogs = allAgain.map((c) => log({ cardId: c.cardId, rating: 1, state: 0 }));
    const small: LessonIndex = {
      lessons: [{ id: 1, title: "第一課", vocabCount: 2, grammarCount: 0 }],
    };
    const [l1] = lessonProgress(allAgain, small, lastRatingByCard(againLogs));
    expect(l1.learned).toBe(0);
    expect(lessonStatus(l1)).toBe("in-progress");
  });

  it("已會的字即使最後一次評「重來」仍計為已學會", () => {
    const cards = [card({ cardId: "L02-V001", lessonId: 2, state: 2, suspended: true })];
    const logs = [log({ cardId: "L02-V001", rating: 1 })];

    const [, l2] = lessonProgress(cards, index, lastRatingByCard(logs));
    expect(l2.learned).toBe(1);
  });
});

describe("lastRatingByCard", () => {
  it("每張卡取 reviewedAt 最新的一筆評分,與陣列順序無關", () => {
    const logs = [
      log({ cardId: "a", rating: 3, reviewedAt: 300 }),
      log({ cardId: "a", rating: 1, reviewedAt: 100 }), // 較早,即使排在後面也不採用
      log({ cardId: "b", rating: 1, reviewedAt: 200 }),
      log({ cardId: "b", rating: 4, reviewedAt: 150 }),
    ];

    expect(lastRatingByCard(logs)).toEqual(
      new Map([
        ["a", 3],
        ["b", 1],
      ]),
    );
  });

  it("同一時刻多筆:取較晚寫入(陣列中較後)者;無紀錄為空 map", () => {
    const logs = [
      log({ cardId: "a", rating: 3, reviewedAt: 100 }),
      log({ cardId: "a", rating: 1, reviewedAt: 100 }),
    ];

    expect(lastRatingByCard(logs).get("a")).toBe(1);
    expect(lastRatingByCard([]).size).toBe(0);
  });
});

describe("cardTotals", () => {
  it("單字 = 正向卡數;卡片含回想卡;已會以字計(任一方向暫停,雙向不重複)", () => {
    const cards = [
      card({ cardId: "L01-V001" }),
      card({ cardId: "L01-V001@r", direction: "rev" }),
      card({ cardId: "L01-V002", suspended: true }),
      card({ cardId: "L01-V002@r", direction: "rev", suspended: true }),
      card({ cardId: "L01-V003" }),
      card({ cardId: "L01-V003@r", direction: "rev", suspended: true }), // 舊資料:只暫停 @r
    ];

    expect(cardTotals(cards)).toEqual({ words: 3, cards: 6, suspendedWords: 2 });
    expect(cardTotals([])).toEqual({ words: 0, cards: 0, suspendedWords: 0 });
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

  it("空卡:started 0、totalWords 0、totalLessons 為 index 課數", () => {
    expect(studySummary([], index)).toEqual({
      startedLessons: 0,
      totalLessons: 3,
      totalWords: 0,
    });
  });

  it("startedLessons = 至少 1 張卡的相異課數;totalWords = 正向卡數(回想卡不重複計)", () => {
    const cards = [
      card({ cardId: "L01-V001", lessonId: 1 }),
      card({ cardId: "L01-V001@r", lessonId: 1, direction: "rev" }),
      card({ cardId: "L01-V002", lessonId: 1 }),
      card({ cardId: "L02-V001", lessonId: 2 }),
    ];

    expect(studySummary(cards, index)).toEqual({
      startedLessons: 2,
      totalLessons: 3,
      totalWords: 3,
    });
    // 與統計頁「單字」同口徑
    expect(studySummary(cards, index).totalWords).toBe(cardTotals(cards).words);
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

describe("effectiveGoal", () => {
  it("佇列足夠:目標即設定值", () => {
    expect(effectiveGoal(20, 5, 30)).toEqual({ goal: 20, met: false, cleared: false });
    expect(effectiveGoal(20, 20, 3)).toEqual({ goal: 20, met: true, cleared: false });
    expect(effectiveGoal(20, 25, 0)).toEqual({ goal: 20, met: true, cleared: false });
  });

  it("佇列不足:目標降為今日已複習 + 剩餘", () => {
    expect(effectiveGoal(20, 0, 10)).toEqual({ goal: 10, met: false, cleared: false });
    expect(effectiveGoal(20, 5, 3)).toEqual({ goal: 8, met: false, cleared: false });
  });

  it("佇列清空且今日已複習 → 達標(未達設定目標時標記 cleared)", () => {
    expect(effectiveGoal(20, 3, 0)).toEqual({ goal: 3, met: true, cleared: true });
  });

  it("今日無卡可做且未複習:維持設定目標、未達標", () => {
    expect(effectiveGoal(20, 0, 0)).toEqual({ goal: 20, met: false, cleared: false });
  });

  it("dailyGoal 為 0:恆達標", () => {
    expect(effectiveGoal(0, 0, 5)).toEqual({ goal: 0, met: true, cleared: false });
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
  const p = (added: number, learned: number, total = 5, supplementaryAdded = 0) => ({
    lessonId: 1,
    title: "課",
    total,
    added,
    learned,
    supplementaryAdded,
  });

  it("未加入任何卡 → not-started;只加入補充單字 → in-progress", () => {
    expect(lessonStatus(p(0, 0))).toBe("not-started");
    expect(lessonStatus(p(0, 0, 5, 1))).toBe("in-progress");
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
      card({ state: 1 }), // learning(僅匯入舊資料會出現)
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

  it("學習中 = Review 且最後一次評「重來」;不再計入未成熟/已成熟,已會仍優先", () => {
    const cards = [
      card({ cardId: "again-young", state: 2, stability: 0.4 }),
      card({ cardId: "again-mature", state: 2, stability: 30 }), // 成熟卡遺忘
      card({ cardId: "again-suspended", state: 2, suspended: true }),
      card({ cardId: "good-young", state: 2, stability: 5 }),
      card({ cardId: "good-mature", state: 2, stability: 30 }),
      card({ cardId: "recovered", state: 2, stability: 3 }), // 重來後又答對
      card({ cardId: "new", state: 0 }),
    ];
    const logs = [
      log({ cardId: "again-young", rating: 1, state: 0 }),
      log({ cardId: "again-mature", rating: 1, state: 2 }),
      log({ cardId: "again-suspended", rating: 1 }),
      log({ cardId: "good-young", rating: 3 }),
      log({ cardId: "good-mature", rating: 4 }),
      log({ cardId: "recovered", rating: 1, reviewedAt: now.getTime() - DAY }),
      log({ cardId: "recovered", rating: 3, reviewedAt: now.getTime() }),
    ];

    const counts = stageDistribution(cards, lastRatingByCard(logs));
    expect(counts).toEqual({ new: 1, learning: 2, young: 2, mature: 1, suspended: 1 });
    // 各桶互斥:總和 = 卡數
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(cards.length);
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
