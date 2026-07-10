import { render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { db, type CardRow } from "@/lib/db";
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

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear()]);
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

    expect(await screen.findByText("今日到期")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始複習" })).toHaveAttribute("href", "/review");
    // 已開始 2 課、累計 3 張
    expect(screen.getByText(/已開始課程/).parentElement).toHaveTextContent("2 / 2 課");
    expect(screen.getByText(/累計卡片/).parentElement).toHaveTextContent("3 張");
  });

  it("有複習紀錄:顯示連續天數與今日目標進度", async () => {
    await db.cards.bulkAdd([card({ cardId: "L01-V001", lessonId: 1 })]);
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

  it("有卡但無到期:顯示完成訊息,不顯示開始複習", async () => {
    await db.cards.bulkAdd([
      // due 在未來 → 不到期
      card({ cardId: "L01-V001", lessonId: 1, due: Date.now() + DAY, state: 2 }),
    ]);

    render(<Home />);

    expect(await screen.findByText(/今天沒有到期的卡片/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "開始複習" })).not.toBeInTheDocument();
  });
});
