import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import type { Lesson } from "@/schemas/lesson";
import { freezeClock, passTapGuard } from "@/test/clock";
import { coverByBottomNav } from "@/test/layout";
import type {
  ClozeQuestion,
  McqQuestion,
  Question,
  QuizCandidate,
} from "@/lib/quiz";

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

// 設定:預設值照 db.ts,個別測試以 settings 覆寫(讀寫皆經 mock,不碰 IndexedDB)
let settings: Record<string, unknown> = {};
const getSetting = vi.fn();
const setSetting = vi.fn();
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    DEFAULT_SETTINGS: actual.DEFAULT_SETTINGS,
    getSetting: (...a: unknown[]) => getSetting(...a),
    setSetting: (...a: unknown[]) => setSetting(...a),
  };
});

// 只替換朗讀與語音偵測;speechText 等用真實實作。loadJaVoice 預設沒有日語 voice(無頭環境)
const speak = vi.fn();
const cancelSpeech = vi.fn();
const loadJaVoice = vi.fn();
vi.mock("@/lib/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts")>()),
  speak: (text: string) => speak(text),
  cancelSpeech: () => cancelSpeech(),
  loadJaVoice: () => loadJaVoice(),
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

beforeEach(async () => {
  const { DEFAULT_SETTINGS } = await import("@/lib/db");
  settings = { ...DEFAULT_SETTINGS };
  getSetting.mockImplementation((key: string) =>
    Promise.resolve(settings[key]),
  );
  setSetting.mockResolvedValue(undefined);
  loadJaVoice.mockResolvedValue(null);
  // 目標課與鄰近課:各課同樣兩字(課號照請求)
  getLesson.mockImplementation((n: number) =>
    Promise.resolve(n === lesson.id ? lesson : { ...lesson, id: n }),
  );
  generateQuiz.mockReturnValue([mcq, inputQ]);
  // 時鐘停住:題目出現、進結果頁後的點擊防護(300ms)由 passTapGuard 明確撥過
  freezeClock();
});

/** 「開始測驗(N 題)」 */
const START = /^開始測驗/;

/**
 * 點擊 `el`,回傳點擊事件分派期間(React 的根監聽器處理完、act 尚未 flush effect 之前)
 * speak 已被呼叫的次數:在點擊處理函式內朗讀者為 [n],改在 effect(點擊之後)朗讀者少一次。
 * 行動版瀏覽器只允許在使用者手勢內的第一次朗讀。
 */
async function speakCountDuringClick(
  user: ReturnType<typeof userEvent.setup>,
  el: Element,
): Promise<number[]> {
  const during: number[] = [];
  const probe = () => during.push(speak.mock.calls.length);
  document.addEventListener("click", probe);
  try {
    await user.click(el);
  } finally {
    document.removeEventListener("click", probe);
  }
  return during;
}

/** 載入後的題型選擇畫面按「開始測驗」(預設題型),並撥過點擊防護 */
async function startQuiz(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: START }));
  passTapGuard();
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("QuizRunner", () => {
  it("顯示進度與第一題選項", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    expect(await screen.findByText("第 1 / 2 題")).toBeInTheDocument();
    expect(screen.getByText("選出中文意思")).toBeInTheDocument(); // 題型說明
    for (const m of ["狗", "貓", "鳥", "魚"]) {
      expect(screen.getByRole("button", { name: m })).toBeInTheDocument();
    }
  });

  it("選擇題:答對顯示回饋,下一題前進", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 2 題");

    await user.click(screen.getByRole("button", { name: "狗" }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 2 / 2 題")).toBeInTheDocument();
  });

  it("選擇題:答錯顯示正解讀音", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 2 題");

    await user.click(screen.getByRole("button", { name: "貓" }));
    expect(screen.getByText(/答錯/)).toHaveTextContent(/答錯.*いぬ/);
  });

  it("輸入題:羅馬字經正規化判定為正解,走完一輪到結算", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await startQuiz(user);
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

describe("QuizRunner 無障礙:回饋 live region 與焦點(T10.10)", () => {
  it("回饋為先掛載的 role=status;選擇題作答後焦點移到「下一題」,換題後移到題幹", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    expect(document.body).toHaveFocus(); // 首次載入(題型選擇)不搶焦點
    await startQuiz(user);
    await screen.findByText("第 1 / 2 題");
    // 「開始測驗」已卸載:焦點移到第一題題幹(不掉到 body)
    expect(screen.getByText("いぬ").closest("[tabindex]")).toHaveFocus();

    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "貓" }));
    expect(screen.getByRole("status")).toBe(status); // 同一個 live region,內容更新才會播報
    expect(status).toHaveTextContent(/答錯.*いぬ/);
    // 被選的選項已 disabled:焦點不掉到 body,移到下一步
    expect(screen.getByRole("button", { name: "下一題" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByText("第 2 / 2 題")).toBeInTheDocument();
    expect(screen.getByText("貓").closest("[tabindex]")).toHaveFocus(); // 新題幹
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("輸入題:作答後輸入框停用,焦點移到「看結果」", async () => {
    const user = userEvent.setup();
    generateQuiz.mockReturnValue([inputQ]);
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 1 題");

    await user.type(screen.getByLabelText("輸入假名"), "neko{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("答對 ✓");
    expect(screen.getByRole("button", { name: "看結果" })).toHaveFocus();
  });

  it("作答後「下一題」被固定的底部導覽列擋住時往下捲出來", async () => {
    const user = userEvent.setup();
    // jsdom 不排版:「下一題」的下緣在視窗下緣之下 40px,其餘元素在畫面頂端
    const { scrollTo, restore } = coverByBottomNav("下一題");
    try {
      render(<QuizRunner id={13} />);
      await startQuiz(user);
      await screen.findByText("第 1 / 2 題");
      expect(scrollTo).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "狗" }));
      expect(screen.getByRole("button", { name: "下一題" })).toHaveFocus();
      expect(scrollTo).toHaveBeenCalledWith({ top: window.scrollY + 40 });
    } finally {
      restore();
    }
  });
});

describe("QuizRunner 點擊防護(T11.8)", () => {
  it("雙擊「開始測驗」/「下一題」:第二下落在新題選項上不作答", async () => {
    const user = userEvent.setup();
    generateQuiz.mockReturnValue([mcq, mcq]);
    render(<QuizRunner id={13} />);
    await user.click(await screen.findByRole("button", { name: START }));
    // 第二下(時鐘未前進 = 題目剛出現)
    await user.click(screen.getByRole("button", { name: "貓" }));
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "貓" })).toBeEnabled();

    passTapGuard();
    await user.click(screen.getByRole("button", { name: "狗" }));
    expect(status).toHaveTextContent("答對 ✓");

    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 2 / 2 題")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "貓" }));
    expect(status).toBeEmptyDOMElement();
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "貓" }));
    expect(status).toHaveTextContent(/答錯/);
  });
});

describe("QuizRunner 判分、提示與再測(T10.4)", () => {
  const mail: QuizCandidate = {
    id: "L26-V042",
    lessonId: 26,
    ruby: [{ b: "電子", r: "でんし" }, { b: "メール" }],
    kana: "でんしメール",
    meaning: "電子郵件",
    pos: "名",
  };
  const suki: QuizCandidate = {
    id: "L09-V003",
    lessonId: 9,
    ruby: [{ b: "好", r: "す" }, { b: "き［な］" }],
    kana: "すき［な］",
    meaning: "喜歡",
    pos: "な形",
  };

  it("輸入題:長音以羅馬字 - 作答判對", async () => {
    const user = userEvent.setup();
    generateQuiz.mockReturnValue([{ type: "input", answer: mail }]);
    render(<QuizRunner id={26} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 1 題");

    await user.type(screen.getByLabelText("輸入假名"), "denshime-ru");
    await user.click(screen.getByRole("button", { name: "作答" }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();
  });

  it("輸入題:［な］可省略;答錯時列出可接受的讀音(不含標記)", async () => {
    const user = userEvent.setup();
    generateQuiz.mockReturnValue([
      { type: "input", answer: suki },
      { type: "input", answer: suki },
    ]);
    render(<QuizRunner id={9} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 2 題");

    await user.type(screen.getByLabelText("輸入假名"), "suki");
    await user.click(screen.getByRole("button", { name: "作答" }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一題" }));
    await user.type(screen.getByLabelText("輸入假名"), "すきだ");
    await user.click(screen.getByRole("button", { name: "作答" }));
    expect(screen.getByText(/答錯/)).toHaveTextContent(
      /^答錯 ✗\(すき／すきな\)$/,
    );
    // 正解讀音標 lang=ja(日文字形/語音),中文回饋不標
    expect(screen.getByText("すき／すきな")).toHaveAttribute("lang", "ja");
  });

  it("答題後顯示搭配 note;段落標記不顯示", async () => {
    const user = userEvent.setup();
    const noted: McqQuestion = {
      ...mcq,
      answer: { ...inu, note: "〔電車に〜〕" },
      options: mcq.options.map((o) =>
        o.correct ? { ...o, candidate: { ...inu, note: "〔電車に〜〕" } } : o,
      ),
    };
    const marker: Question = {
      type: "input",
      answer: { ...neko, note: "読み物" },
    };
    generateQuiz.mockReturnValue([noted, marker]);
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 2 題");

    expect(screen.queryByText("〔電車に〜〕")).not.toBeInTheDocument(); // 作答前不提示
    await user.click(screen.getByRole("button", { name: "狗" }));
    expect(screen.getByText("〔電車に〜〕")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一題" }));
    await user.type(screen.getByLabelText("輸入假名"), "neko");
    await user.click(screen.getByRole("button", { name: "作答" }));
    expect(screen.queryByText("読み物")).not.toBeInTheDocument();
  });

  it("結果頁「再測一次」重新出題並從第 1 題開始;有「下一課測驗」連結", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 2 題");
    await user.click(screen.getByRole("button", { name: "貓" })); // 答錯
    await user.click(screen.getByRole("button", { name: "下一題" }));
    await user.type(screen.getByLabelText("輸入假名"), "neko");
    await user.click(screen.getByRole("button", { name: "作答" }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下一課測驗 →" })).toHaveAttribute(
      "href",
      "/quiz/14",
    );

    generateQuiz.mockReturnValue([inputQ]);
    passTapGuard(); // 結果頁的進場防護
    await user.click(screen.getByRole("button", { name: "再測一次" }));
    expect(generateQuiz).toHaveBeenCalledTimes(2);
    expect(generateQuiz.mock.calls[1][0]).toBe(13);
    expect(generateQuiz.mock.calls[1][1]).toBe(generateQuiz.mock.calls[0][1]); // 同一題庫
    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
    expect(screen.getByLabelText("輸入假名")).toHaveValue("");
    expect(screen.queryByText("答對 ✓")).not.toBeInTheDocument();
  });
});

describe("QuizRunner 題型選擇、聽力與例句填空(T11.8)", () => {
  const hanami: QuizCandidate = {
    id: "L06-V029",
    lessonId: 6,
    ruby: [{ b: "［お］" }, { b: "花見", r: "はなみ" }],
    kana: "はなみ",
    meaning: "賞花",
    pos: "名",
  };
  const listenQ: McqQuestion = {
    type: "listen",
    answer: hanami,
    options: [
      { id: hanami.id, candidate: hanami, correct: true },
      { id: "L13-V001", candidate: inu, correct: false },
      { id: "L13-V002", candidate: neko, correct: false },
    ],
  };
  const clozeQ: ClozeQuestion = {
    type: "cloze",
    answer: neko,
    options: [
      { id: "L13-V001", candidate: inu, correct: false },
      { id: "L13-V002", candidate: neko, correct: true },
    ],
    cloze: {
      sentenceId: "L13-S01",
      before: [{ b: "うちに " }],
      after: [{ b: "が います。" }],
      translation: "家裡有貓。",
    },
  };
  const chip = (name: string) => screen.getByRole("button", { name });
  const withVoice = () => loadJaVoice.mockResolvedValue({ lang: "ja-JP" });

  it("開始前顯示題型:預設全選;沒有日語語音時聽力停用並說明,出題不含聽力", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    expect(
      screen.getByRole("heading", { name: "第 13 課 單字測驗" }),
    ).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "題型" });
    for (const name of ["日→中", "中→日", "輸入假名", "例句填空"]) {
      expect(within(group).getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    await vi.waitFor(() =>
      expect(
        screen.getByText("此裝置沒有日語語音,無法出聽力題。"),
      ).toBeInTheDocument(),
    );
    expect(chip("聽力")).toBeDisabled();
    expect(chip("聽力")).toHaveAttribute("aria-pressed", "false");
    expect(chip("聽力")).toHaveAccessibleDescription(
      "此裝置沒有日語語音,無法出聽力題。",
    );

    await startQuiz(user);
    expect(generateQuiz).toHaveBeenCalledWith(
      13,
      expect.any(Array),
      expect.objectContaining({
        count: 10,
        types: ["jp-to-zh", "zh-to-jp", "input", "cloze"],
        listenAvailable: false,
        lesson,
      }),
    );
    expect(await screen.findByText("第 1 / 2 題")).toBeInTheDocument();
  });

  it("設定關閉發音時聽力停用,並連到設定", async () => {
    settings.ttsEnabled = false;
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    expect(chip("聽力")).toBeDisabled();
    expect(screen.getByText(/聽力題需要開啟發音/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(loadJaVoice).not.toHaveBeenCalled();
  });

  it("切換題型:寫入設定(聽力暫不可用時保留原選擇);至少保留一種", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    await vi.waitFor(() =>
      expect(chip("聽力")).toHaveAccessibleDescription(/沒有日語語音/),
    );

    await user.click(chip("輸入假名"));
    expect(chip("輸入假名")).toHaveAttribute("aria-pressed", "false");
    expect(setSetting).toHaveBeenLastCalledWith("quizTypes", [
      "jp-to-zh",
      "zh-to-jp",
      "cloze",
      "listen",
    ]);
    await user.click(chip("日→中"));
    await user.click(chip("中→日"));
    expect(setSetting).toHaveBeenLastCalledWith("quizTypes", [
      "cloze",
      "listen",
    ]);

    // 最後一種不能取消
    const calls = setSetting.mock.calls.length;
    await user.click(chip("例句填空"));
    expect(chip("例句填空")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("至少要保留一種題型。")).toBeInTheDocument();
    expect(setSetting).toHaveBeenCalledTimes(calls);

    await user.click(chip("中→日"));
    expect(screen.queryByText("至少要保留一種題型。")).not.toBeInTheDocument();
    await startQuiz(user);
    expect(generateQuiz.mock.lastCall?.[2]).toMatchObject({
      types: ["zh-to-jp", "cloze"],
      listenAvailable: false,
    });
  });

  it("開始鈕顯示題數;所選題型沒有適合的字時停用並說明", async () => {
    const user = userEvent.setup();
    render(<QuizRunner id={13} />);
    // 本課 2 字(generateQuiz 的題數規則:可出題的字數,至多 10)
    expect(
      await screen.findByRole("button", { name: "開始測驗(2 題)" }),
    ).toBeEnabled();
    for (const name of ["日→中", "中→日", "輸入假名"])
      await user.click(chip(name));
    // 只剩例句填空,而本課沒有例句
    const start = screen.getByRole("button", { name: START });
    expect(start).toHaveTextContent(/^開始測驗$/);
    expect(start).toBeDisabled();
    expect(
      screen.getByText("本課沒有適合這些題型的字,請加選其他題型。"),
    ).toBeInTheDocument();
    await user.click(chip("輸入假名"));
    // 可輸入題的只有漢字讀音的字:犬、猫 皆可
    expect(
      screen.getByRole("button", { name: "開始測驗(2 題)" }),
    ).toBeEnabled();
  });

  it("沿用設定中的題型;設定值無效時用預設", async () => {
    settings.quizTypes = ["cloze"];
    const { unmount } = render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    expect(chip("例句填空")).toHaveAttribute("aria-pressed", "true");
    expect(chip("日→中")).toHaveAttribute("aria-pressed", "false");
    unmount();

    settings.quizTypes = ["bogus"];
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    expect(chip("日→中")).toHaveAttribute("aria-pressed", "true");
    expect(chip("例句填空")).toHaveAttribute("aria-pressed", "true");
  });

  it("有日語語音時聽力預設開啟;聽力題出現時自動朗讀一次、可重聽,作答後揭示單字", async () => {
    const user = userEvent.setup();
    withVoice();
    generateQuiz.mockReturnValue([listenQ, mcq]);
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    await vi.waitFor(() => expect(chip("聽力")).toBeEnabled());
    expect(chip("聽力")).toHaveAttribute("aria-pressed", "true");

    // 在「開始測驗」的點擊內朗讀(行動版瀏覽器要求),讀表面形(引擎依辭典決定重音)
    expect(
      await speakCountDuringClick(
        user,
        screen.getByRole("button", { name: START }),
      ),
    ).toEqual([1]);
    passTapGuard();
    expect(generateQuiz.mock.lastCall?.[2]).toMatchObject({
      types: ["jp-to-zh", "zh-to-jp", "input", "cloze", "listen"],
      listenAvailable: true,
    });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenLastCalledWith("お花見");
    expect(screen.getByText("聽發音,選出意思")).toBeInTheDocument();
    // 作答前不顯示單字
    expect(screen.queryByText("花見")).not.toBeInTheDocument();
    for (const m of ["賞花", "狗", "貓"]) {
      expect(screen.getByRole("button", { name: m })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "再聽一次" }));
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenLastCalledWith("お花見");

    await user.click(screen.getByRole("button", { name: "狗" }));
    expect(screen.getByText(/答錯/)).toHaveTextContent(/答錯.*はなみ/);
    const revealed = screen.getByText("花見");
    expect(revealed.closest("ruby")).toHaveTextContent("花見はなみ");
    expect(revealed.closest("[lang]")).toHaveAttribute("lang", "ja");

    // 下一題不是聽力:停止朗讀
    cancelSpeech.mockClear();
    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(cancelSpeech).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("換到聽力題時在「下一題」的點擊內朗讀", async () => {
    const user = userEvent.setup();
    withVoice();
    generateQuiz.mockReturnValue([mcq, listenQ]);
    render(<QuizRunner id={13} />);
    await vi.waitFor(() => expect(chip("聽力")).toBeEnabled());
    await startQuiz(user);
    expect(speak).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "狗" }));
    expect(
      await speakCountDuringClick(
        user,
        screen.getByRole("button", { name: "下一題" }),
      ),
    ).toEqual([1]);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenLastCalledWith("お花見");
  });

  it("例句填空:原句挖一處空格、顯示中譯,選項為日文(ruby);作答後空格填入正解", async () => {
    const user = userEvent.setup();
    generateQuiz.mockReturnValue([clozeQ]);
    render(<QuizRunner id={13} />);
    await startQuiz(user);
    await screen.findByText("第 1 / 1 題");

    expect(screen.getByText("選出填入空格的詞")).toBeInTheDocument();
    expect(screen.getByText("家裡有貓。")).toBeInTheDocument();
    expect(screen.getByText("うちに").closest("[lang]")).toHaveAttribute(
      "lang",
      "ja",
    );
    expect(screen.getByText("(空格)")).toBeInTheDocument();
    const inuOption = screen.getByRole("button", { name: /犬/ });
    expect(inuOption.querySelector("[lang='ja'] ruby")).toHaveTextContent(
      "犬いぬ",
    );
    expect(screen.getByRole("button", { name: /猫/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /猫/ }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();
    // 空格填入正解(報讀;日文標 lang=ja)
    const spoken = screen.getByText("猫", { selector: ".sr-only > span" });
    expect(spoken).toHaveAttribute("lang", "ja");
    expect(spoken.parentElement).toHaveTextContent(/^\(猫\)$/);
    expect(screen.queryByText("(空格)")).not.toBeInTheDocument();
  });

  it("再測一次沿用同樣題型", async () => {
    const user = userEvent.setup();
    generateQuiz.mockReturnValue([clozeQ]);
    render(<QuizRunner id={13} />);
    await screen.findByRole("button", { name: START });
    await user.click(chip("輸入假名"));
    await startQuiz(user);
    await user.click(await screen.findByRole("button", { name: /猫/ }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(cancelSpeech).toHaveBeenCalled();
    passTapGuard(); // 結果頁的進場防護
    await user.click(screen.getByRole("button", { name: "再測一次" }));
    expect(generateQuiz).toHaveBeenCalledTimes(2);
    expect(generateQuiz.mock.calls[1][2]).toMatchObject({
      types: ["jp-to-zh", "zh-to-jp", "cloze"],
    });
    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
  });
});
