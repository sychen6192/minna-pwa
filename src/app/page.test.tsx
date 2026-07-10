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
  await db.cards.clear();
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
