import { describe, expect, it } from "vitest";
import { isJapanese, jaLang } from "./lang";

describe("isJapanese", () => {
  it("含假名 → 日文(即使夾雜中文說明)", () => {
    expect(isJapanese("動詞て形、〜て ください、〜て います")).toBe(true);
    expect(isJapanese("(名詞)が ほしいです")).toBe(true);
    expect(isJapanese("カリナ")).toBe(true);
  });

  it("無假名的日文術語 → 日文", () => {
    for (const s of ["数量詞", "形容詞", "尊敬語", "謙譲語・丁寧語", "受身（受身形）", "名詞修飾(連体修飾)", "可能動詞", "使役動詞"]) {
      expect(isJapanese(s)).toBe(true);
    }
  });

  it("無假名的中文說明 → 非日文", () => {
    for (const s of [
      "名詞・形容詞的過去式、比較",
      "普通形(常體)",
      "動詞的活用",
      "敬體和常體的區別",
      "常體的會話",
      "假定形(条件形)的變換方法",
      "「敬語」的種類",
      "句子修飾名詞",
      "授受表達方式",
      "被動動詞",
      "動詞字典形 時間／約束／用事",
      "假定形、〜",
    ]) {
      expect(isJapanese(s)).toBe(false);
    }
  });

  it("jaLang:日文回傳 ja,否則 undefined", () => {
    expect(jaLang("あいさつ")).toBe("ja");
    expect(jaLang("動詞的活用")).toBeUndefined();
  });
});
