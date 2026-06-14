import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { buildQueue } from "@/lib/srs";
import type { QuizCandidate } from "@/lib/quiz";
import { QuizResult } from "./QuizResult";

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

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear()]);
});

describe("QuizResult", () => {
  it("全對時顯示分數,不顯示加入鈕", () => {
    render(
      <QuizResult results={[{ card: inu, correct: true }]} lessonId={13} />,
    );
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("全部答對 🎉")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "錯題加入複習" }),
    ).not.toBeInTheDocument();
  });

  it("顯示錯題清單與分數", () => {
    render(
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

  it("錯題加入複習後出現在複習佇列,並標示已加入", async () => {
    const user = userEvent.setup();
    render(
      <QuizResult
        results={[
          { card: inu, correct: true },
          { card: neko, correct: false },
        ]}
        lessonId={13}
      />,
    );

    await user.click(screen.getByRole("button", { name: "錯題加入複習" }));

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
});
