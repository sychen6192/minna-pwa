import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting, type CardRow } from "@/lib/db";
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
      note: "〔公園で〜〕",
    },
    { id: "L13-V002", ruby: [{ b: "本" }], kana: "ほん", meaning: "書", pos: "名", note: "読み物" },
    {
      id: "L13-V003",
      ruby: [{ b: "夫", r: "おっと" }, { b: "／" }, { b: "主人", r: "しゅじん" }],
      kana: "おっと／しゅじん",
      meaning: "丈夫",
      pos: "名",
    },
    { id: "L13-V004", ruby: [{ b: "ほしい" }], kana: "ほしい", accent: 2, meaning: "想要", pos: "い形" },
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
  await Promise.all([db.cards.clear(), db.settings.clear()]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 以 mock 取代 Web Speech(日語 voice 已載入),回傳 speak 的 spy */
function installSpeech() {
  const speak = vi.fn();
  vi.stubGlobal(
    "speechSynthesis",
    Object.assign(new EventTarget(), {
      getVoices: () => [{ lang: "ja-JP", name: "Kyoko", localService: true }],
      speak,
      cancel: () => {},
    }),
  );
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      lang = "";
      voice: unknown = null;
      constructor(public text: string) {}
    },
  );
  return speak;
}

/** 畫面上看得到的文字(去除 sr-only) */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return clone.textContent ?? "";
}

describe("PracticePage", () => {
  it("純假名字:翻面後重音標記取代標題,讀音不重複顯示", async () => {
    await db.cards.bulkAdd([leechCard("L13-V004", 5)]);
    const user = userEvent.setup();
    const { container } = render(<PracticePage />);

    await screen.findByText("1 / 1");
    expect(container.querySelector("[data-mora]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(container.querySelectorAll("[data-mora]")).toHaveLength(3);
    expect(container.querySelector(".sr-only")).toHaveTextContent("ほしい、重音 2 型(中高)");
    expect(visibleText(container).match(/ほしい/g)).toHaveLength(1);
  });

  it("無頑固卡:顯示空狀態", async () => {
    render(<PracticePage />);
    expect(await screen.findByText(/目前沒有頑固卡/)).toBeInTheDocument();
  });

  it("頑固卡成熟後解除:不列入練習,空狀態說明解除條件", async () => {
    await db.cards.bulkAdd([{ ...leechCard("L13-V001", 6), stability: 30 }]);
    render(<PracticePage />);
    expect(await screen.findByText(/目前沒有頑固卡/)).toBeInTheDocument();
    expect(screen.getByText(/後自動解除/)).toHaveTextContent("加強;記牢(穩定度達 21 天)後自動解除");
  });

  it("有頑固卡:依 lapses 由多到少,翻卡見釋義與答錯次數,逐張到完成", async () => {
    await db.cards.bulkAdd([leechCard("L13-V001", 5), leechCard("L13-V002", 4)]);
    const user = userEvent.setup();
    render(<PracticePage />);

    // 第一張 = lapses 最多者(遊びます,5 次)
    await screen.findByText("1 / 2");
    expect(screen.queryByText("〔公園で〜〕")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.getByText(/答錯 5 次/)).toBeInTheDocument();
    expect(screen.getByText("〔公園で〜〕")).toBeInTheDocument(); // 搭配 note

    await user.click(screen.getByRole("button", { name: "下一張" }));
    await screen.findByText("2 / 2");
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("書")).toBeInTheDocument();
    expect(screen.queryByText("読み物")).not.toBeInTheDocument(); // 段落標記不顯示

    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(await screen.findByText(/頑固卡練習完成/)).toBeInTheDocument();
  });

  it("發音鈕:以清理過的讀音朗讀(Web Speech 為 mock)", async () => {
    const synthSpeak = installSpeech();
    await db.cards.bulkAdd([leechCard("L13-V003", 5)]);
    const user = userEvent.setup();
    render(<PracticePage />);

    await screen.findByText("1 / 1");
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    await user.click(screen.getByRole("button", { name: "播放 おっと 的發音" }));
    expect(synthSpeak).toHaveBeenCalledTimes(1);
    expect(synthSpeak.mock.calls[0][0]).toMatchObject({ text: "おっと", lang: "ja-JP" });
  });

  it("設定 TTS 發音關閉:翻卡後沒有發音鈕,也不會朗讀", async () => {
    const synthSpeak = installSpeech();
    await setSetting("ttsEnabled", false);
    await db.cards.bulkAdd([leechCard("L13-V003", 5)]);
    const user = userEvent.setup();
    render(<PracticePage />);

    await screen.findByText("1 / 1");
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("丈夫")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /播放/ })).toHaveLength(0);
    expect(synthSpeak).not.toHaveBeenCalled();
  });

  it("回想卡:題面有詞性・課號,note 只在翻面後顯示", async () => {
    await db.cards.bulkAdd([{ ...leechCard("L13-V001@r", 5), direction: "rev" }]);
    const user = userEvent.setup();
    render(<PracticePage />);

    await screen.findByText("1 / 1");
    expect(screen.getByText("動I・第 13 課")).toBeInTheDocument();
    expect(screen.queryByText("〔公園で〜〕")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("〔公園で〜〕")).toBeInTheDocument();
  });
});
