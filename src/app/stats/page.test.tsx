import { render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { db, type CardRow, type LogRow } from "@/lib/db";
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

function log(overrides: Partial<LogRow> = {}): LogRow {
  return {
    cardId: "L01-V001",
    rating: 3,
    state: 2,
    due: Date.now(),
    elapsedDays: 1,
    reviewedAt: Date.now(),
    ...overrides,
  };
}

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
    // 數字卡:單字 1(無回想卡、無已會 → 不顯示附註)、整體留存率 100%
    const words = screen.getByText("單字").parentElement;
    expect(words).toHaveTextContent(/^單字1$/);
    expect(screen.getByText("整體留存率").parentElement).toHaveTextContent("100%");
    // 各課進度含 index 全部課(含無卡的第二課)
    expect(screen.getByText(/第二課/)).toBeInTheDocument();
  });

  it("單字與首頁同口徑(正向卡),附註卡片總數(含回想卡)與已會字數", async () => {
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001" }),
      card({ cardId: "L01-V001@r", direction: "rev" }),
      card({ cardId: "L01-V002", suspended: true }),
      card({ cardId: "L01-V002@r", direction: "rev", suspended: true }),
      card({ cardId: "L01-V003", state: 0 }),
    ]);
    await db.logs.add(log());

    render(<StatsPage />);

    const words = (await screen.findByText("單字")).parentElement;
    expect(words).toHaveTextContent("3");
    expect(words).toHaveTextContent("其中已會 1 字");
    expect(words).toHaveTextContent("卡片 5 張(含回想卡)");
    // 階段分布以卡片計(雙向卡各一張),並說明
    expect(screen.getByText(/以卡片計/)).toHaveTextContent("回想卡另計一張");
    expect(screen.getByText("已會").closest("li")).toHaveTextContent("已會2張");
  });

  it("最後一次評「重來」的卡:歸入學習中,各課進度不算已學會", async () => {
    await db.cards.bulkAdd([
      card({ cardId: "L01-V001", stability: 0.4 }),
      card({ cardId: "L01-V002", stability: 5 }),
    ]);
    await db.logs.bulkAdd([
      log({ cardId: "L01-V001", rating: 1, state: 0 }),
      log({ cardId: "L01-V002", rating: 3, state: 0 }),
    ]);

    render(<StatsPage />);

    expect((await screen.findByText("學習中")).closest("li")).toHaveTextContent("1");
    expect(screen.getByText("未成熟").closest("li")).toHaveTextContent("1");
    // L1:已加入 2、已學會 1
    expect(screen.getByTitle("已加入 2/10,已學會 1")).toBeInTheDocument();
  });

  it("各課進度圖例以色塊對應兩段進度條,不以「淺色/深色」描述(深色模式明暗相反)", async () => {
    await db.cards.add(card());
    await db.logs.add(log());

    render(<StatsPage />);

    const caption = await screen.findByText(/已加入複習/);
    expect(caption).not.toHaveTextContent(/淺色|深色/);
    const swatches = Array.from(caption.querySelectorAll("[aria-hidden] > span"));
    const segments = Array.from(
      screen.getByTitle("已加入 1/10,已學會 1").children,
    );
    // 色塊與進度條兩段(已加入、已學會)使用同一色彩 class
    const colour = (el: Element) =>
      Array.from(el.classList).find((c) => c.startsWith("bg-"));
    expect(swatches.map(colour)).toEqual(segments.map(colour));
    expect(swatches.map(colour)).toEqual(["bg-chart-1/30", "bg-chart-1"]);
  });
});
