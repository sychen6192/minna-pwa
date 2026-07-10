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
  baseVocabId: (id: string) => (id.endsWith("@r") ? id.slice(0, -2) : id),
  cardDirection: (c: { direction?: "fwd" | "rev" }) => c.direction ?? "fwd",
}));

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: (...a: unknown[]) => getLesson(...a),
}));

const getSetting = vi.fn();
vi.mock("@/lib/db", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
}));

const speak = vi.fn();
vi.mock("@/lib/tts", () => ({
  speak: (...a: unknown[]) => speak(...a),
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

  it("翻卡後顯示同課例句(附翻譯)與例句/單字發音鈕", async () => {
    const lessonWithExample: Lesson = {
      ...lesson,
      grammar: [
        {
          id: "L13-G01",
          pattern: "型",
          examples: [
            {
              id: "L13-S01",
              ruby: [{ b: "公園で" }, { b: "遊", r: "あそ" }, { b: "びます。" }],
              translation: "在公園玩。",
            },
          ],
        },
      ],
    };
    buildQueue.mockResolvedValue([cardRow]);
    getSetting.mockResolvedValue("show");
    getLesson.mockResolvedValue(lessonWithExample);
    previewIntervals.mockResolvedValue(previews);
    countDue.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText(/點擊卡片/);
    await user.click(screen.getByRole("button", { name: "顯示答案" }));

    // 例句翻譯與發音鈕
    expect(screen.getByText("在公園玩。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "播放例句發音" }),
    ).toBeInTheDocument();

    // 單字發音鈕 → speak(kana)
    await user.click(
      screen.getByRole("button", { name: "播放 あそびます 的發音" }),
    );
    expect(speak).toHaveBeenCalledWith("あそびます");
  });

  it("回想方向卡(rev):正面給中文,翻面才顯示日文與讀音", async () => {
    buildQueue.mockResolvedValue([{ ...cardRow, cardId: "L13-V001@r", direction: "rev" }]);
    getSetting.mockResolvedValue("show");
    getLesson.mockResolvedValue(lesson);
    previewIntervals.mockResolvedValue(previews);
    countDue.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    // 方向徽章 + 正面中文;翻面前看不到讀音
    expect(await screen.findByText("中 → 日")).toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.queryByText("あそびます")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("あそびます")).toBeInTheDocument();
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
