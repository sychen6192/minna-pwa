import { SUPPLEMENT_NOTE } from "./notes";
import {
  acceptedAnswers,
  answerLabel,
  canInput,
  canListen,
  checkAnswer,
  generateQuiz,
  interchangeable,
  listenText,
  makeCloze,
  normalizeReading,
  parseQuizTypes,
  pickDistractors,
  quizWordCount,
  splitRuby,
  type ClozeQuestion,
  type McqQuestion,
  type QuestionType,
  type QuizCandidate,
} from "./quiz";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

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

/** 以單一假名讀音判分(答案只由 `kana` 推導,規則同 checkAnswer) */
const checkInput = (input: string, kana: string) =>
  checkAnswer(input, { kana, ruby: [{ b: kana }] });

describe("checkAnswer:輸入正規化(單一假名讀音)", () => {
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

// ── 聽力與例句填空(T11.8)──────────────────────────────────────────

/** 例句:ruby 照教材分段(漢字段帶 r,假名段可跨詞) */
function sent(
  id: string,
  ruby: RubySeg[],
  translation = `${id} 的中譯`,
): Sentence {
  return { id, ruby, translation };
}

function lessonWith(
  id: number,
  vocab: VocabItem[],
  examples: Sentence[],
  dialogues: Sentence[] = [],
): Lesson {
  return {
    id,
    title: `第${id}課`,
    vocab,
    grammar: [{ id: `L${id}-G01`, pattern: "型", examples }],
    dialogues,
  };
}

const segText = (segs: RubySeg[]) => segs.map((s) => s.b).join("");

describe("listenText / canListen(T11.8)", () => {
  it("含漢字者讀表面形(引擎依辭典決定重音),去除教材記號", () => {
    expect(listenText(word([{ b: "花見", r: "はなみ" }], "はなみ"))).toBe(
      "花見",
    );
    expect(
      listenText(word([{ b: "［お］" }, { b: "菓子", r: "かし" }], "おかし")),
    ).toBe("お菓子");
    expect(
      listenText(word([{ b: "遊", r: "あそ" }, { b: "びます" }], "あそびます")),
    ).toBe("遊びます");
  });

  it("純假名字讀 kana(同發音鈕)", () => {
    expect(listenText(word([{ b: "コーヒー" }], "コーヒー"))).toBe("コーヒー");
    expect(listenText(word([{ b: "いい （よい）" }], "いい"))).toBe("いい");
  });

  it("單一漢字、數字、同形異讀、並列寫法與「・」縮寫改讀 kana", () => {
    expect(listenText(word([{ b: "方", r: "かた" }], "かた"))).toBe("かた");
    expect(listenText(word([{ b: "私", r: "わたくし" }], "わたくし"))).toBe(
      "わたくし",
    );
    expect(
      listenText(
        word([{ b: "5" }, { b: "年生", r: "ねんせい" }], "ごねんせい"),
      ),
    ).toBe("ごねんせい");
    expect(
      listenText(word([{ b: "降", r: "お" }, { b: "ります" }], "おります")),
    ).toBe("おります");
    expect(listenText(word([{ b: "明日", r: "あす" }], "あす"))).toBe("あす");
    expect(
      listenText(
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
    ).toBe("あつい");
    expect(
      listenText(
        word(
          [
            { b: "月", r: "げつ" },
            { b: "・" },
            { b: "水", r: "すい" },
            { b: "・" },
            { b: "金", r: "きん" },
          ],
          "げつすいきん",
        ),
      ),
    ).toBe("げつすいきん");
  });

  it("kana 含非假名字元、表面含〜…者不出聽力題", () => {
    expect(canListen(word([{ b: "花見", r: "はなみ" }], "はなみ"))).toBe(true);
    expect(canListen(word([{ b: "コーヒー" }], "コーヒー"))).toBe(true);
    expect(
      canListen(word([{ b: "好", r: "す" }, { b: "き［な］" }], "すき［な］")),
    ).toBe(false);
    expect(
      canListen(
        word(
          [{ b: "夫", r: "おっと" }, { b: "／" }, { b: "主人", r: "しゅじん" }],
          "おっと／しゅじん",
        ),
      ),
    ).toBe(false);
    expect(canListen(word([{ b: "え―と" }], "え―と"))).toBe(false); // U+2015
    expect(canListen(word([{ b: "〜君", r: "くん" }], "くん"))).toBe(false); // 單讀接尾會讀成 きみ
    expect(canListen(word([{ b: "…" }, { b: "時", r: "じ" }], "じ"))).toBe(
      false,
    );
  });
});

describe("splitRuby(T11.8)", () => {
  const segs: RubySeg[] = [
    { b: "ジュースを " },
    { b: "飲", r: "の" },
    { b: "みます。" },
  ];

  it("假名段可在任意處切開;漢字段整段挖掉", () => {
    // 飲みます = [6, 10)
    expect(splitRuby(segs, 6, 10)).toEqual({
      before: [{ b: "ジュースを " }],
      after: [{ b: "。" }],
    });
    // ジュース = [0, 4)
    expect(splitRuby(segs, 0, 4)).toEqual({
      before: [],
      after: [{ b: "を " }, { b: "飲", r: "の" }, { b: "みます。" }],
    });
  });

  it("端點落在帶讀音的漢字段中間時回傳 null(外国 ⊂ 外国人)", () => {
    const gaikokujin: RubySeg[] = [
      { b: "外国人", r: "がいこくじん" },
      { b: "の 学生" },
    ];
    expect(splitRuby(gaikokujin, 0, 2)).toBeNull();
    expect(splitRuby(gaikokujin, 1, 3)).toBeNull();
    expect(splitRuby(gaikokujin, 0, 3)).toEqual({
      before: [],
      after: [{ b: "の 学生" }],
    });
  });
});

describe("makeCloze(T11.8)", () => {
  const nomimasu: VocabItem = {
    id: "L06-V002",
    ruby: [{ b: "飲", r: "の" }, { b: "みます" }],
    kana: "のみます",
    meaning: "喝",
    pos: "動I",
  };
  const juice: VocabItem = {
    id: "L06-V026",
    ruby: [{ b: "ジュース" }],
    kana: "ジュース",
    meaning: "果汁",
    pos: "名",
  };

  it("挖空位置正確:只挖單字的表面形,前後保留原句的 ruby 分段與中譯", () => {
    const l = lessonWith(
      6,
      [nomimasu, juice],
      [
        sent(
          "L06-S01",
          [{ b: "ジュースを " }, { b: "飲", r: "の" }, { b: "みます。" }],
          "我喝果汁。",
        ),
      ],
    );
    expect(makeCloze(nomimasu, l)).toEqual({
      sentenceId: "L06-S01",
      before: [{ b: "ジュースを " }],
      after: [{ b: "。" }],
      translation: "我喝果汁。",
    });
    expect(makeCloze(juice, l)).toEqual({
      sentenceId: "L06-S01",
      before: [],
      after: [{ b: "を " }, { b: "飲", r: "の" }, { b: "みます。" }],
      translation: "我喝果汁。",
    });
  });

  it("同句只挖一處:句中另有同一字面(挖一處仍看得到答案)的句子不選,改用其他句", () => {
    const twice = sent("S1", [
      { b: "ジュースを " },
      { b: "飲", r: "の" },
      { b: "みます。コーラも " },
      { b: "飲", r: "の" },
      { b: "みます。" },
    ]);
    const l = lessonWith(6, [nomimasu], [twice]);
    expect(makeCloze(nomimasu, l)).toBeNull();

    const once = sent("S2", [
      { b: "お" },
      { b: "茶", r: "ちゃ" },
      { b: "を たくさん " },
      { b: "飲", r: "の" },
      { b: "みます。" },
    ]);
    const cloze = makeCloze(nomimasu, lessonWith(6, [nomimasu], [twice, once]));
    expect(cloze?.sentenceId).toBe("S2");
    const blanks = cloze
      ? segText(cloze.before) + "（　　）" + segText(cloze.after)
      : "";
    expect(blanks).toBe("お茶を たくさん （　　）。");
    expect(blanks.split("（　　）")).toHaveLength(2);
  });

  it("挖空處切開帶讀音的漢字段者不選(外国 ⊂ 外国人)", () => {
    const gaikoku: VocabItem = {
      id: "L11-V044",
      ruby: [{ b: "外国", r: "がいこく" }],
      kana: "がいこく",
      meaning: "外國",
      pos: "名",
    };
    const l = lessonWith(
      11,
      [gaikoku],
      [
        sent("S1", [
          { b: "外国人", r: "がいこくじん" },
          { b: "の 学生が います。" },
        ]),
      ],
    );
    expect(makeCloze(gaikoku, l)).toBeNull();
  });

  it("慣用語、表面含教材記號者不出", () => {
    const itadakimasu: VocabItem = {
      id: "L07-V044",
      ruby: [{ b: "いただきます。" }],
      kana: "いただきます",
      meaning: "我開動了",
      pos: "慣用",
    };
    const l = lessonWith(
      7,
      [itadakimasu],
      [sent("S1", [{ b: "いただきます。この スプーン、すてきですね。" }])],
    );
    expect(makeCloze(itadakimasu, l)).toBeNull();
    const shigoto: VocabItem = {
      id: "L08-V042",
      ruby: [{ b: "［お］" }, { b: "仕事", r: "しごと" }],
      kana: "しごと",
      meaning: "工作",
      pos: "名",
    };
    expect(
      makeCloze(
        shigoto,
        lessonWith(
          8,
          [shigoto],
          [sent("S1", [{ b: "［お］仕事は どうですか。" }])],
        ),
      ),
    ).toBeNull();
  });

  it("動詞只有活用形命中(T11.9)時不出:挖空處須是單字本身(ます形)", () => {
    const aimasu: VocabItem = {
      id: "L06-V011",
      ruby: [{ b: "会", r: "あ" }, { b: "います" }],
      kana: "あいます",
      meaning: "見面",
      pos: "動I",
    };
    const conjugatedOnly = sent("S1", [
      { b: "駅", r: "えき" },
      { b: "で " },
      { b: "会", r: "あ" },
      { b: "いましょう。" },
    ]);
    expect(
      makeCloze(aimasu, lessonWith(6, [aimasu], [conjugatedOnly])),
    ).toBeNull();
    // 另有ます形的句子(較長)時照常出題,挖的是ます形
    const exact = sent("S2", [
      { b: "あした " },
      { b: "駅", r: "えき" },
      { b: "で " },
      { b: "友達", r: "ともだち" },
      { b: "に " },
      { b: "会", r: "あ" },
      { b: "います。" },
    ]);
    const cloze = makeCloze(
      aimasu,
      lessonWith(6, [aimasu], [conjugatedOnly, exact]),
    );
    expect(cloze?.sentenceId).toBe("S2");
    expect(cloze && segText(cloze.after)).toBe("。");
  });

  it("句=字、含→的對照行、会話標題行、中譯標示較晚課次的例句不選", () => {
    const samui: VocabItem = {
      id: "L08-V018",
      ruby: [{ b: "寒", r: "さむ" }, { b: "い" }],
      kana: "さむい",
      meaning: "冷",
      pos: "い形",
    };
    const bad = lessonWith(
      8,
      [samui],
      [
        sent("S1", [{ b: "寒", r: "さむ" }, { b: "い" }]),
        sent("S2", [
          { b: "寒", r: "さむ" },
          { b: "い → " },
          { b: "寒", r: "さむ" },
          { b: "く なります" },
        ]),
        sent(
          "S3",
          [{ b: "きょうは " }, { b: "寒", r: "さむ" }, { b: "いですね。" }],
          "今天很冷呢。(第 19 課)",
        ),
      ],
      [sent("D1", [{ b: "寒", r: "さむ" }, { b: "い 日" }])], // 無 speaker 的第一行 = 標題
    );
    expect(makeCloze(samui, bad)).toBeNull();

    const earlier = lessonWith(
      8,
      [samui],
      [
        sent(
          "S1",
          [{ b: "きょうは " }, { b: "寒", r: "さむ" }, { b: "いですね。" }],
          "今天很冷呢。(第 7 課)",
        ),
      ],
    );
    // 較早課次的參照:照常出題,中譯去掉課次
    expect(makeCloze(samui, earlier)).toMatchObject({
      sentenceId: "S1",
      translation: "今天很冷呢。",
    });
  });
});

describe("generateQuiz 聽力與例句填空(T11.8)", () => {
  const v = (
    id: string,
    kanji: string,
    kana: string,
    meaning: string,
    pos: QuizCandidate["pos"] = "名",
  ): QuizCandidate => ({
    id,
    lessonId: Number(id.slice(1, 3)),
    ruby: [{ b: kanji, r: kana }],
    kana,
    meaning,
    pos,
  });
  const words: QuizCandidate[] = [
    v("L13-V001", "犬", "いぬ", "狗"),
    v("L13-V002", "猫", "ねこ", "貓"),
    v("L13-V003", "小鳥", "ことり", "小鳥"),
    v("L13-V004", "金魚", "きんぎょ", "金魚"),
    v("L13-V005", "動物", "どうぶつ", "動物"),
    v("L12-V001", "海", "うみ", "海"),
    v("L14-V001", "川", "かわ", "河"),
  ];
  // 課內例句:只有 小鳥、金魚 有可挖空的句子(單一字元的 犬、猫 不找例句,見 examples.ts)
  const clozeIds = ["L13-V003", "L13-V004"];
  const lesson13 = lessonWith(
    13,
    words.filter((w) => w.lessonId === 13),
    [
      sent(
        "L13-S01",
        [
          { b: "公園", r: "こうえん" },
          { b: "に " },
          { b: "小鳥", r: "ことり" },
          { b: "が います。" },
        ],
        "公園裡有小鳥。",
      ),
      sent(
        "L13-S02",
        [
          { b: "金魚", r: "きんぎょ" },
          { b: "が " },
          { b: "好", r: "す" },
          { b: "きです。" },
        ],
        "我喜歡金魚。",
      ),
      sent(
        "L13-S03",
        [
          { b: "犬", r: "いぬ" },
          { b: "と " },
          { b: "猫", r: "ねこ" },
          { b: "が います。" },
        ],
        "有狗和貓。",
      ),
    ],
  );

  it("沒有日語語音(listenAvailable 未開)時不出聽力題", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const qs = generateQuiz(13, words, {
        types: ["listen", "jp-to-zh"],
        rng: seeded(seed),
      });
      expect(qs.length).toBe(5);
      expect(qs.some((q) => q.type === "listen")).toBe(false);
    }
    expect(generateQuiz(13, words, { types: ["listen"], rng: ZERO })).toEqual(
      [],
    );
  });

  it("聽力:選項為不重複的中文、恰一正解,不含讀音相同的字", () => {
    const pool = [
      ...words,
      v("L13-V006", "箸", "はし", "筷子"),
      v("L13-V007", "橋", "はし", "橋"), // 與 箸 同音
      v("L13-V008", "海", "うみ", "海"),
      v("L13-V009", "海", "ウミ", "海洋"), // 與 海 同讀音(片假名寫法)
      v("L13-V010", "兎", "うさぎ", "狗"), // 與 犬 同中文
      v("L13-V011", "子犬", "こいぬ", "狗"), // 與 犬、兎 同中文
    ];
    const reading = (c: QuizCandidate) => normalizeReading(c.kana);
    for (let seed = 1; seed <= 30; seed++) {
      const qs = generateQuiz(13, pool, {
        types: ["listen"],
        listenAvailable: true,
        rng: seeded(seed),
      });
      expect(qs).toHaveLength(10);
      for (const q of qs) {
        expect(q.type).toBe("listen");
        const { options } = q as McqQuestion;
        expect(options).toHaveLength(4);
        expect(options.filter((o) => o.correct).map((o) => o.id)).toEqual([
          q.answer.id,
        ]);
        const meanings = options.map((o) => o.candidate.meaning);
        expect(new Set(meanings).size).toBe(meanings.length);
        for (const o of options.filter((x) => !x.correct)) {
          expect(reading(o.candidate)).not.toBe(reading(q.answer));
        }
      }
    }
  });

  it("填空:挖空處是正解,選項為不重複的日文、恰一正解", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, words, {
        types: ["cloze"],
        lesson: lesson13,
        rng: seeded(seed),
      });
      // 只有 小鳥、金魚 有例句:只啟用填空時只從這兩字出題
      expect(qs.map((q) => q.answer.id).sort()).toEqual(clozeIds);
      for (const q of qs) {
        const c = q as ClozeQuestion;
        expect(c.type).toBe("cloze");
        const surfaces = c.options.map((o) => segText(o.candidate.ruby));
        expect(new Set(surfaces).size).toBe(surfaces.length);
        expect(c.options.filter((o) => o.correct).map((o) => o.id)).toEqual([
          q.answer.id,
        ]);
      }
      const kotori = qs.find(
        (q) => q.answer.id === "L13-V003",
      ) as ClozeQuestion;
      expect(kotori.cloze.before).toEqual([
        { b: "公園", r: "こうえん" },
        { b: "に " },
      ]);
      expect(kotori.cloze.after).toEqual([{ b: "が います。" }]);
      expect(kotori.cloze.translation).toBe("公園裡有小鳥。");
    }
  });

  it("填空干擾項:同詞性優先,不含教材記號,表面形不與正解相同", () => {
    const pool = [
      ...words,
      v("L13-V008", "小鳥", "しょうちょう", "小鳥(另一讀音)"), // 同表面不同讀音
      v("L13-V009", "〜鳥", "ちょう", "…鳥"),
      v("L13-V010", "走", "はし", "跑", "動I"),
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const [q] = generateQuiz(13, pool, {
        types: ["cloze"],
        lesson: lesson13,
        count: 1,
        rng: seeded(seed),
      }) as ClozeQuestion[];
      const texts = q.options.map((o) => segText(o.candidate.ruby));
      expect(texts.filter((t) => t === segText(q.answer.ruby))).toHaveLength(1);
      expect(texts.some((t) => /[〜［］]/.test(t))).toBe(false);
      expect(q.options.every((o) => o.candidate.pos === "名")).toBe(true);
    }
  });

  it("填空找不到例句的字改出其他啟用題型(中→日優先);未給課程資料時不出填空", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, words, {
        types: ["cloze", "jp-to-zh"],
        lesson: lesson13,
        rng: seeded(seed),
      });
      expect(qs).toHaveLength(5);
      // 填空的輪次先分給有例句的字
      expect(qs[0].type).toBe("cloze");
      expect(qs[2].type).toBe("cloze");
      for (const q of qs) {
        if (q.type === "cloze") expect(clozeIds).toContain(q.answer.id);
      }
      expect(qs[4].type).toBe("jp-to-zh"); // 輪到填空但沒有例句 → 日→中(中→日未啟用)
    }
    // 只有 小鳥 有例句:第二個填空輪次改出中→日(優先於日→中)
    const onlyKotori = {
      ...lesson13,
      grammar: [
        {
          ...lesson13.grammar[0],
          examples: lesson13.grammar[0].examples.slice(0, 1),
        },
      ],
    };
    const withZhJp = generateQuiz(13, words, {
      types: ["cloze", "zh-to-jp", "jp-to-zh"],
      lesson: onlyKotori,
      count: 5,
      rng: ZERO,
    });
    expect(withZhJp.map((q) => q.type)).toEqual([
      "cloze",
      "zh-to-jp",
      "jp-to-zh",
      "zh-to-jp",
      "zh-to-jp",
    ]);
    expect(withZhJp[0].answer.id).toBe("L13-V003");
    const noLesson = generateQuiz(13, words, {
      types: ["cloze", "jp-to-zh"],
      rng: ZERO,
    });
    expect(noLesson.some((q) => q.type === "cloze")).toBe(false);
    expect(generateQuiz(13, words, { types: ["cloze"], rng: ZERO })).toEqual(
      [],
    );
  });

  it("填空:同一回合每句例句只挖空一次,只剩填空可出時才重複", () => {
    const shared = lessonWith(
      13,
      words.filter((w) => w.lessonId === 13),
      [
        sent("L13-S01", [
          { b: "小鳥", r: "ことり" },
          { b: "と " },
          { b: "金魚", r: "きんぎょ" },
          { b: "が います。" },
        ]),
      ],
    );
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, words, {
        types: ["cloze", "jp-to-zh"],
        lesson: shared,
        rng: seeded(seed),
      });
      expect(qs).toHaveLength(5);
      expect(qs.filter((q) => q.type === "cloze")).toHaveLength(1);
      const only = generateQuiz(13, words, {
        types: ["cloze"],
        lesson: shared,
        rng: seeded(seed),
      }) as ClozeQuestion[];
      expect(only.map((q) => q.answer.id).sort()).toEqual(clozeIds);
      expect(only.every((q) => q.cloze.sentenceId === "L13-S01")).toBe(true);
    }
  });

  it("quizWordCount:以所選題型可出題的字數,與 generateQuiz 的題數一致", () => {
    const count = (types: QuestionType[], listenAvailable = false) =>
      quizWordCount(13, words, { types, lesson: lesson13, listenAvailable });
    expect(count(["cloze"])).toBe(2);
    expect(count(["cloze", "jp-to-zh"])).toBe(5);
    expect(count(["listen"])).toBe(0);
    expect(count(["listen"], true)).toBe(5);
    expect(quizWordCount(13, words, { types: ["cloze"] })).toBe(0); // 未給課程資料
    for (const types of [
      ["cloze"],
      ["cloze", "input"],
      ["input"],
    ] as QuestionType[][]) {
      expect(
        generateQuiz(13, words, { types, lesson: lesson13, rng: ZERO }),
      ).toHaveLength(count(types));
    }
  });

  it("全部題型:每題都有合法題型與正解,題數受 count 限制", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, words, {
        types: ["jp-to-zh", "zh-to-jp", "input", "cloze", "listen"],
        lesson: lesson13,
        listenAvailable: true,
        count: 4,
        rng: seeded(seed),
      });
      expect(qs).toHaveLength(4);
      expect(qs.map((q) => q.type)).toEqual([
        "jp-to-zh",
        "zh-to-jp",
        "input",
        "cloze",
      ]);
      expect(new Set(qs.map((q) => q.answer.id)).size).toBe(4);
    }
  });

  it("本回合的字均勻抽樣:有例句的字不會每回合都被挑中", () => {
    // 20 字只有 小鳥 有例句;每回合抽 5 字 → 均勻時約 1/4 回合出現
    const many = [
      ...words.filter((w) => w.lessonId === 13),
      ...Array.from({ length: 15 }, (_, i) =>
        v(`L13-V1${String(i).padStart(2, "0")}`, `字${i}`, `じ${i}`, `字${i}`),
      ),
    ];
    const kotoriOnly = lessonWith(13, many, lesson13.grammar[0].examples);
    let picked = 0;
    let clozes = 0;
    const rounds = 400;
    for (let seed = 1; seed <= rounds; seed++) {
      const qs = generateQuiz(13, many, {
        types: ["jp-to-zh", "cloze"],
        lesson: kotoriOnly,
        count: 5,
        rng: seeded(seed),
      });
      if (qs.some((q) => q.answer.id === "L13-V003")) picked++;
      clozes += qs.filter((q) => q.type === "cloze").length;
    }
    expect(picked / rounds).toBeGreaterThan(0.15);
    expect(picked / rounds).toBeLessThan(0.35); // 舊做法(先挑有例句的字)為 100%
    expect(clozes).toBeGreaterThan(0); // 抽到有例句的字時照常出填空
  });

  it("填空:抽中的字只剩例句已用過的填空時改取其他可出題的字,不重複例句", () => {
    // ジュース、コーラ 只能出填空且共用一句;犬、猫 只能出輸入題(單一字元不找例句)
    const drinks: QuizCandidate[] = [
      {
        ...v("L13-V001", "ジュース", "ジュース", "果汁"),
        ruby: [{ b: "ジュース" }],
      },
      { ...v("L13-V002", "コーラ", "コーラ", "可樂"), ruby: [{ b: "コーラ" }] },
      v("L13-V003", "犬", "いぬ", "狗"),
      v("L13-V004", "猫", "ねこ", "貓"),
    ];
    const l = lessonWith(13, drinks, [
      sent("L13-S01", [{ b: "ジュースと コーラが あります。" }]),
    ]);
    for (let seed = 1; seed <= 40; seed++) {
      const qs = generateQuiz(13, drinks, {
        types: ["input", "cloze"],
        lesson: l,
        count: 3,
        rng: seeded(seed),
      });
      expect(qs).toHaveLength(3);
      const clozes = qs.filter((q) => q.type === "cloze");
      expect(clozes).toHaveLength(1);
      // 兩個飲料都被抽中時,第二個改由沒抽中的 犬/猫 出輸入題
      expect(qs.filter((q) => q.type === "input")).toHaveLength(2);
    }
  });

  it("填空輪次先給只能出填空的字(也能輸入的字留給輸入題),例句才夠分", () => {
    // コーラ 只能出填空;紅茶 可輸入也可填空(同一句);犬 只能輸入
    const drinks: QuizCandidate[] = [
      { ...v("L13-V001", "コーラ", "コーラ", "可樂"), ruby: [{ b: "コーラ" }] },
      v("L13-V002", "紅茶", "こうちゃ", "紅茶"),
      v("L13-V003", "犬", "いぬ", "狗"),
    ];
    const l = lessonWith(13, drinks, [
      sent("L13-S01", [
        { b: "コーラと " },
        { b: "紅茶", r: "こうちゃ" },
        { b: "が あります。" },
      ]),
    ]);
    for (let seed = 1; seed <= 20; seed++) {
      const qs = generateQuiz(13, drinks, {
        types: ["input", "cloze"],
        lesson: l,
        rng: seeded(seed),
      });
      expect(qs.map((q) => [q.answer.id, q.type]).sort()).toEqual([
        ["L13-V001", "cloze"],
        ["L13-V002", "input"],
        ["L13-V003", "input"],
      ]);
    }
  });

  it("可互換的字不當干擾項:聽力(中文選項)與填空(日文選項)", () => {
    const k = (
      id: string,
      kana: string,
      meaning: string,
      pos: QuizCandidate["pos"] = "其他",
    ): QuizCandidate => ({
      id,
      lessonId: 3,
      ruby: [{ b: kana }],
      kana,
      meaning,
      pos,
    });
    const koko = k("L03-V001", "ここ", "這裡、這個地方");
    const soko = k("L03-V002", "そこ", "那裡、那個地方");
    const asoko = k("L03-V003", "あそこ", "那裡、那個地方");
    const kochira = k("L03-V005", "こちら", "這邊（ここ 的禮貌形）");
    const sochira = k("L03-V006", "そちら", "那邊（そこ 的禮貌形）");
    const achira = k("L03-V007", "あちら", "那邊（あそこ 的禮貌形）");
    const others = ["うち", "いえ", "みせ", "へや", "にわ", "えき"].map(
      (w, i) => k(`L03-V02${i}`, w, `地點${i}`, "名"),
    );
    const pool = [koko, soko, asoko, kochira, sochira, achira, ...others];
    const l = lessonWith(3, pool, [
      sent("L03-S01", [{ b: "トイレは あそこです。" }], "廁所在那裡。"),
    ]);
    for (let seed = 1; seed <= 30; seed++) {
      for (const types of [["cloze"], ["listen"]] as QuestionType[][]) {
        const qs = generateQuiz(3, pool, {
          types,
          lesson: l,
          listenAvailable: true,
          rng: seeded(seed),
        }) as (McqQuestion | ClozeQuestion)[];
        const q = qs.find((x) => x.answer.id === asoko.id);
        if (!q) continue;
        expect(q.options).toHaveLength(4);
        const ids = q.options.map((o) => o.id);
        // そこ(同義)、あちら(意思提到 あそこ)、そちら(同為「那」的場所詞)皆不出
        for (const bad of [soko, achira, sochira])
          expect(ids, types[0]).not.toContain(bad.id);
      }
    }
  });
});

describe("interchangeable(T11.8)", () => {
  const w = (kana: string, meaning: string) => ({ kana, meaning });

  it("中文核心詞重疊(去掉說明括號、依並列切開)", () => {
    expect(
      interchangeable(
        w("では", "那麼（じゃ的禮貌說法）"),
        w("それでは", "那麼"),
      ),
    ).toBe(true);
    expect(interchangeable(w("なか", "裡面、中間"), w("おく", "裡面"))).toBe(
      true,
    );
    expect(
      interchangeable(
        w("それ", "那（事物近對方）"),
        w("あれ", "那（事物在遠方）"),
      ),
    ).toBe(true);
    expect(interchangeable(w("いぬ", "狗"), w("ねこ", "貓"))).toBe(false);
    expect(
      interchangeable(w("ここ", "這裡、這個地方"), w("そこ", "那裡、那個地方")),
    ).toBe(false);
  });

  it("意思提到對方;同類こそあど詞且中譯同為這／那／哪", () => {
    expect(
      interchangeable(
        w("どこ", "哪裡、哪個地方"),
        w("どちら", "哪邊（どこ 的禮貌形）"),
      ),
    ).toBe(true);
    expect(
      interchangeable(
        w("あそこ", "那裡、那個地方"),
        w("そちら", "那邊（そこ 的禮貌形）"),
      ),
    ).toBe(true);
    expect(
      interchangeable(w("あそこ", "那裡、那個地方"), w("あっち", "那邊")),
    ).toBe(true);
    // こ 與 そ・あ、場所與事物:中譯分得出來
    expect(
      interchangeable(
        w("ここ", "這裡"),
        w("あちら", "那邊（あそこ 的禮貌形）"),
      ),
    ).toBe(false);
    expect(interchangeable(w("あそこ", "那裡"), w("これ", "這"))).toBe(false);
  });
});

describe("pickDistractors distinctBy / parseQuizTypes(T11.8)", () => {
  it("distinctBy:選項間(含正解)該值不重複", () => {
    const answer = cand("A", 13, "名", "狗", "いぬ");
    const pool = [
      answer,
      cand("b", 13, "名", "貓", "ねこ"),
      cand("c", 13, "名", "貓", "ネコちゃん"),
      cand("d", 13, "名", "鳥", "とり"),
    ];
    expect(
      pickDistractors(answer, pool, 3, ZERO)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["b", "c", "d"]);
    const d = pickDistractors(answer, pool, 3, ZERO, (c) => c.meaning);
    expect(d.map((c) => c.meaning).sort()).toEqual(["貓", "鳥"]);
  });

  it("parseQuizTypes:只留已知題型、依固定順序;無效時 null", () => {
    expect(parseQuizTypes(["listen", "cloze", "jp-to-zh", "jp-to-zh"])).toEqual(
      ["jp-to-zh", "cloze", "listen"],
    );
    expect(parseQuizTypes(["foo"])).toBeNull();
    expect(parseQuizTypes([])).toBeNull();
    expect(parseQuizTypes("cloze")).toBeNull();
    expect(parseQuizTypes(undefined)).toBeNull();
  });
});
