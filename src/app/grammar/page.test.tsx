import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { Lesson } from "@/schemas/lesson";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    // jsdom 不做導覽
    <a href={href} onClick={(e) => e.preventDefault()}>
      {children}
    </a>
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

beforeEach(() => {
  window.history.replaceState(null, "", "/grammar");
});

describe("GrammarPage", () => {
  it("預設顯示跨課文法列表(課號排序),連到課程錨點", async () => {
    render(<GrammarPage />);

    const list = await screen.findByRole("list", { name: "全部文法點" });
    const links = Array.from(list.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/lessons/1#L01-G01",
      "/lessons/13#L13-G01",
    ]);
    expect(screen.getByText("(名詞)が 欲しいです")).toHaveAttribute("lang", "ja");
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

    // 換查單字(kana)→ 単語命中,連到課程頁的單字錨點
    await user.clear(input);
    await user.type(input, "せんせい");
    const results2 = await screen.findByRole("list", { name: "搜尋結果" });
    expect(results2).toHaveTextContent("単語");
    expect(results2.querySelector('a[href="/lessons/1#L01-V001"]')).toBeTruthy();
    // 日文標題與日文用語徽章標 lang=ja
    expect(within(results2).getByText("先生")).toHaveAttribute("lang", "ja");
    expect(within(results2).getByText("単語")).toHaveAttribute("lang", "ja");

    // 例句命中 → 錨點指向所屬文法點
    await user.clear(input);
    await user.type(input, "学生");
    const results3 = await screen.findByRole("list", { name: "搜尋結果" });
    expect(results3).toHaveTextContent("例句");
    expect(within(results3).getByText("例句")).not.toHaveAttribute("lang");
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

  it("搜尋字串寫回網址 ?q=(replaceState、延遲寫入);清空即移除", async () => {
    const user = userEvent.setup();
    render(<GrammarPage />);
    const input = await screen.findByRole("searchbox");
    const length = window.history.length;

    await user.type(input, "想要");
    await waitFor(() => expect(window.location.search).toBe(`?q=${encodeURIComponent("想要")}`));
    expect(window.location.pathname).toBe("/grammar");
    expect(window.history.length).toBe(length);

    await user.clear(input);
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("帶 ?q= 開啟(返回本頁):搜尋框預填並顯示結果", async () => {
    window.history.replaceState(null, "", `/grammar?q=${encodeURIComponent("想要")}`);
    render(<GrammarPage />);

    const results = await screen.findByRole("list", { name: "搜尋結果" });
    expect(screen.getByRole("searchbox")).toHaveValue("想要");
    expect(results.querySelector('a[href="/lessons/13#L13-G01"]')).toBeTruthy();
    expect(window.location.search).toBe(`?q=${encodeURIComponent("想要")}`);
  });

  /** 攔下 300ms 的延遲寫入(不自動執行、可被 clearTimeout 取消,由 runDeferred 觸發),其餘計時器照常 */
  function holdQuerySync() {
    const realSetTimeout = window.setTimeout;
    const realClearTimeout = window.clearTimeout;
    const held = new Map<number, () => void>();
    let nextId = -1; // 負數 id:不與真實計時器衝突
    const set = vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      if (ms !== 300) return realSetTimeout(fn, ms);
      held.set(nextId, fn);
      return nextId--;
    }) as typeof window.setTimeout);
    const clear = vi.spyOn(window, "clearTimeout").mockImplementation(((id?: number) => {
      if (id === undefined || !held.delete(id)) realClearTimeout(id);
    }) as typeof window.clearTimeout);
    return {
      runDeferred: () =>
        act(() => {
          const fns = [...held.values()];
          held.clear();
          fns.forEach((fn) => fn());
        }),
      restore: () => {
        set.mockRestore();
        clear.mockRestore();
      },
    };
  }

  it("點搜尋結果時立即寫入尚在延遲中的查詢(返回時不遺失最後輸入)", async () => {
    const timers = holdQuerySync();
    try {
      const user = userEvent.setup();
      render(<GrammarPage />);
      await waitFor(() => expect(screen.getByRole("searchbox")).toBeEnabled());

      await user.type(screen.getByRole("searchbox"), "学生");
      const results = await screen.findByRole("list", { name: "搜尋結果" });
      expect(window.location.search).toBe("");
      await user.click(within(results).getByText("わたしは 学生です。"));
      expect(window.location.search).toBe(`?q=${encodeURIComponent("学生")}`);
    } finally {
      timers.restore();
    }
  });

  it("點頁外連結(底部導覽)也先寫入查詢;之後延遲計時器不再改寫網址(不取消進行中的導覽)", async () => {
    const timers = holdQuerySync();
    const navigate = vi.fn((e: React.MouseEvent) => e.preventDefault());
    try {
      const user = userEvent.setup();
      render(
        <>
          <GrammarPage />
          <a href="/review" onClick={navigate}>
            複習
          </a>
        </>,
      );
      await waitFor(() => expect(screen.getByRole("searchbox")).toBeEnabled());
      await user.type(screen.getByRole("searchbox"), "想要");
      expect(window.location.search).toBe("");

      const replaceState = vi.spyOn(window.history, "replaceState");
      await user.click(screen.getByRole("link", { name: "複習" }));
      // capture 階段先寫入,連結自己的處理(Next 的導覽)照常執行
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(window.location.search).toBe(`?q=${encodeURIComponent("想要")}`);
      expect(navigate).toHaveBeenCalledTimes(1);
      // 導覽載入中計時器才到:不再呼叫 replaceState(Next 會把它當 RESTORE,取消該導覽)
      timers.runDeferred();
      expect(replaceState).toHaveBeenCalledTimes(1);
    } finally {
      timers.restore();
    }
  });

  it("延遲中已離開本頁(上一頁):計時器不把 ?q= 寫到別頁的網址", async () => {
    const timers = holdQuerySync();
    try {
      const user = userEvent.setup();
      render(<GrammarPage />);
      await waitFor(() => expect(screen.getByRole("searchbox")).toBeEnabled());
      await user.type(screen.getByRole("searchbox"), "想要");

      window.history.pushState(null, "", "/lessons/13#grammar"); // 模擬返回上一頁
      timers.runDeferred();
      expect(window.location.pathname).toBe("/lessons/13");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("#grammar");
    } finally {
      timers.restore();
    }
  });
});
