import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import ReorderIndexPage from "./page";

const getLessonIndex = vi.hoisted(() => vi.fn());
vi.mock("@/lib/content", () => ({ getLessonIndex }));

describe("ReorderIndexPage 例句重組選課", () => {
  it("列出全部課程,連結到 /reorder/[id];課名為日文時標 lang", async () => {
    getLessonIndex.mockResolvedValue({
      lessons: [
        { id: 1, title: "〜は 〜です", vocabCount: 43, grammarCount: 6 },
        { id: 36, title: "〜ように、〜", vocabCount: 40, grammarCount: 5 },
      ],
    });

    render(<ReorderIndexPage />);

    expect(
      screen.getByRole("heading", { name: "例句重組" }),
    ).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /第 36 課/ });
    expect(link).toHaveAttribute("href", "/reorder/36");
    expect(screen.getByRole("link", { name: /第 1 課/ })).toHaveAttribute(
      "href",
      "/reorder/1",
    );
    expect(screen.getByText("〜ように、〜")).toHaveAttribute("lang", "ja");
    expect(screen.getByText("並べ替え")).toHaveAttribute("lang", "ja");
    expect(screen.getByText("会話")).toHaveAttribute("lang", "ja");
  });

  it("載入失敗:顯示錯誤訊息", async () => {
    getLessonIndex.mockRejectedValue(new Error("斷線"));

    render(<ReorderIndexPage />);

    expect(await screen.findByText(/載入.*失敗.*斷線/)).toBeInTheDocument();
  });
});
