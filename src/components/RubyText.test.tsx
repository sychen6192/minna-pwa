import { render, screen } from "@testing-library/react";
import { RubyText } from "./RubyText";

const segments = [{ b: "遊", r: "あそ" }, { b: "びます" }];

describe("RubyText", () => {
  it("furigana=show:渲染讀音 <rt> 且保留基底文字", () => {
    const { container } = render(<RubyText segments={segments} />);
    expect(screen.getByText("あそ")).toBeInTheDocument();
    expect(container.querySelectorAll("rt")).toHaveLength(1);
    expect(container.textContent).toContain("遊");
    expect(container.textContent).toContain("びます");
  });

  it("furigana=hide:不渲染讀音,但基底文字仍在", () => {
    const { container } = render(
      <RubyText segments={segments} furigana="hide" />,
    );
    expect(screen.queryByText("あそ")).not.toBeInTheDocument();
    expect(container.querySelectorAll("rt")).toHaveLength(0);
    expect(container.textContent).toContain("遊");
    expect(container.textContent).toContain("びます");
  });

  it("無讀音段:不產生任何 <rt>", () => {
    const { container } = render(<RubyText segments={[{ b: "さびしい" }]} />);
    expect(container.querySelector("rt")).toBeNull();
    expect(container.textContent).toBe("さびしい");
  });

  it("多個漢字段:每段各產生一個 <rt>", () => {
    const { container } = render(
      <RubyText
        segments={[
          { b: "日本", r: "にほん" },
          { b: "語", r: "ご" },
        ]}
      />,
    );
    expect(container.querySelectorAll("rt")).toHaveLength(2);
  });
});
