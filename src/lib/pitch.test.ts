import { describe, expect, it } from "vitest";
import { pitchPattern, splitMorae } from "./pitch";

describe("splitMorae", () => {
  it("一般假名逐字成拍", () => {
    expect(splitMorae("はな")).toEqual(["は", "な"]);
  });

  it("拗音(小さい ゃゅょ)併入前一拍", () => {
    expect(splitMorae("きゃく")).toEqual(["きゃ", "く"]);
    expect(splitMorae("びょういん")).toEqual(["びょ", "う", "い", "ん"]);
  });

  it("促音っ、長音ー、撥音ん 各自成拍", () => {
    expect(splitMorae("がっこう")).toEqual(["が", "っ", "こ", "う"]);
    expect(splitMorae("しんぶん")).toEqual(["し", "ん", "ぶ", "ん"]);
    expect(splitMorae("ちょっと")).toEqual(["ちょ", "っ", "と"]);
  });

  it("片假名(含長音、小書き)同樣切拍", () => {
    expect(splitMorae("コーヒー")).toEqual(["コ", "ー", "ヒ", "ー"]);
    expect(splitMorae("シャワー")).toEqual(["シャ", "ワ", "ー"]);
    expect(splitMorae("ファックス")).toEqual(["ファ", "ッ", "ク", "ス"]);
  });

  it("空字串回傳空陣列", () => {
    expect(splitMorae("")).toEqual([]);
  });
});

describe("pitchPattern", () => {
  it("accent 未定義 → null(無資料不標)", () => {
    expect(pitchPattern("はな", undefined)).toBeNull();
  });

  it("平板型 [0]:首拍低、其後高、無下降核", () => {
    const p = pitchPattern("さくら", 0);
    expect(p).toEqual([
      { text: "さ", high: false, dropAfter: false },
      { text: "く", high: true, dropAfter: false },
      { text: "ら", high: true, dropAfter: false },
    ]);
  });

  it("頭高型 [1]:首拍高、其後低、核在第 1 拍", () => {
    const p = pitchPattern("てんき", 1);
    expect(p).toEqual([
      { text: "て", high: true, dropAfter: true },
      { text: "ん", high: false, dropAfter: false },
      { text: "き", high: false, dropAfter: false },
    ]);
  });

  it("中高型 [2]:低高低、核在第 2 拍", () => {
    const p = pitchPattern("たまご", 2);
    expect(p).toEqual([
      { text: "た", high: false, dropAfter: false },
      { text: "ま", high: true, dropAfter: true },
      { text: "ご", high: false, dropAfter: false },
    ]);
  });

  it("尾高型 [n=拍數]:詞內同平板、核在末拍(接助詞才下降)", () => {
    const p = pitchPattern("はな", 2);
    expect(p).toEqual([
      { text: "は", high: false, dropAfter: false },
      { text: "な", high: true, dropAfter: true },
    ]);
  });

  it("單拍詞:[1] 高+核;[0] 低(助詞上揚)", () => {
    expect(pitchPattern("き", 1)).toEqual([{ text: "き", high: true, dropAfter: true }]);
    expect(pitchPattern("み", 0)).toEqual([{ text: "み", high: false, dropAfter: false }]);
  });

  it("拗音詞:拍為單位而非字為單位", () => {
    // びょういん [0]:びょ 低,う・い・ん 高
    const p = pitchPattern("びょういん", 0);
    expect(p?.map((m) => m.high)).toEqual([false, true, true, true]);
  });

  it("accent 超出拍數或為負 → null(防禦壞資料)", () => {
    expect(pitchPattern("はな", 3)).toBeNull();
    expect(pitchPattern("はな", -1)).toBeNull();
  });

  it("空字串 → null", () => {
    expect(pitchPattern("", 0)).toBeNull();
  });
});
