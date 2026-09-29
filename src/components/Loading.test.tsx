import { render, screen } from "@testing-library/react";
import { Loading } from "./Loading";

describe("Loading", () => {
  it("預設文案「載入中…」,為 polite live region", () => {
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("載入中…");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("可自訂文案", () => {
    render(<Loading label="載入全部課程資料中…" />);
    expect(screen.getByRole("status")).toHaveTextContent("載入全部課程資料中…");
  });
});
