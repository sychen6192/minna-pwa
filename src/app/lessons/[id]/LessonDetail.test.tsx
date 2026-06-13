import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import type { Lesson } from "@/schemas/lesson";

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: () => getLesson(),
}));

const speak = vi.fn();
vi.mock("@/lib/tts", () => ({
  speak: (text: string) => speak(text),
}));

const addCards = vi.fn();
const existingCardIds = vi.fn();
vi.mock("@/lib/srs", () => ({
  addCards: (...a: unknown[]) => addCards(...a),
  existingCardIds: (...a: unknown[]) => existingCardIds(...a),
}));

import { LessonDetail } from "./LessonDetail";

const sampleLesson: Lesson = {
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
    {
      id: "L13-V002",
      ruby: [{ b: "ほしい" }],
      kana: "ほしい",
      meaning: "想要",
      pos: "い形",
    },
  ],
  grammar: [
    {
      id: "L13-G01",
      pattern: "(名詞)が ほしいです",
      explanation: "表達想要某物。",
      examples: [
        {
          id: "L13-S01",
          ruby: [{ b: "車", r: "くるま" }, { b: "が ほしいです" }],
          translation: "我想要車子。",
        },
      ],
    },
  ],
  dialogues: [
    {
      id: "L13-D01",
      ruby: [{ b: "京都", r: "きょうと" }, { b: "へ 行きませんか" }],
      translation: "要不要去京都?",
      speaker: "ミラー",
    },
  ],
};

beforeEach(() => {
  existingCardIds.mockResolvedValue([]);
  addCards.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LessonDetail", () => {
  it("預設顯示単語分頁,含釋義與 furigana", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const { container } = render(<LessonDetail id={13} />);

    expect(await screen.findByText("玩、遊玩")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "〜が ほしいです" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("rt").length).toBeGreaterThan(0);
  });

  it("頁內 furigana 快切:隱藏後移除所有 <rt>", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    const { container } = render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    expect(container.querySelectorAll("rt").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /假名/ }));
    expect(container.querySelectorAll("rt")).toHaveLength(0);
  });

  it("切換到文型分頁:顯示文型、隱藏単語", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("tab", { name: "文型" }));
    expect(screen.getByText("(名詞)が ほしいです")).toBeInTheDocument();
    expect(screen.getByText("我想要車子。")).toBeInTheDocument();
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
  });

  it("切換到会話分頁:顯示說話者與翻譯", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("tab", { name: "会話" }));
    expect(screen.getByText("ミラー")).toBeInTheDocument();
    expect(screen.getByText("要不要去京都?")).toBeInTheDocument();
  });

  it("文型/会話為空時顯示提示", async () => {
    getLesson.mockResolvedValue({
      ...sampleLesson,
      grammar: [],
      dialogues: [],
    });
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("tab", { name: "文型" }));
    expect(screen.getByText("本課沒有文型")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "会話" }));
    expect(screen.getByText("本課沒有会話")).toBeInTheDocument();
  });

  it("單字發音鈕:點擊以該字 kana 呼叫 speak", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(
      screen.getByRole("button", { name: "播放 あそびます 的發音" }),
    );
    expect(speak).toHaveBeenCalledWith("あそびます");
  });

  it("單字加入複習:點擊以該 id 呼叫 addCards 並標示已加入", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(
      screen.getByRole("button", { name: "加入複習:あそびます" }),
    );
    expect(addCards).toHaveBeenCalledWith(["L13-V001"], 13);
    expect(
      await screen.findByLabelText("あそびます 已加入複習"),
    ).toBeInTheDocument();
  });

  it("整課加入複習:以全部 id 呼叫 addCards", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("button", { name: "整課加入複習" }));
    expect(addCards).toHaveBeenCalledWith(["L13-V001", "L13-V002"], 13);
    expect(
      await screen.findByRole("button", { name: "整課已加入" }),
    ).toBeInTheDocument();
  });

  it("已加入的單字顯示已加入、不再顯示加入鈕", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    existingCardIds.mockResolvedValue(["L13-V001"]);
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    expect(
      await screen.findByLabelText("あそびます 已加入複習"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加入複習:あそびます" }),
    ).not.toBeInTheDocument();
  });

  it("載入失敗顯示錯誤", async () => {
    getLesson.mockRejectedValue(new Error("HTTP 404"));
    render(<LessonDetail id={99} />);
    expect(
      await screen.findByText(/載入課程失敗.*HTTP 404/),
    ).toBeInTheDocument();
  });
});
