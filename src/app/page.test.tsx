import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting, type CardRow } from "@/lib/db";
import { addStudyDays, nextStudyDayStart } from "@/lib/studyDay";
import Home from "./page";

// content.ts 走 fetch;首頁只需課程索引
vi.mock("@/lib/content", () => ({
  getLessonIndex: async () => ({
    lessons: [
      { id: 1, title: "第一課", vocabCount: 10, grammarCount: 3 },
      { id: 2, title: "第二課", vocabCount: 5, grammarCount: 2 },
    ],
  }),
}));

const DAY = 86_400_000;

function card(overrides: Partial<CardRow> = {}): CardRow {
  return {
    cardId: "L01-V001",
    lessonId: 1,
    type: "vocab",
    due: Date.now(),
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 2,
    ...overrides,
  };
}

/** 新卡(state=New) */
function newCard(cardId: string): CardRow {
  return card({ cardId, state: 0, reps: 0, stability: 0, difficulty: 0 });
}

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear(), db.settings.clear()]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Home(今日儀表板)", () => {
  it("空 DB:引導去課程加入單字", async () => {
    render(<Home />);

    expect(await screen.findByText(/還沒有加入任何單字/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "瀏覽課程" })).toHaveAttribute("href", "/lessons");
    // 進度摘要:0 / 2 課
    expect(screen.getByText(/已開始課程/).parentElement).toHaveTextContent("0 / 2 課");
  });

  it("有到期卡:顯示到期數與開始複習 CTA(→ /review)", async () => {
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001", lessonId: 1, due: Date.now() - DAY, state: 2 }),
      card({ cardId: "L01-V002", lessonId: 1, due: Date.now() - DAY, state: 2 }),
      card({ cardId: "L02-V001", lessonId: 2, due: Date.now() - DAY, state: 2 }),
    ]);

    render(<Home />);

    expect(await screen.findByText("今日待複習")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("複習 3 · 新卡 0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始複習" })).toHaveAttribute("href", "/review");
    // 已開始 2 課、累計 3 張
    expect(screen.getByText(/已開始課程/).parentElement).toHaveTextContent("2 / 2 課");
    expect(screen.getByText(/累計卡片/).parentElement).toHaveTextContent("3 張");
  });

  it("有複習紀錄:顯示連續天數與今日目標進度", async () => {
    // 今日佇列尚有 20 張到期卡 → 有效目標維持設定值 20
    await db.cards.bulkAdd(
      Array.from({ length: 21 }, (_, i) =>
        card({ cardId: `L01-V${String(i + 1).padStart(3, "0")}`, lessonId: 1 }),
      ),
    );
    const nowMs = Date.now();
    await db.logs.bulkAdd([
      { cardId: "L01-V001", rating: 3, state: 2, due: nowMs, elapsedDays: 0, reviewedAt: nowMs },
      { cardId: "L01-V001", rating: 3, state: 2, due: nowMs, elapsedDays: 0, reviewedAt: nowMs },
    ]);

    render(<Home />);

    const card_ = (await screen.findByText("連續學習天數")).closest("section");
    expect(card_).toBeInTheDocument();
    // 今日 2 筆 / 目標 20;連續 1 天
    expect(card_).toHaveTextContent("🔥 1");
    expect(card_).toHaveTextContent("2 / 20");
    expect(card_).toHaveTextContent("今日目標");
  });

  it("有頑固卡:顯示警示並連到 /practice", async () => {
    await db.cards.bulkAdd([
      // lapses ≥ 門檻(4)→ 頑固卡;due 在未來,與到期無關
      card({ cardId: "L01-V001", lessonId: 1, due: Date.now() + DAY, state: 2, lapses: 5 }),
    ]);

    render(<Home />);

    expect(await screen.findByText(/1 張頑固卡需要加強/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /頑固卡/ })).toHaveAttribute("href", "/practice");
  });

  it("有卡但今日佇列為空:顯示今日任務完成,不顯示開始複習", async () => {
    await db.cards.bulkAdd([
      // due 在明日學習日 → 今日不到期(不用 now + 24h:DST 回撥日的學習日長 25 小時)
      card({
        cardId: "L01-V001",
        lessonId: 1,
        due: nextStudyDayStart(Date.now()) + 3_600_000,
        state: 2,
      }),
    ]);

    render(<Home />);

    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();
    expect(screen.getByText(/要不要去課程加入新單字/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "開始複習" })).not.toBeInTheDocument();
  });

  it("只有新卡:顯示新卡數與開始複習", async () => {
    await db.cards.bulkAdd([newCard("L01-V001"), newCard("L01-V002"), newCard("L01-V003")]);

    render(<Home />);

    expect(await screen.findByText("複習 0 · 新卡 3")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始複習" })).toHaveAttribute("href", "/review");
    expect(screen.queryByText(/今日任務完成/)).not.toBeInTheDocument();
    // 今日可做 3 張 → 有效目標 3(設定 20)
    const goal = screen.getByText(/今日目標/).closest("section");
    expect(goal).toHaveTextContent("0 / 3");
    expect(goal).toHaveTextContent("設定 20");
  });

  it("今日新卡已達上限:完成訊息提示明天繼續", async () => {
    await setSetting("newPerDay", 1);
    const nowMs = Date.now();
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001", due: addStudyDays(nowMs, 3) }), // 今日已首評
      newCard("L01-V002"),
    ]);
    await db.logs.add({
      cardId: "L01-V001",
      rating: 3,
      state: 0,
      due: nowMs,
      elapsedDays: 0,
      reviewedAt: nowMs,
    });

    render(<Home />);

    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();
    expect(screen.getByText("今日新卡已達上限,明天繼續")).toBeInTheDocument();
    expect(screen.queryByText(/要不要去課程加入新單字/)).not.toBeInTheDocument();
  });

  it("reverseCards:新卡額度用完、只剩隔日才出的回想卡 → 提示明天繼續,不建議加新字", async () => {
    await setSetting("newPerDay", 2);
    const nowMs = Date.now();
    const ids = ["L01-V001", "L01-V002"];
    await db.cards.bulkAdd([
      // 正向卡今日首評,已排到 3 天後;回想卡仍為 New(bury 至明天)
      ...ids.map((cardId) => card({ cardId, due: addStudyDays(nowMs, 3) })),
      ...ids.map((id) => ({ ...newCard(`${id}@r`), direction: "rev" as const })),
    ]);
    await db.logs.bulkAdd(
      ids.map((cardId) => ({
        cardId,
        rating: 3 as const,
        state: 0 as const,
        due: nowMs,
        elapsedDays: 0,
        reviewedAt: nowMs,
      })),
    );

    render(<Home />);

    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();
    expect(screen.getByText("今日新卡已達上限,明天繼續")).toBeInTheDocument();
    expect(screen.queryByText(/要不要去課程加入新單字/)).not.toBeInTheDocument();
  });

  it("每日新卡上限為 0:不說「明天繼續」", async () => {
    await setSetting("newPerDay", 0);
    await db.cards.bulkAdd([newCard("L01-V001")]);

    render(<Home />);

    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();
    expect(screen.getByText("每日新卡上限設為 0,暫不引入新卡")).toBeInTheDocument();
    expect(screen.queryByText(/明天繼續/)).not.toBeInTheDocument();
  });

  it("今日複習已達上限且仍有到期卡:提示明天繼續,不建議加新字", async () => {
    await setSetting("newPerDay", 0);
    await setSetting("maxReviewsPerDay", 1);
    const nowMs = Date.now();
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001", due: addStudyDays(nowMs, 5) }), // 今日已複習
      card({ cardId: "L01-V002", due: nowMs - DAY }), // 逾期,因上限等到明天
    ]);
    await db.logs.add({
      cardId: "L01-V001",
      rating: 3,
      state: 2,
      due: nowMs - DAY,
      elapsedDays: 3,
      reviewedAt: nowMs,
    });

    render(<Home />);

    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();
    expect(screen.getByText("今日複習已達上限,明天繼續")).toBeInTheDocument();
    expect(screen.queryByText(/要不要去課程加入新單字/)).not.toBeInTheDocument();
  });

  it("今日佇列清空即算達標(未達設定目標)", async () => {
    const nowMs = Date.now();
    const ids = ["L01-V001", "L01-V002", "L01-V003"];
    // 三張新卡今日已首評,已排到 3 天後;dailyGoal 預設 20
    await db.cards.bulkAdd(ids.map((cardId) => card({ cardId, due: addStudyDays(nowMs, 3) })));
    await db.logs.bulkAdd(
      ids.map((cardId) => ({
        cardId,
        rating: 3 as const,
        state: 0 as const,
        due: nowMs,
        elapsedDays: 0,
        reviewedAt: nowMs,
      })),
    );

    render(<Home />);

    const goal = (await screen.findByText(/今日目標/)).closest("section");
    expect(goal).toHaveTextContent("3 / 3");
    expect(goal).toHaveTextContent("今日佇列已清空 ✓");
    expect(goal).not.toHaveTextContent("今日目標已達成");
  });

  it("頁面重新可見且已跨學習日:重算今日佇列", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const evening = new Date(2026, 8, 1, 22, 0).getTime();
    vi.setSystemTime(evening);
    // 明日學習日 08:00 到期
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001", due: nextStudyDayStart(evening) + 4 * 3_600_000 }),
    ]);

    render(<Home />);
    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();

    vi.setSystemTime(evening + 12 * 3_600_000); // 隔天 10:00 切回 App
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(await screen.findByText("複習 1 · 新卡 0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始複習" })).toBeInTheDocument();
  });

  it("pageshow:只有 bfcache 還原(persisted)才重算", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const evening = new Date(2026, 8, 1, 22, 0).getTime();
    vi.setSystemTime(evening);
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001", due: nextStudyDayStart(evening) + 4 * 3_600_000 }),
    ]);

    render(<Home />);
    expect(await screen.findByText("今日任務完成 🎉")).toBeInTheDocument();

    vi.setSystemTime(evening + 12 * 3_600_000);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByText("今日任務完成 🎉")).toBeInTheDocument(); // 一般 pageshow 不重載

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(await screen.findByText("複習 1 · 新卡 0")).toBeInTheDocument();
  });
});
