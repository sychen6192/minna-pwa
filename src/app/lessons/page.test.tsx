import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { db, type CardRow, type LogRow } from "@/lib/db";
import type { LessonIndex } from "@/schemas/lesson";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const getLessonIndex = vi.fn();
const getSupplementaryWords = vi.fn();
vi.mock("@/lib/content", () => ({
  getLessonIndex: () => getLessonIndex(),
  getSupplementaryWords: (ids: number[]) => getSupplementaryWords(ids),
}));

import LessonsPage from "./page";

const sampleIndex: LessonIndex = {
  lessons: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    title: i + 1 === 13 ? "〜が ほしいです" : `第 ${i + 1} 課`,
    vocabCount: i + 1 === 13 ? 12 : 0,
    grammarCount: i + 1 === 13 ? 2 : 0,
  })),
};

function card(overrides: Partial<CardRow>): CardRow {
  return {
    cardId: "L13-V001",
    lessonId: 13,
    type: "vocab",
    due: Date.now(),
    stability: 1,
    difficulty: 5,
    reps: 0,
    lapses: 0,
    state: 0,
    ...overrides,
  };
}

function againLog(cardId: string): LogRow {
  return {
    cardId,
    rating: 1,
    state: 0,
    due: 0,
    elapsedDays: 0,
    reviewedAt: Date.now(),
  };
}

/** L13 只有 2 字的索引(方便構造「全部學會」) */
const twoWordIndex: LessonIndex = {
  lessons: sampleIndex.lessons.map((l) =>
    l.id === 13 ? { ...l, vocabCount: 2 } : l,
  ),
};

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear()]);
  getSupplementaryWords.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("LessonsPage", () => {
  it("成功:渲染 50 課,L13 顯示標題與字數並連到內頁", async () => {
    getLessonIndex.mockResolvedValue(sampleIndex);
    render(<LessonsPage />);

    await waitFor(() =>
      expect(screen.getByText("〜が ほしいです")).toBeInTheDocument(),
    );
    expect(screen.getByText("〜が ほしいです")).toHaveAttribute("lang", "ja");
    expect(screen.getAllByRole("link")).toHaveLength(50);
    expect(screen.getByText("12 字")).toBeInTheDocument();

    const l13 = screen.getByRole("link", { name: /〜が ほしいです/ });
    expect(l13).toHaveAttribute("href", "/lessons/13");
  });

  it("依 DB 卡片顯示各課狀態:有卡未學完 → 進行中,無卡 → 未開始", async () => {
    getLessonIndex.mockResolvedValue(sampleIndex);
    await db.cards.bulkAdd([
      card({ cardId: "L13-V001", state: 2 }), // 已學會
      card({ cardId: "L13-V002", state: 0 }), // 新卡;共 2/12,未學完
    ]);

    render(<LessonsPage />);

    const l13 = await screen.findByRole("link", { name: /〜が ほしいです/ });
    expect(l13).toHaveTextContent("進行中");
    // 無卡的課仍為未開始
    const l1 = screen.getByRole("link", { name: /第 1 課/ });
    expect(l1).toHaveTextContent("未開始");
  });

  it("已會的字計為已學會:其餘已學會 + 一字已會 → 已完成", async () => {
    getLessonIndex.mockResolvedValue(twoWordIndex);
    await db.cards.bulkAdd([
      card({ cardId: "L13-V001", state: 2 }),
      card({ cardId: "L13-V002", state: 0, suspended: true }), // 標為已會的新卡
    ]);

    render(<LessonsPage />);

    const l13 = await screen.findByRole("link", { name: /〜が ほしいです/ });
    await waitFor(() => expect(l13).toHaveTextContent("已完成"));
  });

  it("最後一次評「重來」的字不算已學會 → 仍為進行中", async () => {
    getLessonIndex.mockResolvedValue(twoWordIndex);
    await db.cards.bulkAdd([
      card({ cardId: "L13-V001", state: 2 }),
      card({ cardId: "L13-V002", state: 2 }), // 首評「重來」後仍為 Review
    ]);
    await db.logs.add(againLog("L13-V002"));

    render(<LessonsPage />);

    const l13 = await screen.findByRole("link", { name: /〜が ほしいです/ });
    await waitFor(() => expect(l13).toHaveTextContent("進行中"));
    expect(l13).not.toHaveTextContent("已完成");
  });

  it("補充單字不計入進度:核心字全部學會、補充單字未加入 → 已完成(只載入有卡片的課)", async () => {
    // L13 共 3 字,L13-V003 為補充單字
    getLessonIndex.mockResolvedValue({
      lessons: sampleIndex.lessons.map((l) => (l.id === 13 ? { ...l, vocabCount: 3 } : l)),
    });
    getSupplementaryWords.mockResolvedValue(new Map([[13, new Set(["L13-V003"])]]));
    await db.cards.bulkAdd([
      card({ cardId: "L13-V001", state: 2 }),
      card({ cardId: "L13-V002", state: 2 }),
    ]);

    render(<LessonsPage />);

    const l13 = await screen.findByRole("link", { name: /〜が ほしいです/ });
    await waitFor(() => expect(l13).toHaveTextContent("已完成"));
    expect(getSupplementaryWords).toHaveBeenCalledWith([13]);
  });

  it("IndexedDB 尚未回應時列表已渲染(狀態稍後補上):返回本頁時捲動位置可還原", async () => {
    getLessonIndex.mockResolvedValue(sampleIndex);
    let resolveCards: (rows: CardRow[]) => void = () => {};
    vi.spyOn(db.cards, "toArray").mockReturnValue(
      new Promise<CardRow[]>((resolve) => {
        resolveCards = resolve;
      }) as never,
    );

    render(<LessonsPage />);

    // 50 課連結已在,狀態欄尚未顯示
    expect(await screen.findAllByRole("link")).toHaveLength(50);
    const l13 = screen.getByRole("link", { name: /〜が ほしいです/ });
    expect(l13).not.toHaveTextContent(/未開始|進行中|已完成/);
    expect(screen.queryByText("載入中…")).not.toBeInTheDocument();

    resolveCards([card({ cardId: "L13-V001", state: 0 })]);
    await waitFor(() => expect(l13).toHaveTextContent("進行中"));
    expect(screen.getByRole("link", { name: /第 1 課/ })).toHaveTextContent("未開始");
  });

  it("載入中:資料未到前顯示載入提示", () => {
    getLessonIndex.mockReturnValue(new Promise(() => {})); // 永不 resolve
    render(<LessonsPage />);
    expect(screen.getByText("載入中…")).toBeInTheDocument();
  });

  it("失敗:顯示錯誤訊息", async () => {
    getLessonIndex.mockRejectedValue(new Error("HTTP 404"));
    render(<LessonsPage />);
    await waitFor(() =>
      expect(screen.getByText(/載入課程失敗.*HTTP 404/)).toBeInTheDocument(),
    );
  });
});
