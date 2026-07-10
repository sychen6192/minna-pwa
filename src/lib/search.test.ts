import type { Lesson } from "@/schemas/lesson";
import { buildSearchIndex, cjkTokenize, searchAll } from "./search";

describe("cjkTokenize", () => {
  it("CJK 連續文字切 bigram(日文無空格)", () => {
    const tokens = cjkTokenize("公園で遊びます");
    expect(tokens).toContain("公園");
    expect(tokens).toContain("遊び");
    expect(tokens).toContain("ます");
    // 全為 2-gram(或單字元 run)
    expect(tokens.every((t) => t.length <= 2)).toBe(true);
  });

  it("單一 CJK 字元 run 保留該字元", () => {
    expect(cjkTokenize("本")).toEqual(["本"]);
  });

  it("拉丁/數字整詞保留,標點與空白為分界", () => {
    expect(cjkTokenize("JLPT N5!")).toEqual(["JLPT", "N5"]);
  });

  it("混合文字:各 run 獨立切分,標點不入 token", () => {
    const tokens = cjkTokenize("わたしは マイク です。");
    expect(tokens).toContain("わた");
    expect(tokens).toContain("マイ");
    expect(tokens).toContain("です");
    expect(tokens.some((t) => t.includes("。") || t.includes(" "))).toBe(false);
  });

  it("空字串回空陣列", () => {
    expect(cjkTokenize("")).toEqual([]);
  });
});

const lessons: Lesson[] = [
  {
    id: 13,
    title: "〜が ほしいです",
    vocab: [
      {
        id: "L13-V001",
        ruby: [{ b: "遊", r: "あそ" }, { b: "びます" }],
        kana: "あそびます",
        meaning: "玩、遊樂",
        pos: "動I",
      },
    ],
    grammar: [
      {
        id: "L13-G01",
        pattern: "(名詞)が 欲しいです",
        explanation: "表現說話人想要得到某物;「ほしい」是い形容詞。",
        examples: [
          {
            id: "L13-S01",
            ruby: [{ b: "わたしは エンジニアです。" }],
            translation: "我是工程師。",
          },
        ],
      },
    ],
    dialogues: [],
  },
  {
    id: 1,
    title: "第一課",
    vocab: [
      {
        id: "L01-V001",
        ruby: [{ b: "先生", r: "せんせい" }],
        kana: "せんせい",
        meaning: "老師",
        pos: "名",
      },
    ],
    grammar: [],
    dialogues: [],
  },
];

describe("buildSearchIndex + searchAll", () => {
  const index = buildSearchIndex(lessons);

  it("文型 pattern 命中(日文查詢)", () => {
    const hits = searchAll(index, "欲しい");
    const g = hits.find((h) => h.kind === "grammar");
    expect(g).toMatchObject({
      id: "L13-G01",
      lessonId: 13,
      anchor: "L13-G01",
      title: "(名詞)が 欲しいです",
    });
  });

  it("解說命中(中文查詢)", () => {
    const hits = searchAll(index, "想要");
    expect(hits.some((h) => h.id === "L13-G01")).toBe(true);
  });

  it("單字命中:kana 與漢字表面形皆可查", () => {
    expect(searchAll(index, "あそびます").some((h) => h.id === "L13-V001")).toBe(true);
    expect(searchAll(index, "遊びます").some((h) => h.id === "L13-V001")).toBe(true);
    const v = searchAll(index, "老師").find((h) => h.kind === "vocab");
    expect(v).toMatchObject({ id: "L01-V001", lessonId: 1, snippet: "老師" });
  });

  it("例句命中:anchor 指向所屬文法點", () => {
    const hits = searchAll(index, "エンジニア");
    const s = hits.find((h) => h.kind === "example");
    expect(s).toMatchObject({
      id: "L13-S01",
      lessonId: 13,
      anchor: "L13-G01",
      snippet: "我是工程師。",
    });
  });

  it("空白/空字串查詢回空陣列", () => {
    expect(searchAll(index, "")).toEqual([]);
    expect(searchAll(index, "   ")).toEqual([]);
  });

  it("limit 裁切結果數", () => {
    const hits = searchAll(index, "です", 1);
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});
