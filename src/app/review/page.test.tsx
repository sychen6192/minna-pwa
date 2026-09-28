import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const previewIntervals = vi.fn();
const countDueByTomorrow = vi.fn();
const setSuspended = vi.fn();
const queueCounts = vi.fn();
const hasAnyCards = vi.fn();
vi.mock("@/lib/srs", () => ({
  buildQueue: (...a: unknown[]) => buildQueue(...a),
  rate: (...a: unknown[]) => rate(...a),
  previewIntervals: (...a: unknown[]) => previewIntervals(...a),
  countDueByTomorrow: (...a: unknown[]) => countDueByTomorrow(...a),
  queueCounts: (...a: unknown[]) => queueCounts(...a),
  hasAnyCards: (...a: unknown[]) => hasAnyCards(...a),
  baseVocabId: (id: string) => (id.endsWith("@r") ? id.slice(0, -2) : id),
  cardDirection: (c: { direction?: "fwd" | "rev" }) => c.direction ?? "fwd",
  setSuspended: (...a: unknown[]) => setSuspended(...a),
}));

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({
  getLesson: (...a: unknown[]) => getLesson(...a),
}));

const getSetting = vi.fn();
vi.mock("@/lib/db", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
}));

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
  getSetting.mockResolvedValue("show");
  getLesson.mockResolvedValue(lesson);
  previewIntervals.mockResolvedValue(previews);
  rate.mockResolvedValue(cardRow);
  countDueByTomorrow.mockResolvedValue(0);
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
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
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
    getSetting.mockResolvedValue("show");
    getLesson.mockResolvedValue(lessonWithExample);
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText(/點擊卡片/);
    await user.click(screen.getByRole("button", { name: "顯示答案" }));

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
    getSetting.mockResolvedValue("show");
    getLesson.mockResolvedValue({
      ...lesson,
      vocab: [{ ...lesson.vocab[0], accent: 4 }],
    });
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText(/點擊卡片/);
    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(
      screen.getByLabelText("あそびます、重音 4 型(中高)"),
    ).toBeInTheDocument();
  });

  it("回想方向卡(rev):正面給中文,翻面才顯示日文與讀音", async () => {
    buildQueue.mockResolvedValue([{ ...cardRow, cardId: "L13-V001@r", direction: "rev" }]);
    getSetting.mockResolvedValue("show");
    getLesson.mockResolvedValue(lesson);
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    // 方向徽章 + 正面中文;翻面前看不到讀音
    expect(await screen.findByText("中 → 日")).toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(screen.queryByText("あそびます")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "顯示答案" }));
    expect(screen.getByText("あそびます")).toBeInTheDocument();
  });

  it("已會·略過:暫停當前卡並前進(不評分)", async () => {
    buildQueue.mockResolvedValue([
      cardRow,
      { ...cardRow, cardId: "L13-V002" },
    ]);
    getSetting.mockResolvedValue("show");
    getLesson.mockResolvedValue({
      ...lesson,
      vocab: [
        lesson.vocab[0],
        { ...lesson.vocab[0], id: "L13-V002", meaning: "第二個字" },
      ],
    });
    previewIntervals.mockResolvedValue(previews);
    countDueByTomorrow.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await screen.findByText("1 / 2");
    await user.click(screen.getByRole("button", { name: "已會·略過" }));
    expect(setSuspended).toHaveBeenCalledWith("L13-V001", true);
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
});
