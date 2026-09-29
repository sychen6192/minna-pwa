import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Button, buttonVariants } from "./button";

describe("Button", () => {
  it("預設為主要按鈕(primary、h-11)且 type=button", () => {
    render(<Button>開始複習</Button>);
    const btn = screen.getByRole("button", { name: "開始複習" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveClass(
      "bg-primary",
      "text-primary-foreground",
      "h-11",
      "rounded-lg",
    );
    // 按下/懸停加深(專用 token),不以透明度變淺而降低白字對比
    expect(btn).toHaveClass("hover:bg-primary-hover", "active:bg-primary-hover");
  });

  it.each([
    ["outline", ["border", "border-input"], ["bg-primary"]],
    ["secondary", ["bg-muted", "text-foreground"], ["bg-primary"]],
    ["ghost", ["hover:bg-muted"], ["bg-primary", "border"]],
    [
      "destructive",
      ["bg-destructive", "text-destructive-foreground"],
      ["bg-primary"],
    ],
    ["link", ["text-link", "underline"], ["bg-primary"]],
  ] as const)("variant=%s 套用對應 token class", (variant, has, hasNot) => {
    render(<Button variant={variant}>動作</Button>);
    const btn = screen.getByRole("button", { name: "動作" });
    expect(btn).toHaveClass(...has);
    for (const cls of hasNot) expect(btn).not.toHaveClass(cls);
  });

  it.each([
    ["default", "h-11"],
    ["sm", "h-9"],
    ["icon", "size-11"],
  ] as const)("size=%s → %s", (size, cls) => {
    render(
      <Button size={size} aria-label="按鈕">
        x
      </Button>,
    );
    expect(screen.getByRole("button", { name: "按鈕" })).toHaveClass(cls);
  });

  it("className 可覆寫同類 utility(tailwind-merge)", () => {
    render(
      <Button size="sm" className="h-12 w-full">
        下一題
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "下一題" });
    expect(btn).toHaveClass("h-12", "w-full");
    expect(btn).not.toHaveClass("h-9");
  });

  it("disabled 時不觸發 onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        作答
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "作答" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("轉傳 props 與 ref(type、aria-*、data-*、onClick)", async () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button
        ref={ref}
        type="submit"
        aria-pressed
        data-testid="btn"
        onClick={onClick}
      >
        7 天
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(ref.current).toBe(btn);
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("buttonVariants", () => {
  it("供 Link 使用:回傳合併後的 class 字串", () => {
    const cls = buttonVariants({ variant: "link", className: "px-3 text-sm" });
    expect(cls).toContain("text-link");
    expect(cls).toContain("px-3");
    expect(cls).toContain("text-sm");
    // 同類 utility 由 className 覆寫
    expect(cls).not.toContain("px-5");
    expect(cls).not.toContain("text-base");
  });

  it("無參數時為預設主要按鈕", () => {
    expect(buttonVariants()).toContain("bg-primary");
    expect(buttonVariants()).toContain("h-11");
  });
});
