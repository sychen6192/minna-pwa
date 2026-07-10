import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PitchAccent } from "./PitchAccent";

describe("PitchAccent", () => {
  it("無 accent 資料 → 降級為純文字 kana,無重音標記", () => {
    const { container } = render(<PitchAccent kana="はな" />);
    expect(screen.getByText("はな")).toBeInTheDocument();
    expect(container.querySelector("[data-high]")).toBeNull();
    expect(container.textContent).not.toContain("[");
  });

  it("accent 超出拍數(壞資料)→ 同樣降級為純文字", () => {
    const { container } = render(<PitchAccent kana="はな" accent={5} />);
    expect(screen.getByText("はな")).toBeInTheDocument();
    expect(container.querySelector("[data-high]")).toBeNull();
  });

  it("頭高型 [1]:首拍高且帶下降核,其餘低;顯示型號徽章", () => {
    const { container } = render(<PitchAccent kana="てんき" accent={1} />);
    expect(
      screen.getByLabelText("てんき、重音 1 型(頭高)"),
    ).toBeInTheDocument();
    const morae = container.querySelectorAll("[data-mora]");
    expect(morae).toHaveLength(3);
    expect(morae[0]).toHaveAttribute("data-high");
    expect(morae[0]).toHaveAttribute("data-drop");
    expect(morae[1]).not.toHaveAttribute("data-high");
    expect(morae[2]).not.toHaveAttribute("data-high");
    expect(container.textContent).toContain("[1]");
  });

  it("平板型 [0]:第 2 拍起高、無下降核、帶尾端延伸線", () => {
    const { container } = render(<PitchAccent kana="さくら" accent={0} />);
    const morae = container.querySelectorAll("[data-mora]");
    expect(morae[0]).not.toHaveAttribute("data-high");
    expect(morae[1]).toHaveAttribute("data-high");
    expect(morae[2]).toHaveAttribute("data-high");
    expect(container.querySelector("[data-drop]")).toBeNull();
    expect(container.querySelector("[data-tail]")).not.toBeNull();
    expect(container.textContent).toContain("[0]");
  });

  it("尾高型 [n=拍數]:末拍高且帶核,無尾端延伸線", () => {
    const { container } = render(<PitchAccent kana="はな" accent={2} />);
    const morae = container.querySelectorAll("[data-mora]");
    expect(morae[1]).toHaveAttribute("data-high");
    expect(morae[1]).toHaveAttribute("data-drop");
    expect(container.querySelector("[data-tail]")).toBeNull();
  });

  it("以拍為單位渲染:拗音併入同一拍", () => {
    const { container } = render(<PitchAccent kana="きゃく" accent={1} />);
    const morae = container.querySelectorAll("[data-mora]");
    expect(morae).toHaveLength(2);
    expect(morae[0]).toHaveTextContent("きゃ");
  });
});
