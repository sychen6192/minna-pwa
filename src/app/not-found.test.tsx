import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

describe("NotFound(404)", () => {
  it("繁中說明,並提供回首頁與課程列表", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "找不到這個頁面" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回首頁" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "課程列表" })).toHaveAttribute("href", "/lessons");
    expect(screen.queryByText(/could not be found/i)).not.toBeInTheDocument();
  });
});
