import { render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import StatsPage from "./page";

// content.ts 走 fetch;統計頁測試只需索引 fixture
vi.mock("@/lib/content", () => ({
  getLessonIndex: async () => ({
    lessons: [
      { id: 1, title: "第一課", vocabCount: 10, grammarCount: 3 },
      { id: 2, title: "第二課", vocabCount: 5, grammarCount: 2 },
    ],
  }),
}));

beforeEach(async () => {
  await db.cards.clear();
  await db.logs.clear();
});

describe("StatsPage", () => {
  it("空 DB:顯示空狀態與課程頁引導", async () => {
    render(<StatsPage />);

    expect(await screen.findByText(/尚無學習紀錄/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /課程/ })).toHaveAttribute("href", "/lessons");
  });

  it("有資料:渲染四個統計區塊與數字卡", async () => {
    await db.cards.bulkAdd([
      {
        cardId: "L01-V001",
        lessonId: 1,
        type: "vocab",
        due: Date.now(),
        stability: 1,
        difficulty: 5,
        reps: 1,
        lapses: 0,
        state: 2,
      },
    ]);
    await db.logs.bulkAdd([
      {
        cardId: "L01-V001",
        rating: 3,
        state: 2,
        due: Date.now(),
        elapsedDays: 1,
        reviewedAt: Date.now(),
      },
    ]);

    render(<StatsPage />);

    expect(await screen.findByRole("heading", { name: /複習熱力圖/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /卡片階段分布/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /到期預測/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /留存率/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /各課進度/ })).toBeInTheDocument();
    // 階段分布:1 張 Review 卡歸「未成熟」(stability 1 < 21)
    expect(screen.getByText("未成熟").closest("li")).toHaveTextContent("1");
    // 數字卡:總卡數 1、整體留存率 100%
    expect(screen.getByText("總卡數").parentElement).toHaveTextContent("1");
    expect(screen.getByText("整體留存率").parentElement).toHaveTextContent("100%");
    // 各課進度含 index 全部課(含無卡的第二課)
    expect(screen.getByText(/第二課/)).toBeInTheDocument();
  });
});
