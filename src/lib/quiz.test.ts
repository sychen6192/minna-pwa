import {
  checkInput,
  generateQuiz,
  pickDistractors,
  type McqQuestion,
  type QuizCandidate,
} from "./quiz";

function cand(
  id: string,
  lessonId: number,
  pos: QuizCandidate["pos"],
  meaning = id,
  kana = id,
): QuizCandidate {
  return { id, lessonId, pos, meaning, kana, ruby: [{ b: kana }] };
}

const ZERO = () => 0; // 確定性 shuffle

describe("checkInput", () => {
  it("羅馬字 / 平假名 / 片假名 視為同答", () => {
    expect(checkInput("sanpo", "さんぽ")).toBe(true);
    expect(checkInput("さんぽ", "さんぽ")).toBe(true);
    expect(checkInput("サンポ", "さんぽ")).toBe(true);
  });

  it("前後空白忽略", () => {
    expect(checkInput("  さんぽ  ", "さんぽ")).toBe(true);
  });

  it("不符與空輸入回 false", () => {
    expect(checkInput("ねこ", "さんぽ")).toBe(false);
    expect(checkInput("", "さんぽ")).toBe(false);
    expect(checkInput("   ", "さんぽ")).toBe(false);
  });
});

describe("pickDistractors", () => {
  const answer = cand("A", 13, "名", "答案", "こたえ");

  it("優先同課同詞性", () => {
    const pool = [
      answer,
      cand("s1", 13, "名"),
      cand("s2", 13, "名"),
      cand("s3", 13, "名"),
      cand("other", 14, "名"), // 鄰近課
      cand("verb", 13, "動I"), // 同課不同詞性
    ];
    const d = pickDistractors(answer, pool, 3, ZERO);
    expect(d).toHaveLength(3);
    expect(d.every((c) => c.lessonId === 13 && c.pos === "名")).toBe(true);
  });

  it("同課同詞性不足 → 取鄰近課同詞性,依課號距離", () => {
    const pool = [
      answer,
      cand("far", 20, "名"),
      cand("near1", 12, "名"),
      cand("near2", 14, "名"),
      cand("mid", 11, "名"),
    ];
    const d = pickDistractors(answer, pool, 2, ZERO);
    expect(d.map((c) => c.id).sort()).toEqual(["near1", "near2"]); // 距離 1 優先
  });

  it("同詞性耗盡才用其他詞性", () => {
    const pool = [
      answer,
      cand("n1", 13, "名"),
      cand("v1", 14, "動I"),
      cand("v2", 15, "い形"),
    ];
    const d = pickDistractors(answer, pool, 3, ZERO);
    expect(d[0].id).toBe("n1"); // 同詞性先
    expect(d.map((c) => c.id)).toContain("v1");
    expect(d).toHaveLength(3);
  });

  it("排除正解、同義、同音、重複", () => {
    const pool = [
      answer,
      cand("dupMeaning", 13, "名", "答案", "ちがう"), // 同義 → 排除
      cand("dupKana", 13, "名", "別的", "こたえ"), // 同音 → 排除
      cand("ok", 13, "名", "可以", "おーけー"),
    ];
    const d = pickDistractors(answer, pool, 5, ZERO);
    expect(d.map((c) => c.id)).toEqual(["ok"]);
  });

  it("退化:候選不足時回傳可得數量,不含正解、不重複", () => {
    const pool = [answer, cand("only", 13, "名")];
    const d = pickDistractors(answer, pool, 3, ZERO);
    expect(d).toHaveLength(1);
    expect(d[0].id).toBe("only");
  });
});

describe("generateQuiz", () => {
  const pool: QuizCandidate[] = [
    cand("L13-V001", 13, "名", "狗", "いぬ"),
    cand("L13-V002", 13, "名", "貓", "ねこ"),
    cand("L13-V003", 13, "名", "鳥", "とり"),
    cand("L13-V004", 13, "名", "魚", "さかな"),
    cand("L13-V005", 13, "名", "山", "やま"),
    cand("L12-V001", 12, "名", "海", "うみ"),
    cand("L14-V001", 14, "名", "川", "かわ"),
  ];

  it("為目標課出題,題數受 count 限制", () => {
    const qs = generateQuiz(13, pool, { count: 3, rng: ZERO });
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.answer.lessonId === 13)).toBe(true);
  });

  it("目標單字不足 count 時以實際數量為準", () => {
    const qs = generateQuiz(13, pool, { count: 10, rng: ZERO });
    expect(qs).toHaveLength(5); // 第13課僅 5 字
  });

  it("題型依 types 輪替", () => {
    const qs = generateQuiz(13, pool, {
      count: 5,
      types: ["jp-to-zh", "zh-to-jp", "input"],
      rng: ZERO,
    });
    expect(qs.map((q) => q.type)).toEqual([
      "jp-to-zh",
      "zh-to-jp",
      "input",
      "jp-to-zh",
      "zh-to-jp",
    ]);
  });

  it("選擇題:四選一、恰一正解、含正解、不含重複", () => {
    const qs = generateQuiz(13, pool, {
      count: 2,
      types: ["jp-to-zh"],
      optionCount: 4,
      rng: ZERO,
    });
    const mcq = qs[0] as McqQuestion;
    expect(mcq.options).toHaveLength(4);
    expect(mcq.options.filter((o) => o.correct)).toHaveLength(1);
    expect(mcq.options.find((o) => o.correct)?.id).toBe(mcq.answer.id);
    const ids = mcq.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(4); // 無重複
  });

  it("types 為空回傳空陣列", () => {
    expect(generateQuiz(13, pool, { types: [], rng: ZERO })).toEqual([]);
  });
});
