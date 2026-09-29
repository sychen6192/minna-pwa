import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { db, getSetting, setSetting } from "@/lib/db";
import type { Lesson, VocabItem } from "@/schemas/lesson";

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
const queueCounts = vi.fn();
vi.mock("@/lib/srs", () => ({
  addCards: (...a: unknown[]) => addCards(...a),
  existingCardIds: (...a: unknown[]) => existingCardIds(...a),
  queueCounts: (...a: unknown[]) => queueCounts(...a),
  setWordSuspended: (...a: unknown[]) => setWordSuspended(...a),
  suspendedWordIds: (...a: unknown[]) => suspendedWordIds(...a),
}));

import { cancelSpeech, VOICE_TIMEOUT_MS } from "@/lib/tts";
import { LessonDetail } from "./LessonDetail";

/** queueCounts 基底:今日佇列空、未達上限 */
const COUNTS = {
  due: 0,
  fresh: 0,
  newCapReached: false,
  newCapped: 0,
  newRemaining: 10,
  newToday: 0,
  newPerDay: 10,
  reviewCapReached: false,
};

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

/** 含段落標記 note 的課:補充單字(不整課加入)、読み物、会話,與一般搭配 note */
const withSections: Lesson = {
  ...sampleLesson,
  vocab: [
    { ...sampleLesson.vocab[0], note: "〔公園で〜〕" },
    sampleLesson.vocab[1],
    {
      id: "L13-V005",
      ruby: [{ b: "子", r: "こ" }, { b: "どもたち" }],
      kana: "こどもたち",
      meaning: "孩子們",
      pos: "名",
      note: "読み物",
    },
    {
      id: "L13-V006",
      ruby: [{ b: "ニューヨーク" }],
      kana: "ニューヨーク",
      meaning: "紐約",
      pos: "名",
      note: "補充單字(自行練習發音)",
    },
    {
      id: "L13-V007",
      ruby: [{ b: "家", r: "いえ" }],
      kana: "いえ",
      meaning: "家,房子",
      pos: "名",
      note: "会話",
    },
  ],
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

/** PitchAccent 的 sr-only 說明(「ほしい、重音 2 型(中高)」;中文說明不掛 aria-label) */
function isPitchLabel(el: Element | null, label: string | RegExp): boolean {
  if (!el?.classList.contains("sr-only")) return false;
  const text = el.textContent ?? "";
  return typeof label === "string" ? text === label : label.test(text);
}
function getPitchLabel(label: string | RegExp): HTMLElement {
  return screen.getByText((_, el) => isPitchLabel(el, label));
}
function queryPitchLabel(label: string | RegExp): HTMLElement | null {
  return screen.queryByText((_, el) => isPitchLabel(el, label));
}

/** 單字列(以釋義找) */
function vocabRow(meaning: string): HTMLElement {
  return screen.getByText(meaning).closest("li") as HTMLElement;
}

/** 畫面上看得到的文字(去除 sr-only) */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return clone.textContent ?? "";
}

beforeEach(async () => {
  await db.settings.clear();
  existingCardIds.mockResolvedValue([]);
  suspendedWordIds.mockResolvedValue([]);
  setWordSuspended.mockResolvedValue(undefined);
  addCards.mockImplementation(async (ids: string[]) => ids.length); // 回傳新加入的字數
  queueCounts.mockResolvedValue({ ...COUNTS, fresh: 2 }); // 加入後今日有新卡可學
  // 分頁與錨點存在 URL hash:每個測試從無 hash 開始
  window.history.replaceState(null, "", "/lessons/13");
  // jsdom 未實作 scrollIntoView / scrollTo
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** 把時鐘撥過列內換鈕後的點擊防護(300ms);之後 Date 停在 fake 時間 */
function passRowGuard() {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 1_000);
}

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
    expect(getPitchLabel("ほしい、重音 2 型(中高)")).toBeInTheDocument();
    expect(queryPitchLabel(/あそびます、重音/)).not.toBeInTheDocument();
  });

  it("純假名字(表面 = 讀音):重音標記即標題,假名只渲染一次", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    const row = (meaning: string) => screen.getByText(meaning).closest("li") as HTMLElement;
    // ほしい:只有重音標記那一份(舊版為 RubyText 標題 + 重音讀音兩份)
    const hoshii = row("想要");
    expect(visibleText(hoshii).match(/ほしい/g)).toHaveLength(1);
    expect(hoshii.querySelectorAll("[data-mora]")).toHaveLength(3);
    expect(hoshii.querySelector("ruby")).toBeNull();
    // 含漢字的字:RubyText 標題 + 重音讀音並列
    const kurumaRow = row("車子");
    expect(kurumaRow.querySelector("ruby")).not.toBeNull();
    expect(kurumaRow.querySelectorAll("[data-mora]")).toHaveLength(3);
  });

  it("日文標記 lang=ja:課名、分頁標籤、文型、会話說話者;中文說明的文型不標", async () => {
    getLesson.mockResolvedValue({
      ...sampleLesson,
      grammar: [
        ...sampleLesson.grammar,
        {
          id: "L13-G02",
          pattern: "動詞的活用",
          explanation: "中文說明的文型標題。",
          examples: sampleLesson.grammar[0].examples,
        },
      ],
    });
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    expect(screen.getByRole("heading", { name: "〜が ほしいです" })).toHaveAttribute("lang", "ja");
    for (const name of ["単語", "文型", "会話"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("lang", "ja");
    }
    // 單字標題(RubyText)
    expect(screen.getByText("遊").closest("[lang]")).toHaveAttribute("lang", "ja");

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(screen.getByRole("heading", { name: "(名詞)が ほしいです" })).toHaveAttribute(
      "lang",
      "ja",
    );
    expect(screen.getByRole("heading", { name: "動詞的活用" })).not.toHaveAttribute("lang");

    await user.click(screen.getByRole("button", { name: "会話" }));
    expect(screen.getByText("ミラー")).toHaveAttribute("lang", "ja");
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
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, "", "#L13-G01"); // 同 client 導覽(pushState),不觸發 hashchange

    render(<LessonDetail id={13} />);

    expect(await screen.findByText("(名詞)が ほしいです")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文型" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 文型分頁渲染後才捲動到該文法點(元素已在 DOM)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    const target = scrollIntoView.mock.contexts[0] as Element;
    expect(target.id).toBe("L13-G01");
    expect(target.isConnected).toBe(true);
    expect(target).toHaveClass("scroll-mt-[calc(2.75rem_+_1px)]"); // 讓出黏在頂端的分頁列
  });

  it("hashchange:頁面已開啟時改 hash 也切分頁並捲到錨點", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => {
      window.history.replaceState(null, "", "#L13-G01");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(screen.getByRole("button", { name: "文型" })).toHaveAttribute("aria-pressed", "true");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as Element).id).toBe("L13-G01");
  });

  it("單字錨點(#L13-V002,單字搜尋結果):留在単語分頁、捲到該字並短暫高亮", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    getLesson.mockResolvedValue(sampleLesson);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, "", "#L13-V002");

    render(<LessonDetail id={13} />);

    await screen.findByText("想要");
    const row = vocabRow("想要");
    expect(screen.getByRole("button", { name: "単語" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
    expect(row).toHaveAttribute("id", "L13-V002");
    expect(row).toHaveClass("scroll-mt-[calc(2.75rem_+_1px)]", "bg-link/10");
    // 其他列不高亮;約 2 秒後淡出
    expect(vocabRow("玩、遊玩")).not.toHaveClass("bg-link/10");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(row).not.toHaveClass("bg-link/10");
  });

  it("單字錨點等初始加入狀態讀到才捲動(列內鈕換寬會使上方列位移)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    let resolveExisting: (ids: string[]) => void = () => {};
    existingCardIds.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveExisting = resolve;
      }),
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, "", "#L13-V002");

    render(<LessonDetail id={13} />);
    await screen.findByText("想要");
    expect(screen.getByRole("button", { name: "単語" })).toHaveAttribute("aria-pressed", "true");
    expect(scrollIntoView).not.toHaveBeenCalled();

    await act(async () => resolveExisting(["L13-V001"]));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(vocabRow("想要"));
    // 捲動時列內鈕已是最終樣子
    expect(within(vocabRow("玩、遊玩")).getByText("已加入複習")).toBeInTheDocument();
  });

  it("分頁寫入 URL hash(replaceState,不新增歷史紀錄);帶 #dialogue 開啟時還原分頁", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    const { unmount } = render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    const length = window.history.length;

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(window.location.hash).toBe("#grammar");
    await user.click(screen.getByRole("button", { name: "会話" }));
    expect(window.location.hash).toBe("#dialogue");
    expect(window.location.pathname).toBe("/lessons/13");
    expect(window.history.length).toBe(length);

    // 返回本頁(重新掛載):依 hash 還原到会話分頁
    unmount();
    render(<LessonDetail id={13} />);
    expect(await screen.findByText("要不要去京都?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "会話" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
  });

  it("標頭連結:測驗本課、上一課、下一課(第 1 課無上一課、第 50 課無下一課)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const { unmount } = render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    const nav = screen.getByRole("navigation", { name: "課程導覽" });
    expect(within(nav).getByRole("link", { name: "測驗本課" })).toHaveAttribute("href", "/quiz/13");
    expect(within(nav).getByRole("link", { name: "上一課" })).toHaveAttribute("href", "/lessons/12");
    expect(within(nav).getByRole("link", { name: "下一課" })).toHaveAttribute("href", "/lessons/14");
    // 觸控區 ≥ 44px(buttonVariants size sm = h-11)
    for (const link of within(nav).getAllByRole("link")) expect(link).toHaveClass("h-11");
    unmount();

    getLesson.mockResolvedValue({ ...sampleLesson, id: 1 });
    const first = render(<LessonDetail id={1} />);
    await screen.findByText("玩、遊玩");
    expect(screen.queryByRole("link", { name: "上一課" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下一課" })).toHaveAttribute("href", "/lessons/2");
    first.unmount();

    getLesson.mockResolvedValue({ ...sampleLesson, id: 50 });
    render(<LessonDetail id={50} />);
    await screen.findByText("玩、遊玩");
    expect(screen.getByRole("link", { name: "上一課" })).toHaveAttribute("href", "/lessons/49");
    expect(screen.queryByRole("link", { name: "下一課" })).not.toBeInTheDocument();
  });

  it("切換到文型分頁:顯示文型、隱藏単語", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(screen.getByText("(名詞)が ほしいです")).toBeInTheDocument();
    expect(screen.getByText("我想要車子。")).toBeInTheDocument();
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
  });

  it("分頁為 aria-pressed 分段按鈕:一次只按下一個,不宣告 tab 語意", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    // 未實作 tabpanel 與方向鍵,就不宣告 tablist/tab(避免輔助技術期待不存在的行為)
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    const group = screen.getByRole("group", { name: "課程內容" });
    const pressed = () =>
      within(group)
        .getAllByRole("button")
        .map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    expect(pressed()).toEqual([
      ["単語", "true"],
      ["文型", "false"],
      ["会話", "false"],
    ]);

    await user.click(within(group).getByRole("button", { name: "会話" }));
    expect(pressed()).toEqual([
      ["単語", "false"],
      ["文型", "false"],
      ["会話", "true"],
    ]);
    expect(screen.getByText("要不要去京都?")).toBeInTheDocument();
  });

  it("切換到会話分頁:顯示說話者與翻譯", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("button", { name: "会話" }));
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

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(screen.getByText("本課沒有文型")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "会話" }));
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
    // 開關鈕名稱固定「假名」,狀態只看 aria-pressed(未按下 = 隱藏中)
    expect(screen.getByRole("button", { name: "假名" })).toHaveAttribute(
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

    await user.click(screen.getByRole("button", { name: "假名" }));
    expect(screen.getByRole("button", { name: "假名" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll("rt").length).toBeGreaterThan(0);
    expect(await getSetting("furigana")).toBe("hide");
  });

  it("隱藏假名時:含漢字讀音的字不顯示重音讀音,純假名字照常", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    // 顯示假名:兩者皆有重音標記(sr 讀音不含［］記號)
    expect(getPitchLabel("くるま、重音 0 型(平板)")).toBeInTheDocument();
    expect(getPitchLabel(/^すきな、重音 2 型/)).toBeInTheDocument();
    expect(getPitchLabel("ほしい、重音 2 型(中高)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "假名" }));
    expect(queryPitchLabel(/^くるま、重音/)).not.toBeInTheDocument();
    expect(queryPitchLabel(/^すきな、重音/)).not.toBeInTheDocument();
    expect(screen.queryByText("くるま")).not.toBeInTheDocument(); // 讀音不以任何形式出現
    expect(screen.queryByText(/くるま/)).not.toBeInTheDocument();
    // 純假名字(ほしい)沒有可洩漏的讀音
    expect(getPitchLabel("ほしい、重音 2 型(中高)")).toBeInTheDocument();
  });

  it("全域隱藏時:首次渲染即不顯示含漢字字的重音讀音", async () => {
    await setSetting("furigana", "hide");
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    render(<LessonDetail id={13} />);
    await screen.findByText("車子");

    expect(queryPitchLabel(/^くるま、重音/)).not.toBeInTheDocument();
    expect(getPitchLabel("ほしい、重音 2 型(中高)")).toBeInTheDocument();
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
    // 勾勾圖示旁的 sr-only 文字(不把 aria-label 掛在無語意的 span 上)
    expect(await within(vocabRow("玩、遊玩")).findByText("已加入複習")).toHaveClass("sr-only");
  });

  it("整課加入複習:以全部 id 呼叫 addCards,顯示新加入字數與「開始複習」並移焦點", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    // live region 先掛載(空),加入後才填入
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "整課加入複習" }));
    expect(addCards).toHaveBeenCalledWith(["L13-V001", "L13-V002"], 13);
    expect(
      await screen.findByRole("button", { name: "整課已加入" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("已加入 2 字 · 開始複習 →");
    expect(within(status).getByRole("link", { name: "開始複習 →" })).toHaveAttribute(
      "href",
      "/review",
    );
    // 按鈕變 disabled:焦點移到結果訊息(不掉到 body)
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("整課加入後今日新卡額度已用完:說明明天繼續,不給會落空的「開始複習」", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    queueCounts.mockResolvedValue({
      ...COUNTS,
      newCapReached: true,
      newCapped: 2,
      newRemaining: 0,
      newToday: 10,
    });
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("button", { name: "整課加入複習" }));
    const status = screen.getByRole("status");
    await waitFor(() =>
      expect(status).toHaveTextContent("已加入 2 字 · 今日新卡已達上限,明天繼續"),
    );
    expect(within(status).queryByRole("link")).not.toBeInTheDocument();
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("整課加入不含補充單字(按鈕註明字數);補充單字仍可單字加入;數量為實際新加入者", async () => {
    getLesson.mockResolvedValue(withSections);
    existingCardIds.mockResolvedValue(["L13-V001"]); // 已單字加入過
    addCards.mockResolvedValueOnce(3); // addCards 回報實際新建 3 字(V002、V005、V007)
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);

    await user.click(
      await screen.findByRole("button", { name: "整課加入複習(不含補充 1 字)" }),
    );
    expect(addCards).toHaveBeenCalledWith(
      ["L13-V001", "L13-V002", "L13-V005", "L13-V007"],
      13,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已加入 3 字");
    expect(screen.getByRole("button", { name: "整課已加入" })).toBeDisabled();
    // 補充單字未加入,單字加入鈕仍在
    await user.click(screen.getByRole("button", { name: "加入複習:ニューヨーク" }));
    expect(addCards).toHaveBeenLastCalledWith(["L13-V006"], 13);
  });

  it("段落標記 note(読み物/会話/補充單字)改顯示小徽章,其他 note 照常", async () => {
    getLesson.mockResolvedValue(withSections);
    render(<LessonDetail id={13} />);
    await screen.findByText("紐約");

    const badge = (meaning: string, label: string) =>
      within(vocabRow(meaning)).getByText(label, { selector: "span" });
    expect(badge("紐約", "補充")).not.toHaveAttribute("lang");
    expect(badge("孩子們", "読み物")).toHaveAttribute("lang", "ja");
    expect(badge("家,房子", "会話")).toHaveAttribute("lang", "ja");
    // 標記原文不再當註解出現(読み物 只剩徽章)
    expect(screen.queryByText("補充單字(自行練習發音)")).not.toBeInTheDocument();
    expect(screen.getAllByText("読み物")).toEqual([badge("孩子們", "読み物")]);
    // 一般 note(搭配)照常
    expect(within(vocabRow("玩、遊玩")).getByText("〔公園で〜〕")).toBeInTheDocument();
  });

  it("已加入的單字顯示已加入、不再顯示加入鈕", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    existingCardIds.mockResolvedValue(["L13-V001"]);
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    expect(await within(vocabRow("玩、遊玩")).findByText("已加入複習")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加入複習:あそびます" }),
    ).not.toBeInTheDocument();
  });

  it("已加入的單字可標記已會(暫停),暫停者顯示恢復", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    existingCardIds.mockResolvedValue(["L13-V001"]);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByRole("button", { name: "標記已會:あそびます" });

    // 標記已會 → setWordSuspended(true)(以字為單位)→ 轉為恢復鈕
    await user.click(screen.getByRole("button", { name: "標記已會:あそびます" }));
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
    const restore = await screen.findByRole("button", { name: "恢復複習:あそびます" });
    passRowGuard();
    await user.click(restore);
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", false);
  });

  it("連點兩下 +:第二下落在換上的「已會」也不生效(換鈕後 300ms 內忽略該列點擊)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    vi.useFakeTimers({ toFake: ["Date"] });
    await user.click(screen.getByRole("button", { name: "加入複習:あそびます" }));
    const known = await screen.findByRole("button", { name: "標記已會:あそびます" });
    await user.click(known); // 連點的第二下
    expect(setWordSuspended).not.toHaveBeenCalled();
    expect(within(vocabRow("玩、遊玩")).getByText("已加入複習")).toBeInTheDocument();

    // 其他列不受影響;同一列過了防護時間即可操作
    await user.click(screen.getByRole("button", { name: "加入複習:ほしい" }));
    expect(addCards).toHaveBeenLastCalledWith(["L13-V002"], 13);
    passRowGuard();
    await user.click(known);
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
  });

  it("鍵盤操作列內鈕:換鈕後焦點交給同一列的新鈕(不掉到 body)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    screen.getByRole("button", { name: "加入複習:あそびます" }).focus();
    await user.keyboard("{Enter}");
    expect(addCards).toHaveBeenCalledWith(["L13-V001"], 13);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "標記已會:あそびます" })).toHaveFocus(),
    );

    passRowGuard();
    await user.keyboard("{Enter}");
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "恢復複習:あそびます" })).toHaveFocus(),
    );
  });

  it("鍵盤按 + 時初始狀態才到:等換鈕那次才移焦點(焦點仍落在同一列的新鈕)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    let resolveExisting: (ids: string[]) => void = () => {};
    existingCardIds.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveExisting = resolve;
      }),
    );
    let resolveAdd: (n: number) => void = () => {};
    addCards.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    const plus = screen.getByRole("button", { name: "加入複習:あそびます" });
    plus.focus();
    await user.keyboard("{Enter}");
    expect(addCards).toHaveBeenCalledWith(["L13-V001"], 13);
    // 加入尚未完成時初始狀態先到(added 更新、但該列仍是 +):焦點留在 + 上
    await act(async () => resolveExisting([]));
    expect(plus).toHaveFocus();

    await act(async () => resolveAdd(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "標記已會:あそびます" })).toHaveFocus(),
    );
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

describe("LessonDetail 自我測驗與詞性篩選(T11.1)", () => {
  /** 単語分頁的「遮住」分段鈕 */
  const maskGroup = () => screen.getByRole("group", { name: "遮住" });
  const maskButton = (name: "無" | "中文" | "日文") =>
    within(maskGroup()).getByRole("button", { name });
  const chips = () => screen.getByRole("group", { name: "詞性篩選" });
  const pressedChips = () =>
    within(chips())
      .getAllByRole("button")
      .map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
  /** 單字列表(不含課名等標頭文字) */
  const vocabList = () => screen.getByRole("list");

  it("遮住:無/中文/日文 為 aria-pressed 分段鈕(預設無),觸控區 ≥ 44px", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    const state = () =>
      within(maskGroup())
        .getAllByRole("button")
        .map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    expect(state()).toEqual([
      ["無", "true"],
      ["中文", "false"],
      ["日文", "false"],
    ]);
    for (const b of within(maskGroup()).getAllByRole("button")) {
      expect(b).toHaveClass("h-11", "min-w-11");
    }
    // 不遮時沒有揭示鈕、也沒有「全部顯示」
    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "全部顯示" })).not.toBeInTheDocument();

    await user.click(maskButton("中文"));
    expect(state()).toEqual([
      ["無", "false"],
      ["中文", "true"],
      ["日文", "false"],
    ]);
  });

  it("遮中文:釋義與 note 不在無障礙樹中,點擊揭示(aria-expanded)、再點遮回", async () => {
    getLesson.mockResolvedValue(withSections);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(maskButton("中文"));
    // 釋義與 note(常含中文釋義)都不渲染;段落徽章仍在
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
    expect(screen.queryByText("〔公園で〜〕")).not.toBeInTheDocument();
    expect(vocabList().textContent).not.toMatch(/玩|想要|孩子們|紐約/);
    const reveal = screen.getByRole("button", { name: "顯示中文:あそびます" });
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(reveal).toHaveTextContent("顯示中文"); // 看得到的佔位文字是名稱開頭
    expect(reveal).toHaveClass("min-w-11", "-my-3", "py-3"); // 點擊區 44px、列高不變
    // 標題字、讀音與發音鈕照常
    expect(screen.getByText("遊")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放 あそびます 的發音" })).toBeInTheDocument();

    await user.click(reveal);
    expect(reveal).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "玩、遊玩", expanded: true })).toBe(reveal);
    expect(screen.getByText("〔公園で〜〕")).toBeInTheDocument(); // 揭示後 note 一起出現
    // 其他字仍遮住
    expect(screen.queryByText("想要")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "顯示中文:ほしい" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await user.click(reveal);
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
  });

  it("鍵盤揭示:Enter 揭示、Space 遮回,焦點留在同一顆鈕", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    await user.click(maskButton("中文"));

    const reveal = screen.getByRole("button", { name: "顯示中文:ほしい" });
    reveal.focus();
    await user.keyboard("{Enter}");
    expect(reveal).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("想要")).toBeInTheDocument();
    expect(reveal).toHaveFocus();

    await user.keyboard(" ");
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("想要")).not.toBeInTheDocument();
    expect(reveal).toHaveFocus();
  });

  it("遮日文:標題字、讀音、重音與 note 都不渲染,列內鈕改以釋義命名;發音鈕保留(聽音回想)", async () => {
    getLesson.mockResolvedValue({
      ...lessonWithKanjiPitch,
      vocab: lessonWithKanjiPitch.vocab.map((v) =>
        v.id === "L13-V001" ? { ...v, note: "〔公園で〜〕" } : v,
      ),
    });
    const user = userEvent.setup();
    const { container } = render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(maskButton("日文"));
    const list = vocabList();
    // 文字與屬性(aria-label)都不含答案:讀音、重音說明、note 的日文搭配
    for (const answer of ["あそびます", "ほしい", "くるま", "すき", "公園"]) {
      expect(list.innerHTML).not.toContain(answer);
    }
    // 標題字(含漢字者為 <ruby>;釋義「玩、遊玩」「車子」本身含同一個漢字,不以字面比對)
    expect(list.querySelector("ruby")).toBeNull();
    expect(list.querySelectorAll("[lang=ja]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-mora]")).toHaveLength(0);
    // 釋義照常顯示
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入複習:玩、遊玩" })).toBeInTheDocument();

    // 發音鈕仍在(名稱不洩漏讀音),朗讀該字
    const speakers = screen.getAllByRole("button", { name: /^播放發音:/ });
    expect(speakers).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "播放發音:車子" }));
    expect(speak).toHaveBeenCalledWith("くるま");

    // 揭示:標題字、重音讀音、note 出現,列內鈕名稱回到讀音
    const reveal = screen.getByRole("button", { name: "顯示日文:車子" });
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(reveal).toHaveClass("min-w-11", "-my-2", "py-2", "mr-1.5"); // 不被發音鈕的點擊區蓋到
    await user.click(reveal);
    expect(reveal).toHaveAttribute("aria-expanded", "true");
    expect(within(reveal).getByText("車")).toBeInTheDocument();
    expect(getPitchLabel("くるま、重音 0 型(平板)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入複習:くるま" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放 くるま 的發音" })).toBeInTheDocument();
    // 其他字仍遮住
    expect(list.innerHTML).not.toContain("あそびます");

    // 純假名字(重音標記即標題)同樣藏在揭示鈕內
    await user.click(screen.getByRole("button", { name: "顯示日文:想要" }));
    expect(getPitchLabel("ほしい、重音 2 型(中高)").closest("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // note 隨揭示出現
    await user.click(screen.getByRole("button", { name: "顯示日文:玩、遊玩" }));
    expect(screen.getByText("〔公園で〜〕")).toBeInTheDocument();
  });

  it("切換遮罩時揭示狀態重來;全部顯示 ⇄ 重新遮住;換分頁回來保留遮罩", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(maskButton("中文"));
    await user.click(screen.getByRole("button", { name: "顯示中文:あそびます" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();

    // 換到遮日文再回來:先前揭示的不沿用
    await user.click(maskButton("日文"));
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(2);
    await user.click(maskButton("中文"));
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(2);

    // 全部顯示 → 按鈕改為重新遮住
    await user.click(screen.getByRole("button", { name: "全部顯示" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.getByText("想要")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "重新遮住" }));
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "全部顯示" })).toBeInTheDocument();

    // 換分頁再回來:遮罩模式保留(本頁 state),揭示狀態重新開始
    await user.click(screen.getByRole("button", { name: "顯示中文:ほしい" }));
    await user.click(screen.getByRole("button", { name: "文型" }));
    await user.click(screen.getByRole("button", { name: "単語" }));
    expect(maskButton("中文")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("想要")).not.toBeInTheDocument();

    // 回到「無」:全部照常顯示,不寫入任何設定
    await user.click(maskButton("無"));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部顯示" })).not.toBeInTheDocument();
    expect(await db.settings.count()).toBe(0);
  });

  it("詞性篩選 chips:只列有字的組並顯示字數,篩選保留原順序", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch); // 動I、い形、名、な形
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    // 其他(0 字)不顯示
    expect(pressedChips()).toEqual([
      ["全部 4", "true"],
      ["名詞 1", "false"],
      ["動詞 1", "false"],
      ["形容詞 2", "false"],
    ]);
    for (const b of within(chips()).getAllByRole("button")) expect(b).toHaveClass("h-11");

    await user.click(within(chips()).getByRole("button", { name: "形容詞 2" }));
    expect(pressedChips()).toEqual([
      ["全部 4", "false"],
      ["名詞 1", "false"],
      ["動詞 1", "false"],
      ["形容詞 2", "true"],
    ]);
    expect(
      within(vocabList())
        .getAllByRole("listitem")
        .map((li) => li.id),
    ).toEqual(["L13-V002", "L13-V004"]);
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();

    await user.click(within(chips()).getByRole("button", { name: "名詞 1" }));
    expect(within(vocabList()).getAllByRole("listitem").map((li) => li.id)).toEqual(["L13-V003"]);
    await user.click(within(chips()).getByRole("button", { name: "全部 4" }));
    expect(within(vocabList()).getAllByRole("listitem")).toHaveLength(4);
  });

  it("篩選與遮罩並用:逐字揭示的狀態跨篩選保留", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(within(chips()).getByRole("button", { name: "動詞 1" }));
    await user.click(maskButton("中文"));
    // 只剩動詞一列、一顆揭示鈕
    expect(screen.getAllByRole("button", { expanded: false })).toEqual([
      screen.getByRole("button", { name: "顯示中文:あそびます" }),
    ]);
    await user.click(screen.getByRole("button", { name: "顯示中文:あそびます" }));
    // 此組已全部顯示 → 重新遮住
    expect(screen.getByRole("button", { name: "重新遮住" })).toBeInTheDocument();

    await user.click(within(chips()).getByRole("button", { name: "全部 4" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument(); // 剛才揭示的仍揭示
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "全部顯示" })).toBeInTheDocument();

    // 遮日文 + 形容詞:兩列標題字都遮住,其他列不渲染
    await user.click(maskButton("日文"));
    await user.click(within(chips()).getByRole("button", { name: "形容詞 2" }));
    expect(
      screen.getAllByRole("button", { expanded: false }).map((b) => b.getAttribute("aria-label")),
    ).toEqual(["顯示日文:想要", "顯示日文:喜歡"]);
    expect(screen.queryByText("車子")).not.toBeInTheDocument();
  });

  it("篩選中的全部顯示/重新遮住只作用於篩出的字:其他組不先揭示、也不被遮回", async () => {
    getLesson.mockResolvedValue(lessonWithKanjiPitch); // 動I、い形、名、な形
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    const collapsed = () =>
      screen.queryAllByRole("button", { expanded: false }).map((b) => b.getAttribute("aria-label"));

    await user.click(maskButton("中文"));
    await user.click(screen.getByRole("button", { name: "顯示中文:あそびます" })); // 動詞逐字揭示

    // 形容詞組:全部顯示只揭示這兩字
    await user.click(within(chips()).getByRole("button", { name: "形容詞 2" }));
    await user.click(screen.getByRole("button", { name: "全部顯示" }));
    expect(screen.getByText("想要")).toBeInTheDocument();
    expect(screen.getByText("喜歡")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新遮住" })).toBeInTheDocument();

    // 還沒測的名詞仍遮住;動詞維持逐字揭示;按鈕依全部的字判定
    await user.click(within(chips()).getByRole("button", { name: "全部 4" }));
    expect(collapsed()).toEqual(["顯示中文:くるま"]);
    expect(screen.queryByText("車子")).not.toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部顯示" })).toBeInTheDocument();

    // 形容詞組重新遮住:只遮回這兩字,動詞仍揭示
    await user.click(within(chips()).getByRole("button", { name: "形容詞 2" }));
    await user.click(screen.getByRole("button", { name: "重新遮住" }));
    expect(collapsed()).toEqual(["顯示中文:ほしい", "顯示中文:すき［な］"]);
    await user.click(within(chips()).getByRole("button", { name: "全部 4" }));
    expect(collapsed()).toEqual([
      "顯示中文:ほしい",
      "顯示中文:くるま",
      "顯示中文:すき［な］",
    ]);
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
  });

  it("篩選中整課加入仍加入整課(不含補充單字),不只篩出的組", async () => {
    getLesson.mockResolvedValue(withSections);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(within(chips()).getByRole("button", { name: /^動詞/ }));
    await user.click(screen.getByRole("button", { name: "整課加入複習(不含補充 1 字)" }));
    expect(addCards).toHaveBeenCalledWith(
      ["L13-V001", "L13-V002", "L13-V005", "L13-V007"],
      13,
    );
  });

  it("單字錨點遇到篩選:回到全部再捲動(目標字不在篩出的組)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(within(chips()).getByRole("button", { name: "動詞 1" }));
    expect(screen.queryByText("想要")).not.toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, "", "#L13-V002");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(vocabRow("想要"));
    expect(within(chips()).getByRole("button", { name: "全部 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("遮日文時列內鈕的連點防護照常(換鈕後 300ms 內忽略該列點擊)", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    await user.click(maskButton("日文"));

    vi.useFakeTimers({ toFake: ["Date"] });
    await user.click(screen.getByRole("button", { name: "加入複習:玩、遊玩" }));
    expect(addCards).toHaveBeenCalledWith(["L13-V001"], 13);
    const known = await screen.findByRole("button", { name: "標記已會:玩、遊玩" });
    await user.click(known); // 連點的第二下
    expect(setWordSuspended).not.toHaveBeenCalled();
    passRowGuard();
    await user.click(known);
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
  });

  it("隱藏中譯:文型與会話共用開關(aria-pressed),逐句點擊揭示", async () => {
    getLesson.mockResolvedValue(sampleLesson);
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    // 単語分頁沒有這顆開關
    expect(screen.queryByRole("button", { name: "隱藏中譯" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文型" }));
    const toggle = screen.getByRole("button", { name: "隱藏中譯" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("我想要車子。")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("我想要車子。")).not.toBeInTheDocument();
    // 文型說明(中文解說)不算中譯,照常顯示
    expect(screen.getByText("表達想要某物。")).toBeInTheDocument();
    const reveal = screen.getByRole("button", { name: "顯示中譯" });
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(reveal).toHaveClass("min-w-11", "-mt-5", "pt-5", "-mb-2", "pb-2"); // 20 + 16 + 8 = 44px
    await user.click(reveal);
    expect(screen.getByRole("button", { name: "我想要車子。", expanded: true })).toBe(reveal);
    // 揭示後點擊區不再往上蓋到例句的日文字(長按查字)
    expect(reveal).toHaveClass("-mt-2", "pt-2", "-mb-2", "pb-2");
    expect(reveal).not.toHaveClass("-mt-5");

    // 会話:開關狀態共用
    await user.click(screen.getByRole("button", { name: "会話" }));
    expect(screen.getByRole("button", { name: "隱藏中譯" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("要不要去京都?")).not.toBeInTheDocument();
    expect(screen.getByText("ミラー")).toBeInTheDocument(); // 說話者照常
    const line = screen.getByRole("button", { name: "顯示中譯" });
    line.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("要不要去京都?")).toBeInTheDocument();
    expect(line).toHaveFocus();

    // 關閉開關:全部顯示;再開:重新遮住(不沿用先前揭示)
    await user.click(screen.getByRole("button", { name: "隱藏中譯" }));
    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);
    expect(screen.getByText("要不要去京都?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "隱藏中譯" }));
    expect(screen.queryByText("要不要去京都?")).not.toBeInTheDocument();
  });

  it("文型/会話為空時不顯示隱藏中譯開關", async () => {
    getLesson.mockResolvedValue({ ...sampleLesson, grammar: [], dialogues: [] });
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(screen.getByText("本課沒有文型")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "隱藏中譯" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "会話" }));
    expect(screen.queryByRole("button", { name: "隱藏中譯" })).not.toBeInTheDocument();
  });
});

describe("LessonDetail 会話朗讀與角色扮演(T11.2)", () => {
  /** 含標題行(L24 寫法:speaker「標題」)與兩位說話者的会話 */
  const dialogueLesson: Lesson = {
    ...sampleLesson,
    id: 24,
    dialogues: [
      {
        id: "L24-D01",
        speaker: "標題",
        ruby: [{ b: "手伝", r: "てつだ" }, { b: "って くれますか" }],
        translation: "可以幫我嗎",
      },
      {
        id: "L24-D02",
        speaker: "カリナ",
        ruby: [{ b: "あした 引", r: "ひ" }, { b: "っ越しですね。" }],
        translation: "明天要搬家對吧。",
      },
      {
        id: "L24-D03",
        speaker: "ワン",
        ruby: [{ b: "ありがとう ございます。" }],
        translation: "謝謝你。",
      },
      {
        id: "L24-D04",
        speaker: "カリナ",
        ruby: [{ b: "車", r: "くるま" }, { b: "は?" }],
        translation: "車子呢?",
      },
      {
        id: "L24-D05",
        speaker: "ワン",
        ruby: [{ b: "えーと……。" }],
        translation: "嗯……。",
      },
    ],
  };

  /** 假的 Utterance:事件由測試觸發(模擬引擎讀完一句) */
  class FakeUtterance {
    text: string;
    lang = "";
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  /** 安裝有日語 voice 的 speechSynthesis(無頭環境沒有語音;全部播放/扮演需要它) */
  function installVoice(lang = "ja-JP") {
    /** 語音清單(測試可清空再補上,模擬晚到) */
    const voices = [{ lang, name: "Kyoko", localService: true }];
    const synth = Object.assign(new EventTarget(), {
      getVoices: vi.fn(() => voices),
      speak: vi.fn(),
      cancel: vi.fn(),
    });
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    return {
      synth,
      voices,
      /** 已送出朗讀的文字(依序) */
      spoken: () => synth.speak.mock.calls.map(([u]) => (u as FakeUtterance).text),
      /** 引擎讀完目前這句 */
      finish: () =>
        act(() => {
          (synth.speak.mock.lastCall?.[0] as FakeUtterance).onend?.();
        }),
    };
  }

  /** 台詞列(以中譯找) */
  const line = (translation: string) => screen.getByText(translation).closest("li") as HTMLElement;
  const currentLines = () =>
    screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
  /** jsdom 沒有版面:指定台詞列在視窗中的位置(高 100px) */
  const placeLine = (translation: string, top: number) => {
    vi.spyOn(line(translation), "getBoundingClientRect").mockReturnValue({
      top,
      bottom: top + 100,
    } as DOMRect);
  };

  async function openDialogue(lesson: Lesson = dialogueLesson) {
    getLesson.mockResolvedValue(lesson);
    const user = userEvent.setup();
    render(<LessonDetail id={lesson.id} />);
    await screen.findByText("玩、遊玩");
    await user.click(screen.getByRole("button", { name: "会話" }));
    return user;
  }

  afterEach(() => {
    cancelSpeech(); // 不把進行中的序列留給下一個測試
    vi.unstubAllGlobals();
  });

  it("標題行顯示為台詞上方的小標,不當說話者台詞;每句台詞有發音鈕(清理後的文字)", async () => {
    installVoice();
    const user = await openDialogue();

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("手伝てつだって くれますか");
    expect(within(heading).getByText("手伝").closest("[lang]")).toHaveAttribute("lang", "ja");
    expect(screen.getByText("可以幫我嗎")).toBeInTheDocument();
    // 「標題」不是說話者,標題不在台詞列表中、也不能扮演
    expect(screen.queryByText("標題")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    const buttons = screen.getAllByRole("button", { name: /^播放 .* 的台詞$/ });
    expect(buttons).toHaveLength(4);
    await user.click(within(line("嗯……。")).getByRole("button", { name: "播放 ワン 的台詞" }));
    expect(speak).toHaveBeenCalledWith("えーと。"); // …… 不送進 TTS
  });

  it("全部播放:跳過標題依序朗讀,目前句高亮並捲入畫面,讀完回到待機", async () => {
    const { spoken, finish } = installVoice();
    const user = await openDialogue();

    // 第一句在視窗(jsdom 高 768)下方、第二句已在視窗內
    placeLine("明天要搬家對吧。", 900);
    placeLine("謝謝你。", 100);
    await user.click(await screen.findByRole("button", { name: "全部播放" }));
    expect(spoken()).toEqual(["あした 引っ越しですね。"]);
    expect(currentLines()).toEqual([line("明天要搬家對吧。")]);
    expect(line("明天要搬家對吧。")).toHaveClass("bg-link/10");
    // 捲到整句剛好可見(下緣 1000 對齊視窗下緣 768)
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 232, behavior: "smooth" });
    // 同一顆鈕變成停止(焦點不動)
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();

    await finish();
    expect(spoken()).toEqual(["あした 引っ越しですね。", "ありがとう ございます。"]);
    expect(currentLines()).toEqual([line("謝謝你。")]);
    expect(window.scrollTo).toHaveBeenCalledTimes(1); // 已在畫面內:不捲

    await finish();
    await finish();
    expect(spoken()).toHaveLength(4);
    expect(currentLines()).toEqual([line("嗯……。")]);
    await finish();
    expect(currentLines()).toEqual([]);
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
  });

  it("停止:取消朗讀、清除高亮;減少動態效果時不平滑捲動", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" })),
    );
    const { synth, spoken, finish } = installVoice();
    const user = await openDialogue();

    placeLine("明天要搬家對吧。", -50); // 在視窗上方
    await user.click(await screen.findByRole("button", { name: "全部播放" }));
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: -50, behavior: "auto" });
    synth.cancel.mockClear();
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(currentLines()).toEqual([]);
    // 取消後引擎補發的 onend 不會接著讀下一句
    await finish();
    expect(spoken()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
  });

  it("其他朗讀中斷播放(點另一句的發音鈕、離開頁面的 cancelSpeech):回到待機", async () => {
    // 這次點擊用真實的 speak:與 speakSequence 共用 tts 模組狀態,才會中斷序列
    // (Once:clearAllMocks 不重設實作,不留給其他測試)
    const actual = await vi.importActual<typeof import("@/lib/tts")>("@/lib/tts");
    speak.mockImplementationOnce((text: string) => actual.speak(text));
    const { spoken, finish } = installVoice();
    const user = await openDialogue();
    await user.click(await screen.findByRole("button", { name: "全部播放" }));
    expect(currentLines()).toEqual([line("明天要搬家對吧。")]);

    await user.click(within(line("車子呢?")).getByRole("button", { name: "播放 カリナ 的台詞" }));
    expect(spoken()).toEqual(["あした 引っ越しですね。", "車は?"]);
    expect(currentLines()).toEqual([]);
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
    await finish(); // 單句讀完:不會接著播放会話
    expect(spoken()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "全部播放" }));
    expect(currentLines()).toHaveLength(1);
    act(() => cancelSpeech());
    expect(currentLines()).toEqual([]);
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
  });

  it("播放中目前句的發音鈕換成停止鈕(工具列捲出畫面時也能停);鍵盤停止後焦點留在該列", async () => {
    const { synth, finish } = installVoice();
    const user = await openDialogue();
    await user.click(await screen.findByRole("button", { name: "全部播放" }));

    const first = line("明天要搬家對吧。");
    expect(within(first).getByRole("button", { name: "停止播放" })).toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: /的台詞$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "停止播放" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /的台詞$/ })).toHaveLength(3);

    await finish();
    const second = line("謝謝你。");
    expect(within(first).getByRole("button", { name: "播放 カリナ 的台詞" })).toBeInTheDocument();
    const stopLine = within(second).getByRole("button", { name: "停止播放" });
    synth.cancel.mockClear();
    stopLine.focus();
    await user.keyboard("{Enter}");
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(currentLines()).toEqual([]);
    expect(second).toHaveFocus();
    expect(within(second).getByRole("button", { name: "播放 ワン 的台詞" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
  });

  it("使用者把畫面捲離目前句時不拉回;捲回後恢復跟隨,輪到扮演的台詞一律捲入", async () => {
    const { finish } = installVoice();
    const user = await openDialogue();
    placeLine("明天要搬家對吧。", 100);
    await user.click(await screen.findByRole("button", { name: "全部播放" }));
    expect(window.scrollTo).not.toHaveBeenCalled(); // 已在畫面內

    // 使用者往下捲(第一句捲出上緣),下一句在視窗下方:不拉回
    placeLine("明天要搬家對吧。", -500);
    placeLine("謝謝你。", 900);
    await finish();
    expect(currentLines()).toEqual([line("謝謝你。")]);
    expect(window.scrollTo).not.toHaveBeenCalled();

    // 捲回看得到目前句:恢復跟隨
    placeLine("謝謝你。", 300);
    placeLine("車子呢?", 900);
    await finish();
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 232, behavior: "smooth" });

    // 扮演:輪到自己的台詞(要按「下一句」)時,即使捲離了也捲入
    await user.click(screen.getByRole("button", { name: "停止" }));
    await user.click(
      within(screen.getByRole("group", { name: "扮演" })).getByRole("button", { name: "ワン" }),
    );
    vi.mocked(window.scrollTo).mockClear();
    placeLine("明天要搬家對吧。", 100);
    await user.click(screen.getByRole("button", { name: "全部播放" }));
    placeLine("明天要搬家對吧。", -500);
    placeLine("謝謝你。", 900);
    await finish();
    expect(screen.getByRole("button", { name: "下一句" })).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 232, behavior: "smooth" });
  });

  it("剛自動捲動過(短句讀完時平滑捲動還沒把上一句捲入)不算捲離,照樣跟隨;捲動穩定後才判斷", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { finish } = installVoice();
      const user = await openDialogue();
      placeLine("明天要搬家對吧。", 900); // 在視窗下方:開始播放時捲入
      await user.click(await screen.findByRole("button", { name: "全部播放" }));
      expect(window.scrollTo).toHaveBeenCalledTimes(1);

      // 200ms 後就讀完:平滑捲動還在進行,第一句仍在視窗下方
      now = 200;
      placeLine("謝謝你。", 1000);
      await finish();
      expect(currentLines()).toEqual([line("謝謝你。")]);
      expect(window.scrollTo).toHaveBeenCalledTimes(2);

      // 捲動穩定後,使用者把上一句捲出畫面:不拉回
      now = 2000;
      placeLine("謝謝你。", -500);
      placeLine("車子呢?", 900);
      await finish();
      expect(currentLines()).toEqual([line("車子呢?")]);
      expect(window.scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("直接開啟 #dialogue 且語音清單晚到:查好語音才渲染会話,播放鈕不晚出現推擠台詞", async () => {
    const { synth, voices } = installVoice();
    const kyoko = voices.splice(0); // 清單尚未載入
    window.history.replaceState(null, "", "#dialogue");
    getLesson.mockResolvedValue(dialogueLesson);
    render(<LessonDetail id={24} />);

    expect(await screen.findByRole("button", { name: "会話" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("載入中");
    expect(screen.queryByText("明天要搬家對吧。")).not.toBeInTheDocument();

    voices.push(...kyoko);
    act(() => {
      synth.dispatchEvent(new Event("voiceschanged"));
    });
    expect(await screen.findByText("明天要搬家對吧。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
  });

  it("語音清單在逾時後才到(voiceschanged):全部播放與扮演隨即出現", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { synth, voices } = installVoice();
      const kyoko = voices.splice(0);
      await openDialogue();
      await act(() => vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS));
      expect(await screen.findByText("明天要搬家對吧。")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "全部播放" })).not.toBeInTheDocument();

      voices.push(...kyoko);
      act(() => {
        synth.dispatchEvent(new Event("voiceschanged"));
      });
      expect(await screen.findByRole("button", { name: "全部播放" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "扮演" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("扮演的說話者在換分頁後保留(同隱藏中譯)", async () => {
    installVoice();
    const user = await openDialogue();
    await user.click(
      within(await screen.findByRole("group", { name: "扮演" })).getByRole("button", {
        name: "ワン",
      }),
    );
    await user.click(screen.getByRole("button", { name: "文型" }));
    await user.click(screen.getByRole("button", { name: "会話" }));

    const roles = await screen.findByRole("group", { name: "扮演" });
    expect(within(roles).getByRole("button", { name: "ワン" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("button", { name: /^顯示台詞/ })).toHaveLength(2);
  });

  it("換分頁時停止播放", async () => {
    const { synth } = installVoice();
    const user = await openDialogue();
    await user.click(await screen.findByRole("button", { name: "全部播放" }));
    synth.cancel.mockClear();

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(synth.cancel).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "会話" }));
    expect(await screen.findByRole("button", { name: "全部播放" })).toBeInTheDocument();
    expect(currentLines()).toEqual([]);
  });

  it("扮演:所選角色的台詞遮住(中譯作為提示),播到時暫停等「下一句」,繼續後揭示", async () => {
    const { spoken, finish } = installVoice();
    const user = await openDialogue();

    const roles = await screen.findByRole("group", { name: "扮演" });
    // 說話者依出現順序,不含標題
    expect(within(roles).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "カリナ",
      "ワン",
    ]);
    const wang = within(roles).getByRole("button", { name: "ワン" });
    expect(wang).toHaveAttribute("aria-pressed", "false");
    expect(wang).toHaveAttribute("lang", "ja");
    await user.click(wang);
    expect(wang).toHaveAttribute("aria-pressed", "true");

    // ワン 的台詞遮住:日文不渲染、不給發音鈕;中譯照常(開口的提示);標示「你」
    expect(screen.queryByText("ありがとう ございます。")).not.toBeInTheDocument();
    // 名稱帶看得到的中譯,各句可分辨
    expect(within(line("謝謝你。")).getByRole("button", { name: "顯示台詞:謝謝你。" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(line("謝謝你。")).getByText("你")).toBeInTheDocument();
    expect(
      within(line("謝謝你。")).queryByRole("button", { name: /的台詞$/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^顯示台詞/ })).toHaveLength(2);
    // カリナ 的台詞照常
    expect(screen.getByText("明天要搬家對吧。").closest("li")).toHaveTextContent("あした");

    await user.click(screen.getByRole("button", { name: "全部播放" }));
    expect(spoken()).toEqual(["あした 引っ越しですね。"]);
    await finish();
    // 輪到 ワン:不朗讀,停在該句並顯示「下一句」;焦點移到「下一句」(鍵盤可直接繼續)
    expect(spoken()).toHaveLength(1);
    expect(currentLines()).toEqual([line("謝謝你。")]);
    const next = within(line("謝謝你。")).getByRole("button", { name: "下一句" });
    expect(next).toHaveFocus();

    await user.keyboard("{Enter}");
    // 揭示該句,繼續朗讀下一句;焦點停放在剛說完的台詞列(不在停止鈕上:再按 Enter 不會誤停)
    expect(within(line("謝謝你。")).getByText("ありがとう ございます。")).toBeInTheDocument();
    expect(spoken()).toEqual(["あした 引っ越しですね。", "車は?"]);
    expect(line("謝謝你。")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "下一句" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}"); // 焦點在台詞列上:不影響播放
    expect(currentLines()).toEqual([line("車子呢?")]);

    await finish();
    // 最後一句是自己的:按鈕為「完成」(焦點從台詞列移回),按下後結束
    expect(currentLines()).toEqual([line("嗯……。")]);
    expect(screen.getByRole("button", { name: "完成" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(currentLines()).toEqual([]);
    expect(spoken()).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: /^顯示台詞/ })).toHaveLength(0);

    // 重新播放:再遮住
    await user.click(screen.getByRole("button", { name: "全部播放" }));
    expect(screen.getAllByRole("button", { name: /^顯示台詞/ })).toHaveLength(2);
  });

  it("扮演:第一句就是自己的台詞時直接暫停;點佔位可先偷看,換角色或取消扮演時重來", async () => {
    const { spoken } = installVoice();
    const user = await openDialogue();
    const roles = await screen.findByRole("group", { name: "扮演" });
    await user.click(within(roles).getByRole("button", { name: "カリナ" }));

    await user.click(screen.getByRole("button", { name: "全部播放" }));
    expect(spoken()).toEqual([]);
    expect(currentLines()).toEqual([line("明天要搬家對吧。")]);
    expect(screen.getByRole("button", { name: "下一句" })).toBeInTheDocument();

    // 偷看另一句:點佔位揭示(鍵盤操作時焦點交給同一句的下一顆鈕)
    const peek = within(line("車子呢?")).getByRole("button", { name: /^顯示台詞/ });
    peek.focus();
    await user.keyboard("{Enter}");
    expect(within(line("車子呢?")).getByText("車")).toBeInTheDocument();
    expect(within(line("車子呢?")).getByRole("button", { name: "播放 カリナ 的台詞" })).toHaveFocus();

    // 換角色:停止播放、揭示狀態重來
    await user.click(within(roles).getByRole("button", { name: "ワン" }));
    expect(currentLines()).toEqual([]);
    expect(screen.getByRole("button", { name: "全部播放" })).toBeInTheDocument();
    expect(within(roles).getByRole("button", { name: "カリナ" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("車子呢?").closest("li")).toHaveTextContent("車");
    expect(screen.getAllByRole("button", { name: /^顯示台詞/ })).toHaveLength(2);

    // 再按一次取消扮演:全部顯示
    await user.click(within(roles).getByRole("button", { name: "ワン" }));
    expect(screen.queryAllByRole("button", { name: /^顯示台詞/ })).toHaveLength(0);
  });

  it("扮演 × 隱藏中譯:被遮台詞的中譯也不顯示(不另給揭示鈕);揭示台詞後同其他句可點擊揭示", async () => {
    installVoice();
    const user = await openDialogue();
    await user.click(
      within(await screen.findByRole("group", { name: "扮演" })).getByRole("button", {
        name: "ワン",
      }),
    );
    await user.click(screen.getByRole("button", { name: "隱藏中譯" }));

    expect(screen.queryByText("謝謝你。")).not.toBeInTheDocument();
    // 揭示鈕只剩標題與 カリナ 的兩句中譯,以及 ワン 的兩個台詞佔位
    expect(screen.getAllByRole("button", { name: "顯示中譯" })).toHaveLength(3);
    // 中譯隱藏:佔位的名稱不帶中譯(不從名稱洩漏)
    const placeholders = screen.getAllByRole("button", { name: "顯示台詞" });
    expect(placeholders).toHaveLength(2);

    await user.click(placeholders[0]);
    expect(screen.getByText("ありがとう ございます。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "顯示中譯" })).toHaveLength(4);
    const li = screen.getByText("ありがとう ございます。").closest("li") as HTMLElement;
    await user.click(within(li).getByRole("button", { name: "顯示中譯" }));
    expect(within(li).getByText("謝謝你。")).toBeInTheDocument();
  });

  it("文型例句也有發音鈕(清理後的文字)", async () => {
    getLesson.mockResolvedValue({
      ...sampleLesson,
      grammar: [
        {
          ...sampleLesson.grammar[0],
          examples: [
            ...sampleLesson.grammar[0].examples,
            {
              id: "L13-S02",
              ruby: [{ b: "Ａ:かきます → かいて" }],
              translation: "寫",
            },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    render(<LessonDetail id={13} />);
    await screen.findByText("玩、遊玩");
    await user.click(screen.getByRole("button", { name: "文型" }));

    // 名稱帶朗讀的句子:一課數十顆鈕可分辨
    const buttons = screen.getAllByRole("button", { name: /^播放例句發音:/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveAccessibleName("播放例句發音:かきます、かいて");
    await user.click(buttons[0]);
    expect(speak).toHaveBeenLastCalledWith("車が ほしいです");
    await user.click(buttons[1]);
    expect(speak).toHaveBeenLastCalledWith("かきます、かいて");
    // 文型分頁沒有播放與扮演
    expect(screen.queryByRole("button", { name: "全部播放" })).not.toBeInTheDocument();
  });

  it("TTS 關閉:文型與会話都沒有發音鈕、全部播放與扮演(隱藏中譯照常)", async () => {
    installVoice();
    await setSetting("ttsEnabled", false);
    const user = await openDialogue();

    expect(screen.getByRole("button", { name: "隱藏中譯" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /的台詞$/ })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "全部播放" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "扮演" })).not.toBeInTheDocument();
    // 標題照常是小標
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("くれますか");

    await user.click(screen.getByRole("button", { name: "文型" }));
    expect(screen.queryAllByRole("button", { name: /^播放例句發音/ })).toHaveLength(0);
  });

  it("沒有日語 voice:逐句發音鈕照常(靜默降級),全部播放與扮演隱藏", async () => {
    const { synth } = installVoice("en-US");
    await openDialogue();
    await waitFor(() => expect(synth.getVoices).toHaveBeenCalled());
    await act(async () => {}); // 等語音查詢的 promise 結算

    expect(screen.getAllByRole("button", { name: /的台詞$/ })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "全部播放" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "扮演" })).not.toBeInTheDocument();
  });
});
