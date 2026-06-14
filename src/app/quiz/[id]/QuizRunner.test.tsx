import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import type { Lesson } from "@/schemas/lesson";
import type { McqQuestion, Question, QuizCandidate } from "@/lib/quiz";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: (...a: unknown[]) => getLesson(...a),
}));

const getSetting = vi.fn();
vi.mock("@/lib/db", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
}));

const generateQuiz = vi.fn();
vi.mock("@/lib/quiz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quiz")>();
  return { ...actual, generateQuiz: (...a: unknown[]) => generateQuiz(...a) };
});

import { QuizRunner } from "./QuizRunner";

const inu: QuizCandidate = {
  id: "L13-V001",
  lessonId: 13,
  ruby: [{ b: "犬", r: "いぬ" }],
  kana: "いぬ",
  meaning: "狗",
  pos: "名",
};
const neko: QuizCandidate = {
  id: "L13-V002",
  lessonId: 13,
  ruby: [{ b: "猫", r: "ねこ" }],
  kana: "ねこ",
  meaning: "貓",
  pos: "名",
};

const mcq: McqQuestion = {
  type: "jp-to-zh",
  answer: inu,
  options: [
    { id: "L13-V001", candidate: inu, correct: true },
    { id: "L13-V002", candidate: neko, correct: false },
    {
      id: "x3",
      candidate: { ...neko, id: "x3", meaning: "鳥" },
      correct: false,
    },
    {
      id: "x4",
      candidate: { ...neko, id: "x4", meaning: "魚" },
      correct: false,
    },
  ],
};
const inputQ: Question = { type: "input", answer: neko };

const lesson: Lesson = {
  id: 13,
  title: "テスト",
  vocab: [inu, neko],
  grammar: [],
  dialogues: [],
};

beforeEach(() => {
  getLesson.mockResolvedValue(lesson);
  getSetting.mockResolvedValue("show");
  generateQuiz.mockReturnValue([mcq, inputQ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QuizRunner", () => {
  it("顯示進度與第一題選項", async () => {
    render(<QuizRunner id={13} />);
    expect(await screen.findByText("第 1 / 2 題")).toBeInTheDocument();
    for (const m of ["狗", "貓", "鳥", "魚"]) {
      expect(screen.getByRole("button", { name: m })).toBeInTheDocument();
    }
  });

  it("選擇題:答對顯示回饋,下一題前進", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await screen.findByText("第 1 / 2 題");

    await user.click(screen.getByRole("button", { name: "狗" }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 2 / 2 題")).toBeInTheDocument();
  });

  it("選擇題:答錯顯示正解讀音", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await screen.findByText("第 1 / 2 題");

    await user.click(screen.getByRole("button", { name: "貓" }));
    expect(screen.getByText(/答錯.*いぬ/)).toBeInTheDocument();
  });

  it("輸入題:羅馬字經正規化判定為正解,走完一輪到結算", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await screen.findByText("第 1 / 2 題");

    // 第一題隨意答(選正解)
    await user.click(screen.getByRole("button", { name: "狗" }));
    await user.click(screen.getByRole("button", { name: "下一題" }));

    // 第二題輸入(輸入 neko 的羅馬字)
    await user.type(screen.getByLabelText("輸入假名"), "neko");
    await user.click(screen.getByRole("button", { name: "作答" }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(screen.getByText("測驗完成")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });
});
