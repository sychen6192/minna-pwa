import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import QuizIndexPage from "./page";

const getLessonIndex = vi.hoisted(() => vi.fn());
vi.mock("@/lib/content", () => ({ getLessonIndex }));

describe("QuizIndexPage 測驗選課入口", () => {
  it("列出全部課程,連結到 /quiz/[id]", async () => {
    getLessonIndex.mockResolvedValue({
      lessons: [
        { id: 1, title: "第一課", vocabCount: 43, grammarCount: 6 },
        { id: 13, title: "〜が ほしいです", vocabCount: 40, grammarCount: 5 },
      ],
    });

    render(<QuizIndexPage />);

    const link = await screen.findByRole("link", { name: /第一課/ });
    expect(link).toHaveAttribute("href", "/quiz/1");
    expect(screen.getByRole("link", { name: /ほしいです/ })).toHaveAttribute(
      "href",
      "/quiz/13",
    );
    expect(screen.getByText("〜が ほしいです")).toHaveAttribute("lang", "ja");
  });

  it("頂端「練習」區塊:活用練習連到 /drill、例句重組連到 /reorder", async () => {
    getLessonIndex.mockResolvedValue({ lessons: [] });

    render(<QuizIndexPage />);

    const practice = screen.getByRole("region", { name: "練習" });
    expect(within(practice).getByRole("link", { name: /活用練習/ })).toHaveAttribute(
      "href",
      "/drill",
    );
    // 說明中的日文術語標 lang="ja"
    expect(within(practice).getByText("て形")).toHaveAttribute("lang", "ja");
    expect(within(practice).getByRole("link", { name: /例句重組/ })).toHaveAttribute(
      "href",
      "/reorder",
    );
    expect(within(practice).getByText("会話")).toHaveAttribute("lang", "ja");
    expect(screen.getByRole("heading", { name: "單字測驗" })).toBeInTheDocument();
    await screen.findByText("選擇一課開始測驗。");
  });

  it("載入失敗:顯示錯誤訊息", async () => {
    getLessonIndex.mockRejectedValue(new Error("斷線"));

    render(<QuizIndexPage />);

    expect(await screen.findByText(/載入.*失敗.*斷線/)).toBeInTheDocument();
  });
});
