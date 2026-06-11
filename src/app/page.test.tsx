import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home(佔位首頁)", () => {
  it("渲染專案標題", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { name: "みんなの日本語 學習 PWA" }),
    ).toBeInTheDocument();
  });
});
