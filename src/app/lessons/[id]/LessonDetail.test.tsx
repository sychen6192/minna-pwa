import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { db, getSetting, setSetting } from "@/lib/db";
import type { Lesson, VocabItem } from "@/schemas/lesson";

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: () => getLesson(),
}));

// 只替換 speak;speechText 等用真實實作(設定經真實 db.ts + fake-indexeddb)
const speak = vi.fn();
vi.mock("@/lib/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts")>()),
  speak: (text: string) => speak(text),
}));

const addCards = vi.fn();
const existingCardIds = vi.fn();
const setWordSuspended = vi.fn();
const suspendedWordIds = vi.fn();
vi.mock("@/lib/srs", () => ({
  addCards: (...a: unknown[]) => addCards(...a),
  existingCardIds: (...a: unknown[]) => existingCardIds(...a),
  setWordSuspended: (...a: unknown[]) => setWordSuspended(...a),
  suspendedWordIds: (...a: unknown[]) => suspendedWordIds(...a),
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
      accent: 2,
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

/** 含漢字、有 accent 的字(隱藏假名時重音列會洩漏讀音) */
const kuruma: VocabItem = {
  id: "L13-V003",
  ruby: [{ b: "車", r: "くるま" }],
  kana: "くるま",
  accent: 0,
  meaning: "車子",
  pos: "名",
};
/** kana 帶教材記號的字(朗讀文字需清理) */
const suki: VocabItem = {
  id: "L13-V004",
  ruby: [{ b: "好", r: "す" }, { b: "き［な］" }],
  kana: "すき［な］",
  accent: 2,
  meaning: "喜歡",
  pos: "な形",
};
const lessonWithKanjiPitch: Lesson = {
  ...sampleLesson,
  vocab: [...sampleLesson.vocab, kuruma, suki],
};

/** 是否曾經渲染出 <rt>(含隨即被移除者):用來檢查設定載入前沒有閃出 furigana */
function watchRt(): {
  container: HTMLDivElement;
  sawRt: () => boolean;
  stop: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let saw = false;
  const hasRt = (n: Node) =>
    n instanceof Element &&
    (n.nodeName === "RT" || n.querySelector("rt") !== null);
  const observer = new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes].some(hasRt))) saw = true;
  });
  observer.observe(container, { childList: true, subtree: true });
  return {
    container,
    sawRt: () => {
      if (hasRt(container)) saw = true;
      observer.takeRecords().forEach((r) => {
        if ([...r.addedNodes].some(hasRt)) saw = true;
      });
      return saw;
    },
    stop: () => observer.disconnect(),
  };
}

beforeEach(async () => {
  await db.settings.clear();
  existingCardIds.mockResolvedValue([]);
  suspendedWordIds.mockResolvedValue([]);
  setWordSuspended.mockResolvedValue(undefined);
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

  it("有 accent 的單字顯示重音標記,無 accent 者不顯示", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    // ほしい(accent: 2)→ 重音標記;あそびます(無 accent)→ 無標記
    expect(
      screen.getByLabelText("ほしい、重音 2 型(中高)"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/あそびます、重音/)).not.toBeInTheDocument();
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

  it("hash 文法錨點深連結(#L13-G01):自動切至文型分頁並捲動", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    // jsdom 未實作 scrollIntoView,stub 之
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = "#L13-G01";

    render(<LessonDetail id={13} />);

    expect(await screen.findByText("(名詞)が ほしいです")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文型" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // 文型分頁渲染後才捲動到該文法點
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect((scrollIntoView.mock.contexts[0] as Element).id).toBe("L13-G01");
    window.location.hash = "";
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

  it("單字發音鈕:點擊以該字 kana 呼叫 speak(去除教材記號,按鈕名稱與朗讀一致)", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(
      screen.getByRole("button", { name: "播放 あそびます 的發音" }),
    );
    expect(speak).toHaveBeenCalledWith("あそびます");
    await user.click(
      screen.getByRole("button", { name: "播放 すきな 的發音" }),
    );
    expect(speak).toHaveBeenLastCalledWith("すきな");
  });

  it("設定 TTS 發音關閉:不渲染任何發音鈕", async () => {
    await setSetting("ttsEnabled", false);
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    expect(
      screen.queryAllByRole("button", { name: /^播放 .* 的發音$/ }),
    ).toHaveLength(0);
    // 其餘操作照常
    expect(
      screen.getByRole("button", { name: "加入複習:あそびます" }),
    ).toBeInTheDocument();
  });

  it("TTS 預設開啟:每個字都有發音鈕", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    expect(
      screen.getAllByRole("button", { name: /^播放 .* 的發音$/ }),
    ).toHaveLength(4);
  });

  it("全域 furigana 設為隱藏:設定載入後才渲染內容,自始無 <rt>", async () => {
    await setSetting("furigana", "hide");
    getLesson.mockResolvedValue(sampleLesson);
    // 關閉連線:設定讀取須重新開 DB(數個 task),課程資料會先到 → 可測出未等設定就渲染的閃現
    db.close({ disableAutoOpen: false });
    const rt = watchRt();
    render(<LessonDetail id={13} />, { container: rt.container });
    await screen.findByText("玩、遊玩");

    expect(rt.container.querySelectorAll("rt")).toHaveLength(0);
    expect(rt.sawRt()).toBe(false);
    expect(screen.getByRole("button", { name: "顯示假名" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rt.stop();
  });

  it("全域隱藏時頁內可暫時顯示;頁內切換不寫回設定", async () => {
    await setSetting("furigana", "hide");
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    const { container } = render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("button", { name: "顯示假名" }));
    expect(container.querySelectorAll("rt").length).toBeGreaterThan(0);
    expect(await getSetting("furigana")).toBe("hide");
  });

  it("隱藏假名時:含漢字讀音的字不顯示重音讀音,純假名字照常", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    // 顯示假名:兩者皆有重音標記
    expect(
      screen.getByLabelText("くるま、重音 0 型(平板)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^すき［な］、重音 2 型/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("ほしい、重音 2 型(中高)"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "隱藏假名" }));
    expect(screen.queryByLabelText(/^くるま、重音/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^すき［な］、重音/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("くるま")).not.toBeInTheDocument(); // 讀音不以任何形式出現
    // 純假名字(ほしい)沒有可洩漏的讀音
    expect(
      screen.getByLabelText("ほしい、重音 2 型(中高)"),
    ).toBeInTheDocument();
  });

  it("全域隱藏時:首次渲染即不顯示含漢字字的重音讀音", async () => {
    await setSetting("furigana", "hide");
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    render(<LessonDetail id={13} />);
    await screen.findByText("車子");

    expect(screen.queryByLabelText(/^くるま、重音/)).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("ほしい、重音 2 型(中高)"),
    ).toBeInTheDocument();
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

  it("已加入的單字可標記已會(暫停),暫停者顯示恢復", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    existingCardIds.mockResolvedValue(["L13-V001"]);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByLabelText("あそびます 已加入複習");

    // 標記已會 → setWordSuspended(true)(以字為單位)→ 轉為恢復鈕
    await user.click(screen.getByRole("button", { name: "標記已會:あそびます" }));
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
    await user.click(await screen.findByRole("button", { name: "恢復複習:あそびます" }));
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", false);
  });

  it("已暫停的單字初始顯示恢復鈕(以字查詢暫停狀態)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    existingCardIds.mockResolvedValue(["L13-V001"]);
    suspendedWordIds.mockResolvedValue(["L13-V001"]);
    render(<LessonDetail id={13} />);

    expect(
      await screen.findByRole("button", { name: "恢復複習:あそびます" }),
    ).toBeInTheDocument();
    expect(suspendedWordIds).toHaveBeenCalledWith(["L13-V001", "L13-V002"]);
  });

  it("載入失敗顯示錯誤", async () => {
    getLesson.mockRejectedValue(new Error("HTTP 404"));
    render(<LessonDetail id={99} />);
    expect(
      await screen.findByText(/載入課程失敗.*HTTP 404/),
    ).toBeInTheDocument();
  });
});
