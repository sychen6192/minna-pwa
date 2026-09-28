import { SUPPLEMENT_NOTE } from "./notes";
import {
  acceptedAnswers,
  answerLabel,
  canInput,
  checkAnswer,
  checkInput,
  generateQuiz,
  pickDistractors,
  type McqQuestion,
  type QuizCandidate,
} from "./quiz";
import type { RubySeg } from "@/schemas/lesson";

function cand(
  id: string,
  lessonId: number,
  pos: QuizCandidate["pos"],
  meaning = id,
  kana = id,
): QuizCandidate {
  return { id, lessonId, pos, meaning, kana, ruby: [{ b: kana }] };
}

/** 含漢字讀音的候選(可出輸入題) */
function kanjiCand(
  id: string,
  lessonId: number,
  meaning: string,
  kanji: string,
  kana: string,
): QuizCandidate {
  return {
    id,
    lessonId,
    pos: "名",
    meaning,
    kana,
    ruby: [{ b: kanji, r: kana }],
  };
}

/** 教材表記的單字(ruby 分段照資料,只取判分用欄位) */
const word = (ruby: RubySeg[], kana: string) => ({ ruby, kana });

const ZERO = () => 0; // 確定性 shuffle

/** 可重現的偽亂數(mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  it("長音「ー」:羅馬字 - / 平假名ー / 母音寫法皆可(T10.4)", () => {
    for (const input of [
      "ko-hi-",
      "こーひー",
      "コーヒー",
      "kouhii",
      "こうひい",
      "koohii",
      "Ko-Hi-",
    ]) {
      expect(checkInput(input, "コーヒー")).toBe(true);
    }
    for (const input of ["ka-do", "kaado", "かーど", "カード"]) {
      expect(checkInput(input, "カード")).toBe(true);
    }
    expect(checkInput("bo-rupen", "ボールペン")).toBe(true);
    expect(checkInput("ro-maji", "ローマじ")).toBe(true);
    expect(checkInput("ねこ", "コーヒー")).toBe(false);
    expect(checkInput("kohi", "コーヒー")).toBe(false); // 漏打長音仍錯
    expect(checkInput("borupen", "ボールペン")).toBe(false);
  });

  it("全形英數、半形片假名、各種橫線與標點正規化", () => {
    expect(checkInput("ｋｏ－ｈｉ－", "コーヒー")).toBe(true);
    expect(checkInput("ｺｰﾋｰ", "コーヒー")).toBe(true);
    expect(checkInput("え―と", "えーと")).toBe(true); // U+2015
    expect(checkInput("えーと", "え―と")).toBe(true);
    expect(checkInput("e—to", "え―と")).toBe(true); // U+2014
    expect(checkInput("さん ぽ。", "さんぽ")).toBe(true);
  });
});

describe("acceptedAnswers / checkAnswer(教材表記,T10.4)", () => {
  const coffee = word([{ b: "コーヒー" }], "コーヒー");
  const suki = word([{ b: "好", r: "す" }, { b: "き［な］" }], "すき［な］");
  const otto = word(
    [{ b: "夫", r: "おっと" }, { b: "／" }, { b: "主人", r: "しゅじん" }],
    "おっと／しゅじん",
  );
  const toilet = word(
    [{ b: "トイレ（お" }, { b: "手洗", r: "てあら" }, { b: "い）" }],
    "トイレおてあらい",
  );
  const ii = word([{ b: "いい （よい）" }], "いい");
  const shigoto = word([{ b: "［お］" }, { b: "仕事", r: "しごと" }], "しごと");

  it("ko-hi- / こーひー / kaado / kouhii 對 コーヒー、カード", () => {
    for (const input of [
      "ko-hi-",
      "こーひー",
      "コーヒー",
      "kouhii",
      "こうひい",
    ]) {
      expect(checkAnswer(input, coffee)).toBe(true);
    }
    expect(checkAnswer("kaado", word([{ b: "カード" }], "カード"))).toBe(true);
    expect(checkAnswer("ねこ", coffee)).toBe(false);
  });

  it("［な］可省略:すき / すきな 對 すき［な］", () => {
    expect(acceptedAnswers(suki)).toEqual(["すき", "すきな"]);
    for (const input of ["すき", "すきな", "suki", "sukina", "スキナ"]) {
      expect(checkAnswer(input, suki)).toBe(true);
    }
    expect(checkAnswer("すきだ", suki)).toBe(false);
    expect(checkAnswer("き", suki)).toBe(false);
  });

  it("「／」為替代答案:おっと / しゅじん,串接不算", () => {
    expect(acceptedAnswers(otto)).toEqual(["おっと", "しゅじん"]);
    expect(checkAnswer("otto", otto)).toBe(true);
    expect(checkAnswer("shujin", otto)).toBe(true);
    expect(checkAnswer("おっとしゅじん", otto)).toBe(false);
  });

  it("（）為替代說法:トイレ / おてあらい、いい / よい,括號內外串接不算", () => {
    expect(acceptedAnswers(toilet)).toEqual(["トイレ", "おてあらい"]);
    expect(checkAnswer("toire", toilet)).toBe(true);
    expect(checkAnswer("おてあらい", toilet)).toBe(true);
    expect(checkAnswer("トイレおてあらい", toilet)).toBe(false); // kana 的串接是資料問題(DQ-02)
    expect(acceptedAnswers(ii)).toEqual(["いい", "よい"]);
    expect(checkAnswer("yoi", ii)).toBe(true);
    expect(checkAnswer("いいよい", ii)).toBe(false);
  });

  it("［お］仕事:しごと 與 おしごと 皆可", () => {
    expect(acceptedAnswers(shigoto)).toEqual(["しごと", "おしごと"]);
    expect(checkAnswer("shigoto", shigoto)).toBe(true);
    expect(checkAnswer("おしごと", shigoto)).toBe(true);
    expect(checkAnswer("おしこと", shigoto)).toBe(false);
  });

  it("「ん」以 IME 習慣打 nn 亦可(sennsei、minasann),onna / konnyaku 照常", () => {
    const sensei = word([{ b: "先生", r: "せんせい" }], "せんせい");
    for (const input of ["sensei", "sennsei", "SENNSEI", "せんせい"]) {
      expect(checkAnswer(input, sensei)).toBe(true);
    }
    const cases: [string, string, string][] = [
      ["minasann", "皆さん", "みなさん"],
      ["honn", "本", "ほん"],
      ["onna", "女", "おんな"],
      ["konnyaku", "蒟蒻", "こんにゃく"],
      ["kinnyoubi", "金曜日", "きんようび"],
      ["konnnichiha", "今日は", "こんにちは"],
      ["kann'i", "簡易", "かんい"],
    ];
    for (const [input, kanji, kana] of cases) {
      expect(
        checkAnswer(input, word([{ b: kanji, r: kana }], kana)),
        input,
      ).toBe(true);
    }
    // 多打或漏打仍判錯
    expect(checkAnswer("sennnsei", sensei)).toBe(false);
    expect(checkAnswer("sennse", sensei)).toBe(false);
    expect(checkAnswer("seisenn", sensei)).toBe(false);
  });

  it("多個可省略段展開所有組合;〜…段、「〜を」語境與同讀音並列不成為答案", () => {
    expect(
      acceptedAnswers(
        word(
          [{ b: "［どうも］ ありがとう ［ございます］。" }],
          "どうもありがとうございます",
        ),
      ),
    ).toEqual([
      "どうもありがとうございます",
      "ありがとう",
      "ありがとうございます",
      "どうもありがとう",
    ]);
    expect(acceptedAnswers(word([{ b: "もし［〜たら］" }], "もし"))).toEqual([
      "もし",
    ]);
    expect(
      acceptedAnswers(word([{ b: "「〜を」ください。" }], "ください")),
    ).toEqual(["ください"]);
    expect(
      acceptedAnswers(
        word(
          [
            { b: "暑", r: "あつ" },
            { b: "い、" },
            { b: "熱", r: "あつ" },
            { b: "い" },
          ],
          "あつい",
        ),
      ),
    ).toEqual(["あつい"]);
    expect(
      acceptedAnswers(word([{ b: "…" }, { b: "倍", r: "ばい" }], "…ばい")),
    ).toEqual(["ばい"]);
  });

  it("數字不能以假名輸入:2、3日 只收 kana(に、さんにち)", () => {
    const days = word([{ b: "2、3" }, { b: "日", r: "にち" }], "に、さんにち");
    expect(acceptedAnswers(days)).toEqual(["にさんにち"]);
    expect(checkAnswer("nisannichi", days)).toBe(true);
    expect(checkAnswer("に、さんにち", days)).toBe(true);
    expect(checkAnswer("に", days)).toBe(false);
  });

  it("answerLabel:回饋只列 kana 推導的答案,推導不出時列全部", () => {
    expect(answerLabel(suki)).toBe("すき／すきな");
    expect(answerLabel(otto)).toBe("おっと／しゅじん");
    expect(answerLabel(shigoto)).toBe("しごと");
    expect(answerLabel(toilet)).toBe("トイレ／おてあらい");
    expect(answerLabel(word([{ b: "え―と" }], "え―と"))).toBe("えーと");
    expect(answerLabel(coffee)).toBe("コーヒー");
  });
});

describe("canInput(T10.4)", () => {
  it("含漢字讀音者可出輸入題", () => {
    expect(canInput(word([{ b: "犬", r: "いぬ" }], "いぬ"))).toBe(true);
    expect(
      canInput(word([{ b: "好", r: "す" }, { b: "き［な］" }], "すき［な］")),
    ).toBe(true);
    expect(
      canInput(
        word(
          [{ b: "夫", r: "おっと" }, { b: "／" }, { b: "主人", r: "しゅじん" }],
          "おっと／しゅじん",
        ),
      ),
    ).toBe(true);
  });

  it("純假名/片假名字不出(題幹即答案)", () => {
    expect(canInput(word([{ b: "わたし" }], "わたし"))).toBe(false);
    expect(canInput(word([{ b: "コーヒー" }], "コーヒー"))).toBe(false);
  });

  it("表面含〜或…者不出", () => {
    expect(canInput(word([{ b: "〜語", r: "ご" }], "ご"))).toBe(false);
    expect(canInput(word([{ b: "…" }, { b: "倍", r: "ばい" }], "…ばい"))).toBe(
      false,
    );
  });

  it("題幹已寫出某個答案(（）內外其一為假名)者不出", () => {
    expect(
      canInput(
        word(
          [{ b: "トイレ（お" }, { b: "手洗", r: "てあら" }, { b: "い）" }],
          "トイレおてあらい",
        ),
      ),
    ).toBe(false);
    expect(
      canInput(
        word(
          [{ b: "キトク（" }, { b: "危篤", r: "きとく" }, { b: "）" }],
          "きとく",
        ),
      ),
    ).toBe(false);
    expect(
      canInput(
        word(
          [
            { b: "どうぞ よろしく［お" },
            { b: "願", r: "ねが" },
            { b: "いします］。" },
          ],
          "どうぞよろしくおねがいします",
        ),
      ),
    ).toBe(false);
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
  // 含漢字讀音:輸入題照常輪替(純假名字的輪替見下方 T10.4 測試)
  const pool: QuizCandidate[] = [
    kanjiCand("L13-V001", 13, "狗", "犬", "いぬ"),
    kanjiCand("L13-V002", 13, "貓", "猫", "ねこ"),
    kanjiCand("L13-V003", 13, "鳥", "鳥", "とり"),
    kanjiCand("L13-V004", 13, "魚", "魚", "さかな"),
    kanjiCand("L13-V005", 13, "山", "山", "やま"),
    kanjiCand("L12-V001", 12, "海", "海", "うみ"),
    kanjiCand("L14-V001", 14, "川", "川", "かわ"),
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

  it("純假名字輪到輸入題時改出中→日選擇題(T10.4)", () => {
    const kanaPool: QuizCandidate[] = [
      cand("L13-V001", 13, "名", "我", "わたし"),
      cand("L13-V002", 13, "名", "咖啡", "コーヒー"),
      cand("L13-V003", 13, "名", "那個", "あれ"),
      cand("L13-V004", 13, "名", "這個", "これ"),
      cand("L12-V001", 12, "名", "那裡", "そこ"),
    ];
    const qs = generateQuiz(13, kanaPool, { count: 4, rng: ZERO });
    expect(qs.map((q) => q.type)).toEqual([
      "jp-to-zh",
      "zh-to-jp",
      "zh-to-jp",
      "jp-to-zh",
    ]);
    expect(qs.some((q) => q.type === "input")).toBe(false);
  });

  it("混合:含漢字者照常出輸入題,純假名者改出選擇題", () => {
    const mixed: QuizCandidate[] = [
      kanjiCand("L13-V001", 13, "狗", "犬", "いぬ"),
      cand("L13-V002", 13, "名", "咖啡", "コーヒー"),
      kanjiCand("L13-V003", 13, "鳥", "鳥", "とり"),
      kanjiCand("L13-V004", 13, "魚", "魚", "さかな"),
      cand("L13-V005", 13, "名", "我", "わたし"),
      kanjiCand("L13-V006", 13, "山", "山", "やま"),
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, mixed, { count: 6, rng: seeded(seed) });
      qs.forEach((q, i) => {
        if (i % 3 !== 2) expect(q.type).toBe(["jp-to-zh", "zh-to-jp"][i % 3]);
        else expect(q.type).toBe(canInput(q.answer) ? "input" : "zh-to-jp");
      });
      expect(qs.every((q) => q.type !== "input" || canInput(q.answer))).toBe(
        true,
      );
    }
  });

  it("未啟用中→日時退回第一個啟用的選擇題型;只啟用輸入題時只出可輸入的字", () => {
    const mixed: QuizCandidate[] = [
      cand("L13-V001", 13, "名", "咖啡", "コーヒー"),
      kanjiCand("L13-V002", 13, "狗", "犬", "いぬ"),
      cand("L13-V003", 13, "名", "我", "わたし"),
    ];
    const qs = generateQuiz(13, mixed, {
      types: ["input", "jp-to-zh"],
      rng: ZERO,
    });
    expect(qs.every((q) => q.type !== "input" || canInput(q.answer))).toBe(
      true,
    );
    expect(qs.filter((q) => q.type === "input")).not.toHaveLength(0);
    expect(qs.some((q) => q.type === "zh-to-jp")).toBe(false);

    const inputOnly = generateQuiz(13, mixed, { types: ["input"], rng: ZERO });
    expect(inputOnly.map((q) => q.answer.id)).toEqual(["L13-V002"]);
  });

  it("補充單字不出題,仍可當干擾項;題目不足 count 時出較少題", () => {
    const supp = {
      ...kanjiCand(
        "L13-V009",
        13,
        "萬里長城",
        "万里の長城",
        "ばんりのちょうじょう",
      ),
      note: SUPPLEMENT_NOTE,
    };
    const withSupp = [...pool, supp];
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, withSupp, {
        count: 10,
        types: ["jp-to-zh"],
        rng: seeded(seed),
      });
      expect(qs).toHaveLength(5); // 第13課 5 字 + 1 補充 → 5 題
      expect(qs.map((q) => q.answer.id)).not.toContain("L13-V009");
    }
    const asDistractor = pickDistractors(pool[0], withSupp, 10, ZERO);
    expect(asDistractor.map((c) => c.id)).toContain("L13-V009");
  });

  it("注入相同 rng 種子 → 相同題目(確定性)", () => {
    const a = generateQuiz(13, pool, { count: 5, rng: seeded(42) });
    const b = generateQuiz(13, pool, { count: 5, rng: seeded(42) });
    expect(a).toEqual(b);
  });
});
