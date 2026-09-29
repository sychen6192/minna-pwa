import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PitchAccent } from "./PitchAccent";

/** sr-only 說明(「てんき、重音 1 型(頭高)」;讀音在其內的 lang=ja span) */
function srLabel(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".sr-only");
}

describe("PitchAccent", () => {
  it("無 accent 資料 → 降級為純文字 kana(lang=ja),無重音標記", () => {
    const { container } = render(<PitchAccent kana="はな" />);
    expect(screen.getByText("はな")).toHaveAttribute("lang", "ja");
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
    expect(srLabel(container)).toHaveTextContent(/^てんき、重音 1 型\(頭高\)$/);
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

  it("語言標記:視覺層 lang=ja 且 aria-hidden;中文說明為 sr-only,只有讀音掛 ja", () => {
    const { container } = render(<PitchAccent kana="さくら" accent={0} />);
    const visual = container.querySelector("[data-mora]")?.closest("[aria-hidden]");
    expect(visual).toHaveAttribute("lang", "ja");
    expect(visual).toHaveAttribute("aria-hidden", "true");
    // 型號徽章在視覺層內(同樣對輔助技術隱藏)
    expect(visual?.querySelector("[data-badge]")).toHaveTextContent("[0]");
    const label = srLabel(container);
    expect(label).toHaveTextContent("さくら、重音 0 型(平板)");
    expect(label).not.toHaveAttribute("lang");
    expect(label?.querySelector('[lang="ja"]')).toHaveTextContent(/^さくら$/);
    // 沒有任何帶 lang=ja 的元素同時帶中文無障礙名稱
    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("非假名記號原樣顯示、不計拍:…ばい [0] → ば 低、い 高,sr 讀音不含記號", () => {
    const { container } = render(<PitchAccent kana="…ばい" accent={0} />);
    const morae = container.querySelectorAll("[data-mora]");
    expect(morae).toHaveLength(2);
    expect(morae[0]).toHaveTextContent("ば");
    expect(morae[0]).not.toHaveAttribute("data-high");
    expect(morae[1]).toHaveAttribute("data-high");
    expect(container.querySelector("[data-mark]")).toHaveTextContent("…");
    expect(srLabel(container)).toHaveTextContent("ばい、重音 0 型(平板)");
  });

  it("平板型尾端延伸線接在最後一拍後、尾隨記號之前", () => {
    const { container } = render(<PitchAccent kana="どうぞ。" accent={0} />);
    const tail = container.querySelector("[data-tail]");
    expect(tail?.previousElementSibling).toHaveTextContent("ぞ");
    expect(tail?.nextElementSibling).toHaveAttribute("data-mark");
  });

  it("依教材空格切成詞組:空格為換行點(不包在不斷行的詞組內),徽章黏在最後一組", () => {
    const { container } = render(<PitchAccent kana="どう いたしまして。" accent={0} />);
    const words = container.querySelectorAll("[data-word]");
    expect(words).toHaveLength(2);
    expect(words[0]).toHaveTextContent(/^どう$/);
    expect(words[1]).toHaveTextContent(/^いたしまして。\[0\]$/);
    expect(words[0].querySelector("[data-badge]")).toBeNull();
    expect(words[1].querySelector("[data-badge]")).not.toBeNull();
    // 空格是詞組之間的一般文字(可斷行),不是詞組內的記號
    expect(container.querySelector("[data-mark]")?.textContent).toBe("。");
    const visual = words[0].parentElement;
    expect(visual?.textContent).toBe("どう いたしまして。[0]");
    // 拍序跨詞組連續:第 1 拍(ど)低、其餘高;尾端延伸線在最後一拍(て)後
    const morae = container.querySelectorAll("[data-mora]");
    expect(morae).toHaveLength(8);
    expect(morae[0]).not.toHaveAttribute("data-high");
    expect(morae[1]).toHaveAttribute("data-high");
    expect(morae[2]).toHaveAttribute("data-high");
    expect(container.querySelector("[data-tail]")?.previousElementSibling).toHaveTextContent("て");
    expect(srLabel(container)).toHaveTextContent("どういたしまして、重音 0 型(平板)");
  });

  it("無空格者為單一詞組;記號與相鄰的拍綁在一起(組內換行時守禁則)", () => {
    const { container } = render(<PitchAccent kana="いらっしゃいませ。" accent={6} />);
    expect(container.querySelectorAll("[data-word]")).toHaveLength(1);
    // 句號黏在前一拍(不落在行首)
    const period = container.querySelector("[data-mark]");
    expect(period?.parentElement).toHaveTextContent(/^せ。$/);

    const { container: tape } = render(<PitchAccent kana="［カセット］テープ" accent={5} />);
    const marks = tape.querySelectorAll("[data-mark]");
    // 開括號黏在下一拍(不留在行尾)、閉括號黏在前一拍
    expect(marks[0].parentElement).toHaveTextContent(/^［カ$/);
    expect(marks[1].parentElement).toHaveTextContent(/^ト］$/);
  });

  it("型名以拍數判斷(記號不計):に、さん [1] 頭高;…ばい [2] 尾高", () => {
    const { container, rerender } = render(<PitchAccent kana="に、さん" accent={1} />);
    expect(srLabel(container)).toHaveTextContent("にさん、重音 1 型(頭高)");
    rerender(<PitchAccent kana="…ばい" accent={2} />);
    expect(srLabel(container)).toHaveTextContent("ばい、重音 2 型(尾高)");
  });
});
