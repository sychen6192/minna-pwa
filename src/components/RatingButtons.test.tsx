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
  it("渲染四鍵;無障礙名稱含預估間隔(不含快捷鍵數字)", () => {
    render(<RatingButtons previews={previews} onRate={() => {}} />);
    for (const name of ["重來 <1 天", "困難 1 天", "良好 3 天", "輕鬆 7 天"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("快捷鍵數字只在精確指標(pointer-fine)顯示,且對輔助技術隱藏", () => {
    render(<RatingButtons previews={previews} onRate={() => {}} />);
    const good = screen.getByRole("button", { name: /^良好/ });
    const digit = [...good.querySelectorAll("span")].find((s) => s.textContent === "3");
    expect(digit).toHaveAttribute("aria-hidden", "true");
    expect(digit).toHaveClass("hidden", "pointer-fine:block");
  });

  it("previews 為 null 時顯示佔位(佔位不念出)", () => {
    render(<RatingButtons previews={null} onRate={() => {}} />);
    const good = screen.getByRole("button", { name: "良好" });
    expect(good).toHaveTextContent("—");
  });

  it("點擊以對應 rating 呼叫 onRate", async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    render(<RatingButtons previews={previews} onRate={onRate} />);
    await user.click(screen.getByRole("button", { name: /^良好/ }));
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it("disabled 時四鍵皆停用、點擊不觸發 onRate(評分寫入中)", async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    render(<RatingButtons previews={previews} onRate={onRate} disabled />);
    for (const label of ["重來", "困難", "良好", "輕鬆"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: /^良好/ }));
    expect(onRate).not.toHaveBeenCalled();
  });
});
