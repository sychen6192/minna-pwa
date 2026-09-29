import { describe, expect, it } from "vitest";
import { isKana, isKanaSurface, kanaHeadword, pitchPattern, splitMorae } from "./pitch";

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

  it("非假名記號(…、・〜［］空白)不計拍", () => {
    expect(splitMorae("…ばい")).toEqual(["ば", "い"]);
    expect(splitMorae("に、さん")).toEqual(["に", "さ", "ん"]);
    expect(splitMorae("スパイス・コーナー")).toHaveLength(8);
    expect(splitMorae("どう いたしまして。")).toHaveLength(8);
    expect(splitMorae("〜")).toEqual([]);
  });

  it("小書き假名只併入緊鄰的前一拍(不跨記號)", () => {
    expect(splitMorae("〜ちゃん")).toEqual(["ちゃ", "ん"]);
    // 中間隔著記號:小書き不跨記號併入,自成一拍
    expect(splitMorae("き・ょう")).toEqual(["き", "ょ", "う"]);
  });
});

describe("isKana", () => {
  it("平/片假名、長音、踊り字計拍;記號、漢字、英數不計", () => {
    for (const ch of ["あ", "ゖ", "ア", "ヴ", "ヺ", "ー", "ゝ", "ヾ"]) expect(isKana(ch)).toBe(true);
    for (const ch of ["…", "、", "。", "・", "〜", "［", "］", " ", "倍", "々", "A", "2"])
      expect(isKana(ch)).toBe(false);
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

  it("…ばい [0]:… 原樣不計拍,ば 低、い 高(DQ-09)", () => {
    const p = pitchPattern("…ばい", 0);
    expect(p).toEqual([
      { text: "…", high: false, dropAfter: false, mark: true },
      { text: "ば", high: false, dropAfter: false },
      { text: "い", high: true, dropAfter: false },
    ]);
    expect(p?.filter((m) => !m.mark)).toEqual([
      { text: "ば", high: false, dropAfter: false },
      { text: "い", high: true, dropAfter: false },
    ]);
  });

  it("に、さん [1]:、 不計拍,核在 に", () => {
    expect(pitchPattern("に、さん", 1)).toEqual([
      { text: "に", high: true, dropAfter: true },
      { text: "、", high: false, dropAfter: false, mark: true },
      { text: "さ", high: false, dropAfter: false },
      { text: "ん", high: false, dropAfter: false },
    ]);
  });

  it("拍數以假名計:記號不佔 accent 的上限", () => {
    // …ばい 只有 2 拍 → accent 3 為壞資料
    expect(pitchPattern("…ばい", 2)).not.toBeNull();
    expect(pitchPattern("…ばい", 3)).toBeNull();
  });

  it("すき［な］:括號記號不計拍、括號內假名照計(與 enrich-accents 以「すきな」查辭典一致)", () => {
    const p = pitchPattern("すき［な］", 2);
    expect(p?.map((m) => [m.text, m.high, m.dropAfter, m.mark ?? false])).toEqual([
      ["す", false, false, false],
      ["き", true, true, false],
      ["［", false, false, true],
      ["な", false, false, false],
      ["］", false, false, true],
    ]);
    expect(pitchPattern("すき［な］", 4)).toBeNull();
  });

  it("只有記號、沒有任何拍 → null", () => {
    expect(pitchPattern("〜", 0)).toBeNull();
    expect(pitchPattern("……", 0)).toBeNull();
  });
});

describe("kanaHeadword(純假名字以重音標記當標題)", () => {
  const w = (b: string, kana: string, accent?: number) => ({ ruby: [{ b }], kana, accent });

  it("表面 = kana 且有 accent → 回傳表面", () => {
    expect(kanaHeadword(w("つけます", "つけます", 3))).toBe("つけます");
    expect(kanaHeadword(w("テレビ", "テレビ", 1))).toBe("テレビ");
  });

  it("表面只多了記號(。?〜…［］空白)→ 仍以表面呈現,記號原樣保留", () => {
    expect(kanaHeadword(w("どうぞ。", "どうぞ", 1))).toBe("どうぞ。");
    expect(kanaHeadword(w("あの〜", "あの", 0))).toBe("あの〜");
    expect(kanaHeadword(w("［カセット］テープ", "カセットテープ", 5))).toBe("［カセット］テープ");
    expect(kanaHeadword(w("どう いたしまして。", "どういたしまして", 0))).toBe(
      "どう いたしまして。",
    );
  });

  it("無 accent 或 accent 不合法 → null(照舊以 RubyText 呈現)", () => {
    expect(kanaHeadword(w("ほしい", "ほしい"))).toBeNull();
    expect(kanaHeadword(w("はな", "はな", 5))).toBeNull();
  });

  it("含漢字或表面與讀音的假名不同 → null(標題與重音讀音並列)", () => {
    expect(
      kanaHeadword({ ruby: [{ b: "好", r: "す" }, { b: "き" }], kana: "すき", accent: 2 }),
    ).toBeNull();
    expect(kanaHeadword(w("ハンサム［な］", "ハンサム", 1))).toBeNull();
    expect(kanaHeadword(w("いい （よい）", "いい", 1))).toBeNull();
    expect(kanaHeadword(w("2、3〜", "に、さん", 1))).toBeNull();
    expect(kanaHeadword(w("CD", "シーディー", 3))).toBeNull();
    expect(kanaHeadword(w("「〜を」ください。", "ください", 3))).toBeNull();
  });

  it("isKanaSurface 不看 accent:表面即讀音者,卡片背面不必再列讀音", () => {
    expect(isKanaSurface(w("ほしい", "ほしい"))).toBe(true);
    expect(isKanaSurface(w("どうぞ。", "どうぞ"))).toBe(true);
    expect(isKanaSurface({ ruby: [{ b: "車", r: "くるま" }], kana: "くるま" })).toBe(false);
    expect(isKanaSurface(w("ハンサム［な］", "ハンサム"))).toBe(false);
  });
});
