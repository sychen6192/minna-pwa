import {
  GrammarPointSchema,
  LessonIndexSchema,
  LessonSchema,
  PosEnum,
  RubySegSchema,
  SentenceSchema,
  VocabItemSchema,
} from "./lesson";

// 合法基底,測試時局部覆寫
const validVocab = {
  id: "L13-V007",
  ruby: [{ b: "遊", r: "あそ" }, { b: "びます" }],
  kana: "あそびます",
  meaning: "玩、遊玩",
  pos: "動I",
};

const validSentence = {
  id: "L13-S01",
  ruby: [{ b: "車", r: "くるま" }, { b: "が ほしいです" }],
  translation: "我想要車子。",
};

const validGrammar = {
  id: "L13-G01",
  pattern: "(名詞)が ほしいです",
  explanation: "表達說話者想要某物。",
  examples: [validSentence],
};

const validLesson = {
  id: 13,
  title: "〜が ほしいです",
  vocab: [validVocab],
  grammar: [validGrammar],
  dialogues: [],
};

describe("RubySegSchema(ruby 結構)", () => {
  it.each([
    { b: "遊", r: "あそ" }, // 漢字段帶讀音
    { b: "びます" }, // 純假名段省略 r
    { b: "車", r: "くるま" },
  ])("接受合法分段 %o", (seg) => {
    expect(RubySegSchema.safeParse(seg).success).toBe(true);
  });

  it.each([
    { b: "" }, // base 不可空
    { b: "遊", r: "" }, // 有 r 則 r 不可空
    { r: "あそ" }, // 缺 base
  ])("拒絕非法分段 %o", (seg) => {
    expect(RubySegSchema.safeParse(seg).success).toBe(false);
  });
});

describe("PosEnum", () => {
  it.each(["名", "動I", "い形", "助詞", "其他"])("接受合法詞性 %s", (pos) => {
    expect(PosEnum.safeParse(pos).success).toBe(true);
  });

  it.each(["動", "形", "noun", ""])("拒絕非法詞性 %s", (pos) => {
    expect(PosEnum.safeParse(pos).success).toBe(false);
  });
});

describe("VocabItemSchema", () => {
  it.each([
    validVocab,
    { ...validVocab, id: "L01-V001", accent: 0 }, // 含 optional accent
    { ...validVocab, note: "自動詞", audio: "L13-V007.mp3" }, // 含 optional note/audio
  ])("接受合法單字", (v) => {
    expect(VocabItemSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    { ...validVocab, id: "L13-V07" }, // 流水碼需 3 位
    { ...validVocab, id: "L1-V001" }, // 課號需 2 位
    { ...validVocab, id: "V001" }, // 缺課號前綴
    { ...validVocab, pos: "動" }, // 非法詞性
    { ...validVocab, ruby: [] }, // ruby 至少 1 段
    { ...validVocab, meaning: "" }, // 釋義不可空
    { ...validVocab, accent: -1 }, // accent 需 >= 0
  ])("拒絕非法單字 %o", (v) => {
    expect(VocabItemSchema.safeParse(v).success).toBe(false);
  });
});

describe("GrammarPointSchema(id regex)", () => {
  it.each([
    validGrammar,
    { ...validGrammar, id: "L50-G99" },
    { ...validGrammar, id: "L01-G00" },
  ])("接受合法文法點", (g) => {
    expect(GrammarPointSchema.safeParse(g).success).toBe(true);
  });

  it("接受省略 explanation(教材本冊無解說 prose)", () => {
    const { explanation: _omit, ...noExplanation } = validGrammar;
    void _omit;
    expect(GrammarPointSchema.safeParse(noExplanation).success).toBe(true);
  });

  it.each([
    { ...validGrammar, id: "L13-G1" }, // 流水碼需 2 位
    { ...validGrammar, id: "L13-V01" }, // 類型字母需為 G
    { ...validGrammar, examples: [] }, // examples 至少 1 例
    { ...validGrammar, explanation: "" }, // 有給就不可為空
  ])("拒絕非法文法點 %o", (g) => {
    expect(GrammarPointSchema.safeParse(g).success).toBe(false);
  });
});

describe("SentenceSchema", () => {
  it("接受帶 speaker 的会話句", () => {
    expect(
      SentenceSchema.safeParse({ ...validSentence, speaker: "ミラー" }).success,
    ).toBe(true);
  });

  it("拒絕空 translation", () => {
    expect(
      SentenceSchema.safeParse({ ...validSentence, translation: "" }).success,
    ).toBe(false);
  });
});

describe("LessonSchema", () => {
  it.each([
    validLesson,
    { ...validLesson, id: 1, grammar: [], dialogues: [validSentence] }, // grammar 可空、含会話
    { ...validLesson, id: 50 },
  ])("接受合法課程", (l) => {
    expect(LessonSchema.safeParse(l).success).toBe(true);
  });

  it.each([
    { ...validLesson, id: 0 }, // 課號 >= 1
    { ...validLesson, id: 51 }, // 課號 <= 50
    { ...validLesson, vocab: [] }, // vocab 至少 1
    { ...validLesson, title: "" }, // 標題不可空
  ])("拒絕非法課程 %o", (l) => {
    expect(LessonSchema.safeParse(l).success).toBe(false);
  });
});

describe("LessonIndexSchema", () => {
  const entry = (id: number) => ({
    id,
    title: `第 ${id} 課`,
    vocabCount: 0,
    grammarCount: 0,
  });
  const fifty = Array.from({ length: 50 }, (_, i) => entry(i + 1));

  it("接受剛好 50 筆的索引", () => {
    expect(LessonIndexSchema.safeParse({ lessons: fifty }).success).toBe(true);
  });

  it.each([
    { lessons: fifty.slice(0, 49) }, // 少於 50
    { lessons: [...fifty, entry(51)] }, // 多於 50(且課號超界)
    { lessons: fifty.map((e) => ({ ...e, vocabCount: -1 })) }, // 計數需 >= 0
  ])("拒絕非法索引", (idx) => {
    expect(LessonIndexSchema.safeParse(idx).success).toBe(false);
  });
});
