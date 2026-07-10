import type { GrammarPoint, Lesson, Sentence, VocabItem } from "@/schemas/lesson";
import { findExampleSentence } from "./examples";

function vocab(surface: string, overrides: Partial<VocabItem> = {}): VocabItem {
  return {
    id: "L13-V001",
    ruby: [{ b: surface }],
    kana: surface,
    meaning: "測試",
    pos: "名",
    ...overrides,
  };
}

function sentence(text: string, id = "S"): Sentence {
  return { id, ruby: [{ b: text }], translation: `${text} 的翻譯` };
}

function grammar(examples: Sentence[]): GrammarPoint {
  return { id: "L13-G01", pattern: "型", examples };
}

function lesson(grammarPts: GrammarPoint[], dialogues: Sentence[] = []): Lesson {
  return { id: 13, title: "第13課", vocab: [], grammar: grammarPts, dialogues };
}

describe("findExampleSentence", () => {
  it("回傳文法例句中含該單字表面形的句子", () => {
    const l = lesson([grammar([sentence("公園で遊びます。", "S1")])]);
    const found = findExampleSentence(vocab("遊びます"), l);
    expect(found?.id).toBe("S1");
  });

  it("也會搜尋会話句", () => {
    const l = lesson([grammar([sentence("無關的句子。", "G1")])], [sentence("いっしょに遊びましょう。", "D1")]);
    // 会話用「遊び」;測完整表面形改用會出現的詞
    const found = findExampleSentence(vocab("遊び"), l);
    expect(found?.id).toBe("D1");
  });

  it("多句命中時取最短(i+1 傾向)", () => {
    const l = lesson([
      grammar([
        sentence("わたしは毎日この公園でゆっくり遊びます。", "LONG"),
        sentence("公園で遊びます。", "SHORT"),
      ]),
    ]);
    const found = findExampleSentence(vocab("遊びます"), l);
    expect(found?.id).toBe("SHORT");
  });

  it("無任何句子含該單字時回傳 null", () => {
    const l = lesson([grammar([sentence("これは本です。", "S1")])]);
    expect(findExampleSentence(vocab("飛行機"), l)).toBeNull();
  });

  it("單一字元的單字略過(避免誤配,如「本」配到「日本」)", () => {
    const l = lesson([grammar([sentence("わたしは日本にいます。", "S1")])]);
    expect(findExampleSentence(vocab("本"), l)).toBeNull();
  });

  it("以完整 ruby 表面形(非 kana)比對", () => {
    // 單字漢字寫法「遊びます」;句子用漢字 → 命中
    const v = vocab("あそびます", { ruby: [{ b: "遊", r: "あそ" }, { b: "びます" }] });
    const l = lesson([grammar([sentence("公園で遊びます。", "S1")])]);
    expect(findExampleSentence(v, l)?.id).toBe("S1");
  });
});
