import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting, type CardRow } from "@/lib/db";
import { addCards, buildQueue, rate, setWordSuspended } from "@/lib/srs";
import type { QuizCandidate } from "@/lib/quiz";
import { freezeClock, passTapGuard } from "@/test/clock";
import { describeRequeue, QuizResult } from "./QuizResult";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

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

const DAY = 86_400_000;

/** 已學過(Review)、5 天後才到期的卡 */
function learnedCard(cardId: string, now: number): CardRow {
  return {
    cardId,
    lessonId: 13,
    type: "vocab",
    direction: "fwd",
    due: now + 5 * DAY,
    stability: 10,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    state: 2,
    lastReview: now - 5 * DAY,
  };
}

const oneWrong = [
  { card: inu, correct: true },
  { card: neko, correct: false },
];

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear(), db.settings.clear()]);
  // 時鐘停住:進結果頁後的點擊防護(300ms)由 passTapGuard 明確撥過
  freezeClock();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 渲染結果頁並撥過進場的點擊防護(之後的點擊照常) */
function renderResult(ui: ReactElement) {
  const result = render(ui);
  passTapGuard();
  return result;
}

describe("QuizResult", () => {
  it("全對時顯示分數,不顯示加入鈕", () => {
    renderResult(
      <QuizResult results={[{ card: inu, correct: true }]} lessonId={13} />,
    );
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("全部答對 🎉")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "錯題加入複習" }),
    ).not.toBeInTheDocument();
  });

  it("顯示錯題清單與分數", () => {
    renderResult(
      <QuizResult
        results={[
          { card: inu, correct: true },
          { card: neko, correct: false },
        ]}
        lessonId={13}
      />,
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("錯題(1)")).toBeInTheDocument();
    expect(screen.getByText("貓")).toBeInTheDocument();
  });

  it("錯題加入複習後出現在複習佇列,並標示已加入與實際結果", async () => {
    const user = userEvent.setup();
    renderResult(<QuizResult results={oneWrong} lessonId={13} />);

    // live region 先掛載(空),結果出來再填入
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("新加入 1"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "新卡依每日新卡上限陸續出現",
    );

    await waitFor(async () => {
      const queue = await buildQueue(Date.now());
      expect(queue.map((c) => c.cardId)).toContain("L13-V002");
    });
    // 只有錯題加入,答對的不加入
    expect((await buildQueue(Date.now())).map((c) => c.cardId)).not.toContain(
      "L13-V001",
    );
    expect(
      await screen.findByRole("button", { name: "已加入複習" }),
    ).toBeInTheDocument();
  });

  it("按下錯題加入複習後焦點留在按鈕上(aria-disabled,不掉到 body),再按不重複執行", async () => {
    const user = userEvent.setup();
    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    const button = screen.getByRole("button", { name: "錯題加入複習" });

    await user.click(button);
    await waitFor(() => expect(button).toHaveAccessibleName("已加入複習"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();

    await user.click(button);
    expect(await db.cards.count()).toBe(1); // 只建立一次
    expect(screen.getByRole("status")).toHaveTextContent("新加入 1");
  });

  it("進結果頁時焦點移到標題(「看結果」鈕已卸載)", () => {
    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    expect(screen.getByRole("heading", { name: "測驗完成" })).toHaveFocus();
  });
});

describe("QuizResult 錯題加入複習:已在 SRS 的字(T10.4)", () => {
  it("已學過、未到期的錯題提前到今天並入列,不寫 log", async () => {
    const user = userEvent.setup();
    await db.cards.add(learnedCard("L13-V002", Date.now()));
    expect((await buildQueue(Date.now())).map((c) => c.cardId)).not.toContain(
      "L13-V002",
    );

    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("提前到今天 1"),
    );
    expect((await buildQueue(Date.now())).map((c) => c.cardId)).toContain(
      "L13-V002",
    );
    expect(await db.logs.count()).toBe(0);
  });

  it("已會(暫停)的錯題恢復複習", async () => {
    const user = userEvent.setup();
    await db.cards.add(learnedCard("L13-V002", Date.now()));
    await setWordSuspended("L13-V002", true);

    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("恢復 1"),
    );
    expect((await db.cards.get("L13-V002"))?.suspended).toBe(false);
    expect((await buildQueue(Date.now())).map((c) => c.cardId)).toContain(
      "L13-V002",
    );
  });

  it("錯題仍是待學新卡時如實說明(不宣稱新加入或已在今日佇列)", async () => {
    const user = userEvent.setup();
    await addCards(["L13-V002"], 13);

    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

    expect(
      await screen.findByRole("button", { name: "已在複習中" }),
    ).toHaveAttribute("aria-disabled", "true");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("待學新卡 1");
    expect(status).toHaveTextContent("新卡依每日新卡上限陸續出現");
    expect(status).not.toHaveTextContent("新加入");
    expect(await db.cards.count()).toBe(1);
  });

  it("錯題原本就在今日佇列:整句說明,按鈕不宣稱已加入", async () => {
    const user = userEvent.setup();
    await db.cards.add(learnedCard("L13-V002", Date.now() - 6 * DAY)); // 昨天到期

    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

    expect(
      await screen.findByRole("button", { name: "已在複習中" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "錯題皆已在今日複習佇列中",
    );
  });

  it("今日複習額度已用完:提前的字排在逾期卡之後,不宣稱今天出現", async () => {
    const user = userEvent.setup();
    await setSetting("maxReviewsPerDay", 1);
    const now = Date.now();
    // 兩張逾期卡(3 天前到期)已佔滿今日額度;錯題 L13-V002 5 天後才到期
    await db.cards.bulkAdd([
      learnedCard("L13-V010", now - 8 * DAY),
      learnedCard("L13-V011", now - 8 * DAY),
      learnedCard("L13-V002", now),
    ]);

    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("提前到期 1"),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("今日複習已達上限,到期的字依到期先後出現,不一定在今天");
    expect(status).not.toHaveTextContent("今天 1");
    // 確實不在今日佇列(被額度截掉)
    expect((await buildQueue(Date.now())).map((c) => c.cardId)).not.toContain("L13-V002");
  });

  it("今天已複習過的錯題:明天複習並提示原因", async () => {
    const user = userEvent.setup();
    await addCards(["L13-V002"], 13);
    await rate("L13-V002", 3, Date.now());
    const logs = await db.logs.count();

    renderResult(<QuizResult results={oneWrong} lessonId={13} />);
    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

    expect(
      await screen.findByRole("button", { name: "已加入複習" }),
    ).toHaveAttribute("aria-disabled", "true");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("明天複習 1");
    expect(status).toHaveTextContent("今天已複習過的字,明天再出現");
    expect(await db.logs.count()).toBe(logs);
    expect((await buildQueue(Date.now())).map((c) => c.cardId)).not.toContain(
      "L13-V002",
    );
  });
});

describe("describeRequeue", () => {
  const zero = {
    created: 0,
    tomorrow: 0,
    unsuspended: 0,
    alreadyDue: 0,
    requeued: 0,
    pendingNew: 0,
  };

  it("依類別列出非零項", () => {
    expect(
      describeRequeue({ ...zero, created: 1, requeued: 2, unsuspended: 1 }),
    ).toBe("新加入 1 · 提前到今天 2 · 恢復 1");
    expect(describeRequeue({ ...zero, tomorrow: 2, alreadyDue: 1 })).toBe(
      "明天複習 2 · 已在今日佇列 1",
    );
    expect(describeRequeue({ ...zero, pendingNew: 2 })).toBe("待學新卡 2");
  });

  it("全部原本就在今日佇列時給整句說明", () => {
    expect(describeRequeue({ ...zero, alreadyDue: 3 })).toBe(
      "錯題皆已在今日複習佇列中",
    );
  });

  it("今日複習額度已用完:到期與提前的字不宣稱「今日」", () => {
    expect(describeRequeue({ ...zero, alreadyDue: 3 }, true)).toBe("錯題皆已到期");
    expect(describeRequeue({ ...zero, requeued: 2, alreadyDue: 1 }, true)).toBe(
      "提前到期 2 · 已到期 1",
    );
  });
});

describe("QuizResult 進場防護:雙擊「看結果」的第二下", () => {
  it("剛進結果頁時的點擊不觸發再測一次、下一課測驗與錯題加入複習", async () => {
    const onRestart = vi.fn();
    render(
      <QuizResult results={oneWrong} lessonId={13} onRestart={onRestart} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "再測一次" }));
    fireEvent.click(screen.getByRole("button", { name: "錯題加入複習" }));
    // fireEvent 回傳 false = 預設動作(連結導覽)被擋下
    expect(
      fireEvent.click(screen.getByRole("link", { name: "下一課測驗 →" })),
    ).toBe(false);
    expect(onRestart).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(await db.cards.count()).toBe(0);

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "再測一次" }));
    expect(onRestart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "錯題加入複習" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("新加入 1"),
    );
  });
});

describe("QuizResult 導覽(T10.4)", () => {
  it("再測一次呼叫 onRestart;下一課測驗與回課程連結", async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    renderResult(
      <QuizResult results={oneWrong} lessonId={13} onRestart={onRestart} />,
    );

    await user.click(screen.getByRole("button", { name: "再測一次" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "下一課測驗 →" })).toHaveAttribute(
      "href",
      "/quiz/14",
    );
    expect(screen.getByRole("link", { name: "回課程" })).toHaveAttribute(
      "href",
      "/lessons/13",
    );
  });

  it("第 50 課沒有下一課;未提供 onRestart 時不顯示再測一次", () => {
    renderResult(
      <QuizResult results={[{ card: inu, correct: true }]} lessonId={50} />,
    );
    expect(
      screen.queryByRole("link", { name: /下一課測驗/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "再測一次" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回課程" })).toHaveAttribute(
      "href",
      "/lessons/50",
    );
  });
});
