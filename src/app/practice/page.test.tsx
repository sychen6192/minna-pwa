import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { db, type CardRow } from "@/lib/db";
import type { Lesson } from "@/schemas/lesson";
import PracticePage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const lesson: Lesson = {
  id: 13,
  title: "第13課",
  vocab: [
    {
      id: "L13-V001",
      ruby: [{ b: "遊", r: "あそ" }, { b: "びます" }],
      kana: "あそびます",
      meaning: "玩、遊玩",
      pos: "動I",
    },
    { id: "L13-V002", ruby: [{ b: "本" }], kana: "ほん", meaning: "書", pos: "名" },
  ],
  grammar: [],
  dialogues: [],
};

vi.mock("@/lib/content", () => ({ getLesson: async () => lesson }));

function leechCard(id: string, lapses: number): CardRow {
  return {
    cardId: id,
    lessonId: 13,
    type: "vocab",
    due: Date.now(),
    stability: 1,
    difficulty: 5,
    reps: lapses,
    lapses,
    state: 2,
  };
}

beforeEach(async () => {
  await db.cards.clear();
});

describe("PracticePage", () => {
  it("無頑固卡:顯示空狀態", async () => {
    render(<PracticePage />);
    expect(await screen.findByText(/目前沒有頑固卡/)).toBeInTheDocument();
  });

  it("有頑固卡:依 lapses 由多到少,翻卡見釋義與答錯次數,逐張到完成", async () => {
    await db.cards.bulkAdd([leechCard("L13-V001", 5), leechCard("L13-V002", 4)]);
    const user = userEvent.setup();
    render(<PracticePage />);

    // 第一張 = lapses 最多者(遊びます,5 次)
    await screen.findByText("1 / 2");
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.getByText(/答錯 5 次/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一張" }));
    await screen.findByText("2 / 2");
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("書")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(await screen.findByText(/頑固卡練習完成/)).toBeInTheDocument();
  });
});
