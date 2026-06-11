import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { CardRow } from "@/lib/db";
import type { Lesson } from "@/schemas/lesson";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const buildQueue = vi.fn();
const rate = vi.fn();
const previewIntervals = vi.fn();
const countDue = vi.fn();
vi.mock("@/lib/srs", () => ({
  buildQueue: (...a: unknown[]) => buildQueue(...a),
  rate: (...a: unknown[]) => rate(...a),
  previewIntervals: (...a: unknown[]) => previewIntervals(...a),
  countDue: (...a: unknown[]) => countDue(...a),
}));

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: (...a: unknown[]) => getLesson(...a),
}));

const getSetting = vi.fn();
vi.mock("@/lib/db", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
}));

import ReviewPage from "./page";

const cardRow: CardRow = {
  cardId: "L13-V001",
  lessonId: 13,
  type: "vocab",
  due: 1000,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  state: 0,
};

const lesson: Lesson = {
  id: 13,
  title: "〜が ほしいです",
  vocab: [
    {
      id: "L13-V001",
      ruby: [{ b: "遊", r: "あそ" }, { b: "びます" }],
      kana: "あそびます",
      meaning: "玩、遊玩",
      pos: "動I",
    },
  ],
  grammar: [],
  dialogues: [],
};

const previews = {
  again: { due: 1, days: 0 },
  hard: { due: 2, days: 1 },
  good: { due: 3, days: 3 },
  easy: { due: 4, days: 7 },
};

function setupOneCard() {
  buildQueue.mockResolvedValue([cardRow]);
  getSetting.mockResolvedValue("show");
  getLesson.mockResolvedValue(lesson);
  previewIntervals.mockResolvedValue(previews);
  rate.mockResolvedValue(cardRow);
  countDue.mockResolvedValue(0);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReviewPage", () => {
  it("佇列空時顯示今日完成與明日到期", async () => {
    buildQueue.mockResolvedValue([]);
    countDue.mockResolvedValue(5);
    render(<ReviewPage />);
    expect(await screen.findByText("今日複習完成 🎉")).toBeInTheDocument();
    expect(screen.getByText(/明日到期:5 張/)).toBeInTheDocument();
  });

  it("翻卡→評分→結算(點擊操作)", async () => {
    setupOneCard();
    const user = userEvent.setup();
    render(<ReviewPage />);

    // 進入複習,答案尚未顯示
    await screen.findByText(/點擊卡片/);
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();

    // 翻面
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();

    // 評分「良好」→ rate 以 rating=3 呼叫
    await user.click(screen.getByRole("button", { name: "良好" }));
    expect(rate).toHaveBeenCalledWith("L13-V001", 3, expect.any(Number));

    // 結算頁
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    const goodRow = screen.getByText("良好").closest("div");
    expect(goodRow).toHaveTextContent("1");
  });

  it("鍵盤:空白翻面、數字鍵評分", async () => {
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText(/點擊卡片/);

    fireEvent.keyDown(window, { code: "Space" });
    expect(await screen.findByText("玩、遊玩")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() =>
      expect(rate).toHaveBeenCalledWith("L13-V001", 3, expect.any(Number)),
    );
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
  });
});
