import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { Lesson } from "@/schemas/lesson";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const lessons: Record<number, Lesson> = {
  1: {
    id: 1,
    title: "第一課",
    vocab: [
      {
        id: "L01-V001",
        ruby: [{ b: "先生", r: "せんせい" }],
        kana: "せんせい",
        meaning: "老師",
        pos: "名",
      },
    ],
    grammar: [
      {
        id: "L01-G01",
        pattern: "(名詞1)は(名詞2)です",
        explanation: "斷定句。",
        examples: [
          { id: "L01-S01", ruby: [{ b: "わたしは 学生です。" }], translation: "我是學生。" },
        ],
      },
    ],
    dialogues: [],
  },
  13: {
    id: 13,
    title: "〜が ほしいです",
    vocab: [],
    grammar: [
      {
        id: "L13-G01",
        pattern: "(名詞)が 欲しいです",
        explanation: "表現說話人想要得到某物。",
        examples: [],
      },
    ],
    dialogues: [],
  },
};

vi.mock("@/lib/content", () => ({
  getLessonIndex: async () => ({
    lessons: [1, 13].map((id) => ({
      id,
      title: lessons[id].title,
      vocabCount: lessons[id].vocab.length,
      grammarCount: lessons[id].grammar.length,
    })),
  }),
  getLesson: async (id: number) => lessons[id],
}));

import GrammarPage from "./page";

describe("GrammarPage", () => {
  it("預設顯示跨課文法列表(課號排序),連到課程錨點", async () => {
    render(<GrammarPage />);

    const list = await screen.findByRole("list", { name: "全部文法點" });
    const links = Array.from(list.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/lessons/1#L01-G01",
      "/lessons/13#L13-G01",
    ]);
    expect(screen.getByText("(名詞)が 欲しいです")).toBeInTheDocument();
  });

  it("搜尋:各類結果附徽章與正確連結;清空回到列表", async () => {
    const user = userEvent.setup();
    render(<GrammarPage />);
    const input = await screen.findByRole("searchbox");

    // 中文查解說 → 文型命中
    await user.type(input, "想要");
    const results = await screen.findByRole("list", { name: "搜尋結果" });
    expect(results).toHaveTextContent("文型");
    expect(results.querySelector('a[href="/lessons/13#L13-G01"]')).toBeTruthy();

    // 換查單字(kana)→ 単語命中,無錨點
    await user.clear(input);
    await user.type(input, "せんせい");
    const results2 = await screen.findByRole("list", { name: "搜尋結果" });
    expect(results2).toHaveTextContent("単語");
    expect(results2.querySelector('a[href="/lessons/1"]')).toBeTruthy();

    // 例句命中 → 錨點指向所屬文法點
    await user.clear(input);
    await user.type(input, "学生");
    const results3 = await screen.findByRole("list", { name: "搜尋結果" });
    expect(results3).toHaveTextContent("例句");
    expect(results3.querySelector('a[href="/lessons/1#L01-G01"]')).toBeTruthy();

    // 清空 → 回到全部文法列表
    await user.clear(input);
    expect(await screen.findByRole("list", { name: "全部文法點" })).toBeInTheDocument();
  });

  it("無結果:顯示找不到提示", async () => {
    const user = userEvent.setup();
    render(<GrammarPage />);
    const input = await screen.findByRole("searchbox");

    await user.type(input, "zzzzzz");
    expect(await screen.findByText(/找不到「zzzzzz」的結果/)).toBeInTheDocument();
  });
});
