import type {
  GrammarPoint,
  Lesson,
  RubySeg,
  Sentence,
  VocabItem,
} from "@/schemas/lesson";
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

/** 含漢字的單字:ruby 由呼叫端給(漢字段帶 r),kana 只作識別用 */
function kanjiVocab(
  ruby: RubySeg[],
  overrides: Partial<VocabItem> = {},
): VocabItem {
  return vocab(ruby.map((s) => s.r ?? s.b).join(""), { ruby, ...overrides });
}

// 教材例句的樣子:詞與詞之間以空格分かち書き(助詞接在前一詞)
function sentence(text: string, id = "S"): Sentence {
  return { id, ruby: [{ b: text }], translation: `${text} 的翻譯` };
}

function grammar(examples: Sentence[]): GrammarPoint {
  return { id: "L13-G01", pattern: "型", examples };
}

function lesson(
  grammarPts: GrammarPoint[],
  dialogues: Sentence[] = [],
  words: VocabItem[] = [],
): Lesson {
  return {
    id: 13,
    title: "第13課",
    vocab: words,
    grammar: grammarPts,
    dialogues,
  };
}

/** 只有文法例句的課:依序編號 S1、S2… */
function lessonOf(texts: string[], words: VocabItem[] = []): Lesson {
  return lesson(
    [grammar(texts.map((t, i) => sentence(t, `S${i + 1}`)))],
    [],
    words,
  );
}

const asobimasu = kanjiVocab([{ b: "遊", r: "あそ" }, { b: "びます" }]);

describe("findExampleSentence", () => {
  it("回傳文法例句中含該單字表面形的句子", () => {
    const l = lesson([grammar([sentence("公園で 遊びます。", "S1")])]);
    expect(findExampleSentence(asobimasu, l)?.id).toBe("S1");
  });

  it("也會搜尋会話句", () => {
    const l = lesson(
      [grammar([sentence("無關的句子。", "G1")])],
      [sentence("いっしょに 遊びましょう。", "D1")],
    );
    // 会話用「遊び」;測完整表面形改用會出現的詞
    const asobi = kanjiVocab([{ b: "遊", r: "あそ" }, { b: "び" }]);
    expect(findExampleSentence(asobi, l)?.id).toBe("D1");
  });

  it("多句命中時取最短(i+1 傾向)", () => {
    const l = lesson([
      grammar([
        sentence("わたしは 毎日 この 公園で ゆっくり 遊びます。", "LONG"),
        sentence("公園で 遊びます。", "SHORT"),
      ]),
    ]);
    expect(findExampleSentence(asobimasu, l)?.id).toBe("SHORT");
  });

  it("無任何句子含該單字時回傳 null", () => {
    const l = lesson([grammar([sentence("これは 本です。", "S1")])]);
    const hikouki = kanjiVocab([{ b: "飛行機", r: "ひこうき" }]);
    expect(findExampleSentence(hikouki, l)).toBeNull();
  });

  it.each<[string, RubySeg[], string]>([
    ["日 ⊂ 日曜日", [{ b: "日", r: "ひ" }], "日曜日は 休みです。"],
    ["心 ⊂ 心配", [{ b: "心", r: "こころ" }], "母を 心配させました。"],
  ])("單一字元的單字略過(詞首也可能是較長詞的開頭:%s)", (_, ruby, text) => {
    expect(findExampleSentence(kanjiVocab(ruby), lessonOf([text]))).toBeNull();
  });

  it("以完整 ruby 表面形(非 kana)比對", () => {
    // 單字漢字寫法「遊びます」;句子用漢字 → 命中,只寫假名的句子不算
    expect(
      findExampleSentence(asobimasu, lessonOf(["公園で 遊びます。"]))?.id,
    ).toBe("S1");
    expect(
      findExampleSentence(asobimasu, lessonOf(["こうえんで あそびます。"])),
    ).toBeNull();
  });
});

describe("findExampleSentence 詞邊界(T10.5)", () => {
  it("うん 不配「ううん」(意思相反),改配自己的句子", () => {
    const un = vocab("うん");
    expect(
      findExampleSentence(un, lessonOf(["ううん。", "…ううん、暇じゃ ない。"])),
    ).toBeNull();
    const l = lessonOf(["ううん。", "…うん、飲む。"]);
    expect(findExampleSentence(un, l)?.id).toBe("S2");
  });

  it("すぐ 不配「まっすぐ」、そこ 不配「あそこ」、ですから 不配「元気ですから」", () => {
    const sugu = lessonOf([
      "まっすぐですか。",
      "ええ、まっすぐ 行って ください。",
    ]);
    expect(findExampleSentence(vocab("すぐ"), sugu)).toBeNull();
    expect(
      findExampleSentence(vocab("そこ"), lessonOf(["お手洗いは あそこです。"])),
    ).toBeNull();
    expect(
      findExampleSentence(
        vocab("ですから"),
        lessonOf(["わたしは 元気ですから、心配しないで ください。"]),
      ),
    ).toBeNull();
  });

  it.each([
    ["句首", "すぐ 行きます。"],
    ["空白之後", "ミラーさんは すぐ 来ます。"],
    ["「、」之後", "はい、すぐ 行きます。"],
    ["「。」之後", "わかりました。すぐ 行きます。"],
    ["「…」之後", "…すぐ 行きます。"],
    ["「「」之後", "「すぐ 来て ください」と 言いました。"],
    ["「？」之後", "え？すぐですか。"],
    ["「?」之後", "え?すぐですか。"],
    ["「！」之後", "はい！すぐ 行きます。"],
  ])("假名開頭的字在%s算詞首", (_, text) => {
    expect(findExampleSentence(vocab("すぐ"), lessonOf([text]))?.id).toBe("S1");
  });

  it("檢查每個出現位置:第一處是較長詞的一部分,後面有詞首的出現仍算", () => {
    const l = lessonOf(["まっすぐ 行って、すぐ 右です。"]);
    expect(findExampleSentence(vocab("すぐ"), l)?.id).toBe("S1");
  });

  it("漢字開頭的字接在漢字後是複合詞尾,不配(社員 ⊄ 会社員)", () => {
    const shain = kanjiVocab([{ b: "社員", r: "しゃいん" }]);
    const l = lessonOf([
      "いいえ、会社員です。",
      "ミラーさんは IMCの 社員です。",
    ]);
    expect(findExampleSentence(shain, l)?.id).toBe("S2");
    expect(
      findExampleSentence(shain, lessonOf(["いいえ、会社員です。"])),
    ).toBeNull();
  });

  it("漢字開頭的字接在假名後仍配(イタリア料理、てんぷら定食)", () => {
    const ryouri = kanjiVocab([{ b: "料理", r: "りょうり" }]);
    expect(
      findExampleSentence(
        ryouri,
        lessonOf(["わたしは イタリア料理が 好きです。"]),
      )?.id,
    ).toBe("S1");
    const teishoku = kanjiVocab([{ b: "定食", r: "ていしょく" }]);
    expect(
      findExampleSentence(teishoku, lessonOf(["わたしは てんぷら定食。"]))?.id,
    ).toBe("S1");
  });

  it("前一字為「お」「ご」(敬語前綴)不配:帰りに ≠ お帰りに", () => {
    const kaerini = kanjiVocab([{ b: "帰", r: "かえ" }, { b: "りに" }], {
      pos: "慣用",
    });
    expect(
      findExampleSentence(
        kaerini,
        lessonOf(["社長は もう お帰りに なりました。"]),
      ),
    ).toBeNull();
    const l = lessonOf([
      "社長は もう お帰りに なりました。",
      "会社の 帰りに 買い物します。",
    ]);
    expect(findExampleSentence(kaerini, l)?.id).toBe("S2");
    const kazoku = kanjiVocab([{ b: "家族", r: "かぞく" }]);
    expect(findExampleSentence(kazoku, lessonOf(["ご家族は?"]))).toBeNull();
  });

  it("含「→」的活用對照行不選,即使較短", () => {
    const narimasu = vocab("なります", { pos: "動I" });
    expect(
      findExampleSentence(narimasu, lessonOf(["寒い → 寒く なります"])),
    ).toBeNull();
    const l = lessonOf([
      "寒い → 寒く なります",
      "もうすぐ 夏休みに なります。",
    ]);
    expect(findExampleSentence(narimasu, l)?.id).toBe("S2");
  });

  it.each<[string, VocabItem, string]>([
    ["お茶", kanjiVocab([{ b: "お" }, { b: "茶", r: "ちゃ" }]), "お茶"],
    ["ただいま。", vocab("ただいま。", { pos: "慣用" }), "ただいま。"],
    [
      "大変ですね。",
      kanjiVocab([{ b: "大変", r: "たいへん" }, { b: "ですね。" }]),
      "… 大変ですね。",
    ],
    [
      "［お］酒",
      kanjiVocab([{ b: "［お］" }, { b: "酒", r: "さけ" }]),
      "［お］酒",
    ],
    [
      "ご注文は?",
      kanjiVocab([{ b: "ご" }, { b: "注文", r: "ちゅうもん" }, { b: "は?" }]),
      "ご注文は?",
    ],
  ])("正規化後等於單字本身的句子不選:%s", (_, v, text) => {
    expect(findExampleSentence(v, lessonOf([text]))).toBeNull();
  });

  it("句子等於單字本身時跳過,改取較長的真正例句", () => {
    const ocha = kanjiVocab([{ b: "お" }, { b: "茶", r: "ちゃ" }]);
    expect(
      findExampleSentence(ocha, lessonOf(["お茶", "お茶を 飲みます。"]))?.id,
    ).toBe("S2");
    const nandesuka = kanjiVocab([{ b: "何", r: "なん" }, { b: "ですか。" }]);
    expect(
      findExampleSentence(
        nandesuka,
        lessonOf(["何ですか。", "それは 何ですか。"]),
      )?.id,
    ).toBe("S2");
  });
});

describe("findExampleSentence 同課同表面形(T10.5)", () => {
  // L47:します 有〔聲音〕/〔味道〕/〔氣味〕
  const oto = vocab("します", {
    id: "L47-V004",
    pos: "動I",
    note: "〔音／声が〜〕",
  });
  const aji = vocab("します", {
    id: "L47-V005",
    pos: "動I",
    note: "〔味が〜〕",
  });
  const nioi = vocab("します", {
    id: "L47-V006",
    pos: "動I",
    note: "〔においが〜〕",
  });
  const words = [oto, aji, nioi];

  it("須句中含自己 note 的搭配名詞:音 配「変な 音が しますね。」,味/におい 無例句", () => {
    const l = lessonOf(["お先に 失礼します。", "変な 音が しますね。"], words);
    expect(findExampleSentence(oto, l)?.id).toBe("S2");
    expect(findExampleSentence(aji, l)).toBeNull();
    expect(findExampleSentence(nioi, l)).toBeNull();
  });

  it("各自配到含自己名詞的句子;「／」分開的名詞(音／声)皆可", () => {
    const l = lessonOf(
      [
        "変な 音が しますね。",
        "この スープは 変な 味が します。",
        "台所から いい においが します。",
      ],
      words,
    );
    expect(findExampleSentence(oto, l)?.id).toBe("S1");
    expect(findExampleSentence(aji, l)?.id).toBe("S2");
    expect(findExampleSentence(nioi, l)?.id).toBe("S3");
    expect(
      findExampleSentence(oto, lessonOf(["隣の 部屋で 声が します。"], words))
        ?.id,
    ).toBe("S1");
  });

  it("名詞須接助詞(音 ⊄ 音楽);は/も 取代 が 也算", () => {
    expect(
      findExampleSentence(oto, lessonOf(["音楽の 練習を します。"], words)),
    ).toBeNull();
    expect(
      findExampleSentence(oto, lessonOf(["この 車は 音も しますよ。"], words))
        ?.id,
    ).toBe("S1");
  });

  it("搭配名詞也依詞邊界比對(味が ⊄ 興味が)", () => {
    const l = lessonOf(
      ["日本の 歌に 興味が ありますから、毎日 練習を します。"],
      words,
    );
    expect(findExampleSentence(aji, l)).toBeNull();
  });

  it("は/も 只取代 が:〔日本に〜〕います 不配「日本は …います」", () => {
    // L11:います 有〔子どもが〜〕(有)與〔日本に〜〕(在)
    const aru = vocab("います", {
      id: "L11-V001",
      pos: "動II",
      note: "〔子どもが〜〕",
    });
    const zai = vocab("います", {
      id: "L11-V002",
      pos: "動II",
      note: "〔日本に〜〕",
    });
    const l = lessonOf(
      ["日本は 初めてですが、友達が います。", "ミラーさんは 日本に います。"],
      [aru, zai],
    );
    expect(findExampleSentence(zai, l)?.id).toBe("S2");
    expect(
      findExampleSentence(
        zai,
        lessonOf(["日本は 初めてですが、友達が います。"], [aru, zai]),
      ),
    ).toBeNull();
    expect(findExampleSentence(aru, l)).toBeNull();
  });

  it("note 解析不出搭配名詞時不配", () => {
    const a = vocab("います", { id: "L11-V001", pos: "動II", note: "読み物" });
    const b = vocab("います", { id: "L11-V002", pos: "動II" });
    const l = lessonOf(["犬が います。"], [a, b]);
    expect(findExampleSentence(a, l)).toBeNull();
    expect(findExampleSentence(b, l)).toBeNull();
  });

  it("同課沒有同表面形的字時不要求 note 名詞", () => {
    const suru = vocab("します", { id: "L06-V010", pos: "動III" });
    const l = lessonOf(["会議を します。"], [suru]);
    expect(findExampleSentence(suru, l)?.id).toBe("S1");
  });
});
