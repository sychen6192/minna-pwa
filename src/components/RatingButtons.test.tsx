import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RatingButtons } from "./RatingButtons";
import type { IntervalPreviews } from "@/lib/srs";

const previews: IntervalPreviews = {
  again: { due: 1, days: 0 },
  hard: { due: 2, days: 1 },
  good: { due: 3, days: 3 },
  easy: { due: 4, days: 7 },
};

describe("RatingButtons", () => {
  it("渲染四鍵與預估間隔", () => {
    render(<RatingButtons previews={previews} onRate={() => {}} />);
    for (const label of ["重來", "困難", "良好", "輕鬆"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "重來" })).toHaveTextContent(
      "<1 天",
    );
    expect(screen.getByRole("button", { name: "良好" })).toHaveTextContent(
      "3 天",
    );
  });

  it("previews 為 null 時顯示佔位", () => {
    render(<RatingButtons previews={null} onRate={() => {}} />);
    expect(screen.getByRole("button", { name: "良好" })).toHaveTextContent("—");
  });

  it("點擊以對應 rating 呼叫 onRate", async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    render(<RatingButtons previews={previews} onRate={onRate} />);
    await user.click(screen.getByRole("button", { name: "良好" }));
    expect(onRate).toHaveBeenCalledWith(3);
  });
});
