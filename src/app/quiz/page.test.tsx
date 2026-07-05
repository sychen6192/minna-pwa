import { render, screen } from "@testing-library/react";
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
  });

  it("載入失敗:顯示錯誤訊息", async () => {
    getLessonIndex.mockRejectedValue(new Error("斷線"));

    render(<QuizIndexPage />);

    expect(await screen.findByText(/載入.*失敗.*斷線/)).toBeInTheDocument();
  });
});
