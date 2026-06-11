import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

// 固定 pathname 在課程內頁,驗證 active 態
vi.mock("next/navigation", () => ({
  usePathname: () => "/lessons/13",
}));

// 避免測試需要 App Router context:以純 anchor 取代 next/link
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

import { BottomNav } from "./BottomNav";

describe("BottomNav", () => {
  it("渲染 5 個分頁連結", () => {
    render(<BottomNav />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    for (const label of ["課程", "複習", "測驗", "統計", "設定"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("依 pathname 標示 active(/lessons/13 → 課程)", () => {
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "課程" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "複習" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
