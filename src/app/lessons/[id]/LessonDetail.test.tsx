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
