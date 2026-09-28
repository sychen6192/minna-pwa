import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { CardRow } from "@/lib/db";
import type { Lesson } from "@/schemas/lesson";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const buildQueue = vi.fn();
const rate = vi.fn();
const undoRate = vi.fn();
const previewIntervals = vi.fn();
const countDueByTomorrow = vi.fn();
const setWordSuspended = vi.fn();
const queueCounts = vi.fn();
const hasAnyCards = vi.fn();
vi.mock("@/lib/srs", () => ({
  buildQueue: (...a: unknown[]) => buildQueue(...a),
  rate: (...a: unknown[]) => rate(...a),
  undoRate: (...a: unknown[]) => undoRate(...a),
  previewIntervals: (...a: unknown[]) => previewIntervals(...a),
  countDueByTomorrow: (...a: unknown[]) => countDueByTomorrow(...a),
  queueCounts: (...a: unknown[]) => queueCounts(...a),
  hasAnyCards: (...a: unknown[]) => hasAnyCards(...a),
  baseVocabId: (id: string) => (id.endsWith("@r") ? id.slice(0, -2) : id),
  cardDirection: (c: { direction?: "fwd" | "rev" }) => c.direction ?? "fwd",
  setWordSuspended: (...a: unknown[]) => setWordSuspended(...a),
}));

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: (...a: unknown[]) => getLesson(...a),
}));

const getSetting = vi.fn();
const logsToArray = vi.fn();
vi.mock("@/lib/db", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
  db: { logs: { toArray: () => logsToArray() } },
}));

const SETTINGS: Record<string, unknown> = { furigana: "show", dailyGoal: 20 };

const speak = vi.fn();
vi.mock("@/lib/tts", () => ({
  speak: (...a: unknown[]) => speak(...a),
}));

import ReviewPage from "./page";

const cardRow: CardRow = {
  cardId: "L13-V001",
  lessonId: 13,
  type: "vocab",
  due: 1000,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  state: 0,
};

const lesson: Lesson = {
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
  ],
  grammar: [],
  dialogues: [],
};

const previews = {
  again: { due: 1, days: 0 },
  hard: { due: 2, days: 1 },
  good: { due: 3, days: 3 },
  easy: { due: 4, days: 7 },
};

function setupOneCard() {
  buildQueue.mockResolvedValue([cardRow]);
  getLesson.mockResolvedValue(lesson);
  previewIntervals.mockResolvedValue(previews);
  countDueByTomorrow.mockResolvedValue(0);
}

/** 第二個字(L13-V002) */
const card2: CardRow = { ...cardRow, cardId: "L13-V002" };
const lesson2: Lesson = {
  ...lesson,
  vocab: [
    lesson.vocab[0],
    { ...lesson.vocab[0], id: "L13-V002", ruby: [{ b: "ほしい" }], kana: "ほしい", meaning: "第二個字" },
  ],
};

/** 兩張卡的佇列(L13-V001、L13-V002) */
function setupTwoCards() {
  buildQueue.mockResolvedValue([cardRow, card2]);
  getLesson.mockResolvedValue(lesson2);
  previewIntervals.mockResolvedValue(previews);
  countDueByTomorrow.mockResolvedValue(0);
}

/** 空白鍵翻面(不受換卡後點擊防護影響) */
function flipByKey() {
  fireEvent.keyDown(window, { code: "Space" });
}

/** 把時鐘撥過換卡/進結算後的點擊防護(300ms);之後 Date 停在 fake 時間 */
function passTapGuard() {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 1_000);
}

/** 點擊卡片翻面(先越過點擊防護) */
async function clickFlip(user: ReturnType<typeof userEvent.setup>) {
  passTapGuard();
  await user.click(screen.getByRole("button", { name: "顯示答案" }));
}

/** 可手動完成的 promise(模擬評分寫入中) */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** queueCounts 預設:今日無新卡等待(未達上限) */
const COUNTS_DONE = {
  due: 0,
  fresh: 0,
  newCapReached: false,
  newCapped: 0,
  newRemaining: 10,
  newToday: 0,
  newPerDay: 10,
  reviewCapReached: false,
};

beforeEach(() => {
  hasAnyCards.mockResolvedValue(true);
  queueCounts.mockResolvedValue(COUNTS_DONE);
  getSetting.mockImplementation(async (key: string) => SETTINGS[key]);
  logsToArray.mockResolvedValue([]);
  // rate 回傳 { card, prev, logId };prev 取評分當下的卡(以 cardId 對應)
  rate.mockImplementation(async (cardId: string) => ({
    card: { ...cardRow, cardId, state: 2 },
    prev: { ...cardRow, cardId },
    logId: 7,
  }));
  undoRate.mockResolvedValue(undefined);
  setWordSuspended.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** 模擬 App 切回前景 */
function becomeVisible() {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("ReviewPage", () => {
  it("空 DB:引導去課程加入單字,不顯示今日完成", async () => {
    buildQueue.mockResolvedValue([]);
    hasAnyCards.mockResolvedValue(false);
    countDueByTomorrow.mockResolvedValue(0);
    render(<ReviewPage />);
    expect(await screen.findByText("還沒有加入任何單字")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "瀏覽課程" })).toHaveAttribute("href", "/lessons");
    expect(screen.queryByText(/今日複習完成/)).not.toBeInTheDocument();
  });

  it("今日新卡已達上限:顯示上限(N/N)、明天繼續與設定連結", async () => {
    buildQueue.mockResolvedValue([]);
    queueCounts.mockResolvedValue({
      ...COUNTS_DONE,
      newCapReached: true,
      newCapped: 3,
      newRemaining: 0,
      newToday: 10,
    });
    countDueByTomorrow.mockResolvedValue(4);
    render(<ReviewPage />);
    expect(await screen.findByText("今日新卡已達上限(10/10)")).toBeInTheDocument();
    expect(screen.getByText(/明天繼續/)).toHaveTextContent("明天繼續;可在設定調整");
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("href", "/settings");
    expect(screen.getByText(/明日到期:4 張/)).toBeInTheDocument();
    expect(screen.queryByText(/今日複習完成/)).not.toBeInTheDocument();
  });

  it("今日新卡已達上限、只剩 bury 的回想卡:明天繼續,不提示調設定;上限於今日調低時以上限封頂", async () => {
    buildQueue.mockResolvedValue([]);
    queueCounts.mockResolvedValue({
      ...COUNTS_DONE,
      newCapReached: true,
      newCapped: 0,
      newRemaining: 0,
      newToday: 5,
      newPerDay: 3,
    });
    countDueByTomorrow.mockResolvedValue(0);
    render(<ReviewPage />);
    expect(await screen.findByText("今日新卡已達上限(3/3)")).toBeInTheDocument();
    expect(screen.getByText("明天繼續")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
  });

  it("每日新卡上限為 0:不說明天繼續,引導到設定", async () => {
    buildQueue.mockResolvedValue([]);
    queueCounts.mockResolvedValue({
      ...COUNTS_DONE,
      newCapReached: true,
      newCapped: 2,
      newRemaining: 0,
      newPerDay: 0,
    });
    countDueByTomorrow.mockResolvedValue(0);
    render(<ReviewPage />);
    expect(await screen.findByText("每日新卡上限設為 0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText(/明天繼續/)).not.toBeInTheDocument();
  });

  it("空狀態:頁面重新可見時重新載入佇列", async () => {
    buildQueue.mockResolvedValueOnce([]);
    countDueByTomorrow.mockResolvedValue(1);
    render(<ReviewPage />);
    expect(await screen.findByText("今日複習完成 🎉")).toBeInTheDocument();

    setupOneCard(); // 之後的 buildQueue 回傳一張卡
    becomeVisible();
    expect(await screen.findByText(/點擊卡片/)).toBeInTheDocument();
    expect(buildQueue).toHaveBeenCalledTimes(2);
  });

  it("複習進行中:頁面重新可見不重載(不打斷 session)", async () => {
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText(/點擊卡片/);

    becomeVisible();
    await act(async () => {});
    expect(buildQueue).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("結算頁:同學習日重新可見保留結算,跨學習日才重載", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const evening = new Date(2026, 8, 1, 22, 0).getTime();
    vi.setSystemTime(evening);
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText(/點擊卡片/);
    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.keyDown(window, { key: "3" });
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();

    vi.setSystemTime(evening + 5 * 3_600_000); // 03:00 仍屬同一學習日
    becomeVisible();
    await act(async () => {});
    expect(buildQueue).toHaveBeenCalledTimes(1);
    expect(screen.getByText("本次複習結算")).toBeInTheDocument();

    vi.setSystemTime(evening + 12 * 3_600_000); // 隔天 10:00
    becomeVisible();
    expect(await screen.findByText(/點擊卡片/)).toBeInTheDocument();
    expect(buildQueue).toHaveBeenCalledTimes(2);
  });

  it("佇列空時顯示今日完成與明日到期", async () => {
    buildQueue.mockResolvedValue([]);
    countDueByTomorrow.mockResolvedValue(5);
    render(<ReviewPage />);
    expect(await screen.findByText("今日複習完成 🎉")).toBeInTheDocument();
    expect(screen.getByText(/明日到期:5 張/)).toBeInTheDocument();
    // 明日到期以學習日估算(countDueByTomorrow 取當下時刻,不再自行 +24h)
    const [at] = countDueByTomorrow.mock.calls[0] as [number];
    expect(Math.abs(at - Date.now())).toBeLessThan(5_000);
  });

  it("翻卡→評分→結算(點擊操作)", async () => {
    setupOneCard();
    const user = userEvent.setup();
    render(<ReviewPage />);

    // 進入複習,答案尚未顯示
    await screen.findByText(/點擊卡片/);
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();

    // 翻面
    await clickFlip(user);
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();

    // 評分「良好」→ rate 以 rating=3 呼叫
    await user.click(screen.getByRole("button", { name: "良好" }));
    expect(rate).toHaveBeenCalledWith("L13-V001", 3, expect.any(Number));

    // 結算頁
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    const goodRow = screen.getByText("良好").closest("div");
    expect(goodRow).toHaveTextContent("1");
  });

  it("翻卡後顯示同課例句(附翻譯)與例句/單字發音鈕", async () => {
    const lessonWithExample: Lesson = {
      ...lesson,
      grammar: [
        {
          id: "L13-G01",
          pattern: "型",
          examples: [
            {
              id: "L13-S01",
              ruby: [{ b: "公園で" }, { b: "遊", r: "あそ" }, { b: "びます。" }],
              translation: "在公園玩。",
            },
          ],
        },
      ],
    };
    buildQueue.mockResolvedValue([cardRow]);
    getLesson.mockResolvedValue(lessonWithExample);
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText(/點擊卡片/);
    await clickFlip(user);

    // 例句翻譯與發音鈕
    expect(screen.getByText("在公園玩。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "播放例句發音" }),
    ).toBeInTheDocument();

    // 單字發音鈕 → speak(kana)
    await user.click(
      screen.getByRole("button", { name: "播放 あそびます 的發音" }),
    );
    expect(speak).toHaveBeenCalledWith("あそびます");
  });

  it("翻卡後讀音帶重音標記(有 accent 資料時)", async () => {
    buildQueue.mockResolvedValue([cardRow]);
    getLesson.mockResolvedValue({
      ...lesson,
      vocab: [{ ...lesson.vocab[0], accent: 4 }],
    });
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText(/點擊卡片/);
    await clickFlip(user);
    expect(
      screen.getByLabelText("あそびます、重音 4 型(中高)"),
    ).toBeInTheDocument();
  });

  it("回想方向卡(rev):正面給中文,翻面才顯示日文與讀音", async () => {
    buildQueue.mockResolvedValue([{ ...cardRow, cardId: "L13-V001@r", direction: "rev" }]);
    getLesson.mockResolvedValue(lesson);
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    // 方向徽章 + 正面中文 + 詞性・課號(同義詞消歧);翻面前看不到讀音
    expect(await screen.findByText("中 → 日")).toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.getByText("動I・第 13 課")).toBeInTheDocument();
    expect(screen.queryByText("あそびます")).not.toBeInTheDocument();

    await clickFlip(user);
    expect(screen.getByText("あそびます")).toBeInTheDocument();
  });

  it("已會·略過:翻面後才出現;以字為單位暫停並前進(不評分)", async () => {
    setupTwoCards();
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText("1 / 2");
    expect(screen.queryByRole("button", { name: "已會·略過" })).not.toBeInTheDocument();
    await clickFlip(user);
    await user.click(screen.getByRole("button", { name: "已會·略過" }));
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
    // 前進到第二張,未呼叫 rate
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    expect(rate).not.toHaveBeenCalled();
  });

  it("鍵盤:空白翻面、數字鍵評分", async () => {
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText(/點擊卡片/);

    fireEvent.keyDown(window, { code: "Space" });
    expect(await screen.findByText("玩、遊玩")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() =>
      expect(rate).toHaveBeenCalledWith("L13-V001", 3, expect.any(Number)),
    );
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
  });

  it("翻面後顯示搭配 note;段落標記(読み物等)不顯示", async () => {
    buildQueue.mockResolvedValue([cardRow, card2]);
    getLesson.mockResolvedValue({
      ...lesson2,
      vocab: [
        { ...lesson2.vocab[0], note: "〔友達に〜〕" },
        { ...lesson2.vocab[1], note: "読み物" },
      ],
    });
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    render(<ReviewPage />);

    await screen.findByText("1 / 2");
    expect(screen.queryByText("〔友達に〜〕")).not.toBeInTheDocument();
    flipByKey();
    expect(await screen.findByText("〔友達に〜〕")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "3" });
    await screen.findByText("2 / 2");
    flipByKey();
    expect(await screen.findByText("第二個字")).toBeInTheDocument();
    expect(screen.queryByText("読み物")).not.toBeInTheDocument();
  });

  it("回想卡(rev):note 可能洩題,只在翻面後顯示;略過以字為單位", async () => {
    buildQueue.mockResolvedValue([{ ...cardRow, cardId: "L13-V001@r", direction: "rev" }]);
    getLesson.mockResolvedValue({
      ...lesson,
      vocab: [{ ...lesson.vocab[0], note: "〔公園で〜〕" }],
    });
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText("中 → 日");
    expect(screen.queryByText("〔公園で〜〕")).not.toBeInTheDocument();
    await clickFlip(user);
    expect(screen.getByText("〔公園で〜〕")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "已會·略過" }));
    expect(setWordSuspended).toHaveBeenCalledWith("L13-V001", true);
  });
});

describe("ReviewPage:session 內重看(T10.3)", () => {
  it("評重來 → 計數 +1,約 5 張後以「重看」出現;重看項不評分、不預估,結算列出答錯的字", async () => {
    setupTwoCards();
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText("1 / 2");
    flipByKey();
    fireEvent.keyDown(window, { key: "1" }); // 重來
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    expect(rate).toHaveBeenCalledWith("L13-V001", 1, expect.any(Number));

    flipByKey();
    fireEvent.keyDown(window, { key: "3" });
    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    // 重看項:徽章、同一張卡的正面
    expect(screen.getByText("重看")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "顯示答案" })).toHaveTextContent("遊");
    flipByKey();
    expect(await screen.findByRole("button", { name: "記住了" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "還不熟,再一次" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "良好" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已會·略過" })).not.toBeInTheDocument();
    expect(previewIntervals).toHaveBeenCalledTimes(2); // 只有兩張一般卡

    await user.click(screen.getByRole("button", { name: "記住了" }));
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    expect(rate).toHaveBeenCalledTimes(2); // 重看不寫 log

    const missed = screen.getByRole("heading", { name: /本次答錯/ }).closest("section")!;
    expect(missed).toHaveTextContent("重看 1 次");
    expect(missed).toHaveTextContent("玩、遊玩");
    expect(missed).not.toHaveTextContent("第二個字");
    expect(within(missed).getByText("あそ")).toBeInTheDocument(); // ruby 讀音
  });

  it("還不熟,再一次:最多再插入 2 次;到上限改為「明天再練」只前進", async () => {
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText("1 / 1");
    flipByKey();
    fireEvent.keyDown(window, { key: "1" });
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();

    flipByKey();
    fireEvent.keyDown(window, { key: "1" }); // 還不熟 → 第 2 次重看
    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    flipByKey();
    fireEvent.keyDown(window, { key: "1" }); // 還不熟 → 第 3 次重看
    expect(await screen.findByText("4 / 4")).toBeInTheDocument();
    flipByKey();
    const last = await screen.findByRole("button", { name: "還不熟,明天再練" });
    fireEvent.click(last);
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    expect(screen.getByText("重看 3 次")).toBeInTheDocument();
    expect(rate).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewPage:復原與防重入(T10.3)", () => {
  it("復原評分:回到上一張已翻面、以 rate 回傳的 prev/logId 還原、移除插入的重看項", async () => {
    setupTwoCards();
    const user = userEvent.setup();
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    expect(screen.queryByRole("button", { name: "復原" })).not.toBeInTheDocument();

    flipByKey();
    fireEvent.keyDown(window, { key: "1" });
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "復原" }));
    expect(undoRate).toHaveBeenCalledWith(
      expect.objectContaining({ prev: { ...cardRow, cardId: "L13-V001" }, logId: 7 }),
    );
    expect(await screen.findByText("1 / 2")).toBeInTheDocument(); // 重看項已移除
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument(); // 已翻面
    expect(screen.getByRole("button", { name: "良好" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "復原" })).not.toBeInTheDocument(); // 只保留一步

    // 改評良好 → 結算不含先前的重來
    fireEvent.keyDown(window, { key: "3" });
    await screen.findByText("2 / 2");
    flipByKey();
    fireEvent.keyDown(window, { key: "3" });
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    expect(screen.getByText("重來").closest("div")).toHaveTextContent("0");
    expect(screen.getByText("良好").closest("div")).toHaveTextContent("2");
    expect(screen.queryByRole("heading", { name: /本次答錯/ })).not.toBeInTheDocument();
  });

  it("復原略過:恢復該字並回到該卡(已翻面)", async () => {
    setupTwoCards();
    const user = userEvent.setup();
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    flipByKey();
    await user.click(await screen.findByRole("button", { name: "已會·略過" }));
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "復原" }));
    expect(setWordSuspended).toHaveBeenLastCalledWith("L13-V001", false);
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(undoRate).not.toHaveBeenCalled();
  });

  it("從結算頁復原:回到最後一張(已翻面),統計扣回", async () => {
    setupOneCard();
    const user = userEvent.setup();
    render(<ReviewPage />);
    await screen.findByText("1 / 1");
    flipByKey();
    fireEvent.keyDown(window, { key: "3" });
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();

    passTapGuard();
    await user.click(screen.getByRole("button", { name: "復原" }));
    expect(undoRate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "4" });
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    expect(screen.getByText("良好").closest("div")).toHaveTextContent("0");
    expect(screen.getByText("輕鬆").closest("div")).toHaveTextContent("1");
  });

  it("連按兩次只評一次:評分寫入中忽略鍵盤與點擊、評分鍵 disabled", async () => {
    setupTwoCards();
    const pending = deferred<unknown>();
    rate.mockImplementationOnce(() => pending.promise);
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    flipByKey();

    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "3" });
    const good = await screen.findByRole("button", { name: "良好" });
    fireEvent.click(good);
    expect(rate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(good).toBeDisabled());

    await act(async () => {
      pending.resolve({ card: cardRow, prev: cardRow, logId: 1 });
    });
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    expect(rate).toHaveBeenCalledTimes(1);
    // 下一張未被翻開、未被評分
    expect(screen.getByText(/點擊卡片/)).toBeInTheDocument();
  });

  it("長按連發(e.repeat)的數字鍵不評分", async () => {
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText("1 / 1");
    flipByKey();
    await screen.findByRole("button", { name: "良好" });
    fireEvent.keyDown(window, { key: "3", repeat: true });
    await act(async () => {});
    expect(rate).not.toHaveBeenCalled();
  });

  it("換卡後 300ms 內的點擊不翻面(雙擊評分鍵不會翻開下一張)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 1, 20, 0));
    setupTwoCards();
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    flipByKey();
    fireEvent.click(await screen.findByRole("button", { name: "良好" }));
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.queryByText("第二個字")).not.toBeInTheDocument();

    vi.setSystemTime(new Date(2026, 8, 1, 20, 0, 1));
    fireEvent.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("第二個字")).toBeInTheDocument();
  });

  it("第一張卡載入後 300ms 內的點擊不翻面(雙擊首頁「開始複習」)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 1, 20, 0));
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText("1 / 1");

    fireEvent.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.queryByText("玩、遊玩")).not.toBeInTheDocument();

    vi.setSystemTime(new Date(2026, 8, 1, 20, 0, 1));
    fireEvent.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
  });

  it("進結算頁後 300ms 內的點擊不觸發連結與復原(雙擊最後一張的評分鍵不離開結算頁)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 1, 20, 0));
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText("1 / 1");
    flipByKey();
    fireEvent.click(await screen.findByRole("button", { name: "良好" }));
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();

    // 連結上的原生 listener:收到即代表點擊生效(並擋下 jsdom 導覽)
    const home = screen.getByRole("link", { name: "回首頁" });
    const lessons = screen.getByRole("link", { name: "課程列表" });
    const reached = vi.fn((e: Event) => e.preventDefault());
    home.addEventListener("click", reached);
    lessons.addEventListener("click", reached);

    expect(fireEvent.click(home)).toBe(false); // 預設導覽被擋
    expect(fireEvent.click(lessons)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "復原" }));
    await act(async () => {});
    expect(reached).not.toHaveBeenCalled();
    expect(undoRate).not.toHaveBeenCalled();
    expect(screen.getByText("本次複習結算")).toBeInTheDocument();

    vi.setSystemTime(new Date(2026, 8, 1, 20, 0, 1));
    fireEvent.click(home);
    expect(reached).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "復原" }));
    expect(await screen.findByText("1 / 1")).toBeInTheDocument();
    expect(undoRate).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewPage:結算頁(T10.3)", () => {
  it("主連結回首頁、次連結課程列表;顯示今日目標與連續天數", async () => {
    const now = Date.now();
    logsToArray.mockResolvedValue([
      { cardId: "a", rating: 3, state: 2, due: 0, elapsedDays: 1, reviewedAt: now },
      { cardId: "b", rating: 3, state: 2, due: 0, elapsedDays: 1, reviewedAt: now },
      { cardId: "a", rating: 3, state: 0, due: 0, elapsedDays: 0, reviewedAt: now - 86_400_000 },
    ]);
    setupOneCard();
    render(<ReviewPage />);
    await screen.findByText("1 / 1");
    flipByKey();
    fireEvent.keyDown(window, { key: "3" });
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "回首頁" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "課程列表" })).toHaveAttribute("href", "/lessons");
    // 今日 2 筆、佇列剩 0 → 有效目標 2;昨日也有紀錄 → 連續 2 天
    expect(screen.getByText("今日 2/2 · 🔥 2")).toBeInTheDocument();
  });
});
