import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { LessonIndex } from "@/schemas/lesson";

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

const getLessonIndex = vi.fn();
vi.mock("@/lib/content", () => ({
  getLessonIndex: () => getLessonIndex(),
}));

import LessonsPage from "./page";

const sampleIndex: LessonIndex = {
  lessons: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    title: i + 1 === 13 ? "〜が ほしいです" : `第 ${i + 1} 課`,
    vocabCount: i + 1 === 13 ? 12 : 0,
    grammarCount: i + 1 === 13 ? 2 : 0,
  })),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("LessonsPage", () => {
  it("成功:渲染 50 課,L13 顯示標題與字數並連到內頁", async () => {
    getLessonIndex.mockResolvedValue(sampleIndex);
    render(<LessonsPage />);

    await waitFor(() =>
      expect(screen.getByText("〜が ほしいです")).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("link")).toHaveLength(50);
    expect(screen.getByText("12 字")).toBeInTheDocument();

    const l13 = screen.getByRole("link", { name: /〜が ほしいです/ });
    expect(l13).toHaveAttribute("href", "/lessons/13");
  });

  it("載入中:資料未到前顯示載入提示", () => {
    getLessonIndex.mockReturnValue(new Promise(() => {})); // 永不 resolve
    render(<LessonsPage />);
    expect(screen.getByText("載入中…")).toBeInTheDocument();
  });

  it("失敗:顯示錯誤訊息", async () => {
    getLessonIndex.mockRejectedValue(new Error("HTTP 404"));
    render(<LessonsPage />);
    await waitFor(() =>
      expect(screen.getByText(/載入課程失敗.*HTTP 404/)).toBeInTheDocument(),
    );
  });
});
