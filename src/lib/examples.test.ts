import type {
  GrammarPoint,
  Lesson,
  RubySeg,
  Sentence,
  VocabItem,
} from "@/schemas/lesson";
import { findExampleMatch, findExampleSentence } from "./examples";

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
    pos: "動III",
    note: "〔音／声が〜〕",
  });
  const aji = vocab("します", {
    id: "L47-V005",
    pos: "動III",
    note: "〔味が〜〕",
  });
  const nioi = vocab("します", {
    id: "L47-V006",
    pos: "動III",
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

describe("findExampleMatch(T11.8 例句填空)", () => {
  it("回傳單字在句子表面文字中的位置(第一個位於詞開頭處)", () => {
    const l = lessonOf(["まっすぐ 行って、すぐ 右です。"]);
    const m = findExampleMatch(vocab("すぐ"), l);
    expect(m?.sentence.id).toBe("S1");
    expect(m && [m.start, m.end]).toEqual([9, 11]); // まっすぐ 的「すぐ」不算
  });

  it("accept 不通過時改看其他句,仍取最短;全不通過回傳 null", () => {
    const l = lessonOf([
      "公園で 遊びます。",
      "日曜日は 公園で 遊びます。",
      "子どもたちは 毎日 公園で 遊びます。",
    ]);
    const m = findExampleMatch(
      asobimasu,
      l,
      ({ sentence }) => sentence.id !== "S1",
    );
    expect(m?.sentence.id).toBe("S2");
    expect(findExampleMatch(asobimasu, l, () => false)).toBeNull();
    expect(findExampleSentence(asobimasu, l)?.id).toBe("S1"); // 不影響語境例句
  });
});

// ── T11.9 動詞活用形 ─────────────────────────────────────────────────

/** 帶讀音的例句:「会(あ)いましょう」的漢字段寫成「漢字(よみ)」,其餘為假名段 */
function rubySentence(text: string, id = "S"): Sentence {
  const ruby: RubySeg[] = [];
  let last = 0;
  for (const m of text.matchAll(/([㐀-鿿々]+)\(([ぁ-ゖ]+)\)/g)) {
    if (m.index > last) ruby.push({ b: text.slice(last, m.index) });
    ruby.push({ b: m[1], r: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) ruby.push({ b: text.slice(last) });
  return { id, ruby, translation: `${id} 的翻譯` };
}

/** 帶讀音例句的課:依序編號 S1、S2… */
function rubyLesson(texts: string[], words: VocabItem[] = []): Lesson {
  return lesson(
    [grammar(texts.map((t, i) => rubySentence(t, `S${i + 1}`)))],
    [],
    words,
  );
}

/** 動詞:ruby 以同一「漢字(よみ)」寫法;kana 為讀音去空白(教材 kana 欄的慣例) */
function verb(
  text: string,
  pos: VocabItem["pos"],
  overrides: Partial<VocabItem> = {},
): VocabItem {
  const { ruby } = rubySentence(text);
  const kana = ruby
    .map((s) => s.r ?? s.b)
    .join("")
    .replace(/\s/g, "");
  return kanjiVocab(ruby, { pos, kana, ...overrides });
}

/** 比對到的片段(以【】標出) */
function marked(v: VocabItem, l: Lesson): string | null {
  const m = findExampleMatch(v, l);
  if (!m) return null;
  const t = m.sentence.ruby.map((s) => s.b).join("");
  return `${t.slice(0, m.start)}【${t.slice(m.start, m.end)}】${t.slice(m.end)}`;
}

const aimasu = verb("会(あ)います", "動I", { note: "［友達に〜］" });

describe("findExampleMatch 動詞活用形(T11.9)", () => {
  it("会います 命中「会いましょう」(語幹 2 字、有漢字:不要求 note 名詞),kind 為 conjugated", () => {
    const l = rubyLesson([
      "10時(じ)です。大阪城公園駅(おおさかじょうこうえんえき)で 会(あ)いましょう。",
    ]);
    const m = findExampleMatch(aimasu, l);
    expect(m?.kind).toBe("conjugated");
    expect(marked(aimasu, l)).toBe(
      "10時です。大阪城公園駅で 【会いましょう】。",
    );
    expect(findExampleSentence(aimasu, l)?.id).toBe("S1");
  });

  it("ます形命中一律優先(即使活用形的句子較短),kind 為 exact", () => {
    const l = rubyLesson([
      "駅(えき)で 会(あ)いましょう。",
      "あした 駅(えき)で 友達(ともだち)に 会(あ)います。",
    ]);
    const m = findExampleMatch(aimasu, l);
    expect(m?.kind).toBe("exact");
    expect(m?.sentence.id).toBe("S2");
  });

  it("活用形之間也取最短句;同一位置取最長的形(会いませんでした)", () => {
    const l = rubyLesson([
      "きのう 駅(えき)で 友達(ともだち)に 会(あ)いませんでした。",
      "駅(えき)で 会(あ)いませんでした。",
    ]);
    expect(marked(aimasu, l)).toBe("駅で 【会いませんでした】。");
  });

  it.each<[string, VocabItem, string, string]>([
    [
      "て形 + ください",
      verb("曲(ま)がります", "動I"),
      "右(みぎ)へ 曲(ま)がって ください。",
      "右へ 【曲がって】 ください。",
    ],
    [
      "て形 + も",
      verb("考(かんが)えます", "動II"),
      "いくら 考(かんが)えても、わかりません。",
      "いくら 【考えて】も、わかりません。",
    ],
    [
      "た形 + ら",
      verb("連絡(れんらく)します", "動III"),
      "会社(かいしゃ)に 連絡(れんらく)したら、すぐ 来(き)ます。",
      "会社に 【連絡した】ら、すぐ 来ます。",
    ],
    [
      "た形 + んです",
      verb("遅(おく)れます", "動II"),
      "どうして 遅(おく)れたんですか。",
      "どうして 【遅れた】んですか。",
    ],
    [
      "ない形 + で",
      verb("心配(しんぱい)します", "動III"),
      "心配(しんぱい)しないで ください。",
      "【心配しない】で ください。",
    ],
    [
      "なければ",
      verb("返(かえ)します", "動I"),
      "本(ほん)を 返(かえ)さなければ なりません。",
      "本を 【返さなければ】 なりません。",
    ],
    [
      "辞書形 + と",
      verb("回(まわ)します", "動I"),
      "これを 回(まわ)すと、音(おと)が 大(おお)きく なります。",
      "これを 【回す】と、音が 大きく なります。",
    ],
    [
      "辞書形 + のが",
      verb("育(そだ)てます", "動II"),
      "花(はな)を 育(そだ)てるのが 好(す)きです。",
      "花を 【育てる】のが 好きです。",
    ],
    [
      "意向形 + と",
      verb("続(つづ)けます", "動II"),
      "柔道(じゅうどう)を 続(つづ)けようと 思(おも)って います。",
      "柔道を 【続けよう】と 思って います。",
    ],
    [
      "條件形",
      verb("急(いそ)ぎます", "動I"),
      "急(いそ)げば、間(ま)に 合(あ)います。",
      "【急げば】、間に 合います。",
    ],
    [
      "〜たい",
      verb("撮(と)ります", "動I"),
      "写真(しゃしん)を 撮(と)りたいです。",
      "写真を 【撮りたい】です。",
    ],
    [
      "〜ながら",
      verb("歩(ある)きます", "動I"),
      "歩(ある)きながら 話(はな)しましょう。",
      "【歩きながら】 話しましょう。",
    ],
    [
      "〜にくい",
      verb("乾(かわ)きます", "動I"),
      "洗濯物(せんたくもの)が 乾(かわ)きにくいです。",
      "洗濯物が 【乾きにくい】です。",
    ],
    [
      "被動(Ⅰ類)",
      verb("頼(たの)みます", "動I"),
      "母(はは)に 買(か)い物(もの)を 頼(たの)まれました。",
      "母に 買い物を 【頼まれました】。",
    ],
    [
      "被動(Ⅱ類)",
      verb("褒(ほ)めます", "動II"),
      "先生(せんせい)に 褒(ほ)められました。",
      "先生に 【褒められました】。",
    ],
    [
      "被動(する)",
      verb("輸出(ゆしゅつ)します", "動III"),
      "車(くるま)が 輸出(ゆしゅつ)されて います。",
      "車が 【輸出されて】 います。",
    ],
    [
      "可能(する)",
      verb("優勝(ゆうしょう)します", "動III"),
      "優勝(ゆうしょう)できなくて、残念(ざんねん)です。",
      "【優勝できなくて】、残念です。",
    ],
    [
      "多詞動詞",
      verb("無理(むり)を します", "動III"),
      "無理(むり)を しない ほうが いいですよ。",
      "【無理を しない】 ほうが いいですよ。",
    ],
  ])("%s", (_, v, text, expected) => {
    expect(marked(v, rubyLesson([text]))).toBe(expected);
  });

  it("Ⅰ類的可能形不比對(切れる 等常是另一個動詞)", () => {
    const kirimasu = verb("切(き)ります", "動I");
    expect(
      findExampleSentence(kirimasu, rubyLesson(["ひもが 切(き)れました。"])),
    ).toBeNull();
  });

  it("ます形語幹本身(名詞同形:休み、帰り)不算活用形", () => {
    const yasumimasu = verb("休(やす)みます", "動I");
    expect(
      findExampleSentence(
        yasumimasu,
        rubyLesson(["銀行(ぎんこう)の 休(やす)みは 土曜日(どようび)です。"]),
      ),
    ).toBeNull();
  });

  it("須在分かち書き的詞首:漢字開頭也不接在假名之後(受け取って ⊄ 取ります)", () => {
    const torimasu = verb("取(と)ります", "動I");
    expect(
      findExampleSentence(
        torimasu,
        rubyLesson(["荷物(にもつ)を 受(う)け取(と)って ください。"]),
      ),
    ).toBeNull();
    expect(
      marked(torimasu, rubyLesson(["塩(しお)を 取(と)って ください。"])),
    ).toBe("塩を 【取って】 ください。");
  });

  it("右邊界:詞尾後須是邊界字元或所列的助詞、助動詞(〜てる 等縮約不收)", () => {
    const machimasu = verb("待(ま)ちます", "動I");
    expect(
      findExampleSentence(
        machimasu,
        rubyLesson(["ありがとう。待(ま)ってるよ。"]),
      ),
    ).toBeNull();
    expect(
      marked(machimasu, rubyLesson(["いくら 待(ま)っても 来(き)ません。"])),
    ).toBe("いくら 【待って】も 来ません。");
  });

  it("讀音須相同:開(あ)きます ≠ 開(ひら)いて、降(お)ります ≠ 降(ふ)りました", () => {
    const akimasu = verb("開(あ)きます", "動I");
    expect(
      findExampleSentence(
        akimasu,
        rubyLesson([
          "日曜日(にちようび)に 教室(きょうしつ)を 開(ひら)いて います。",
        ]),
      ),
    ).toBeNull();
    expect(marked(akimasu, rubyLesson(["ドアが 開(あ)いて います。"]))).toBe(
      "ドアが 【開いて】 います。",
    );
    const orimasu = verb("降(お)ります", "動II");
    expect(
      findExampleSentence(
        orimasu,
        rubyLesson(["きのう 雨(あめ)が 降(ふ)りました。"]),
      ),
    ).toBeNull();
  });

  it("一字語幹(します、来ます…)須在活用形之前有 note 的搭配名詞;沒有 note 則不配", () => {
    // L34-V007:します〔ネクタイを〜〕
    const shimasu = vocab("します", {
      id: "L34-V007",
      pos: "動III",
      note: "〔ネクタイを〜〕",
    });
    expect(
      findExampleSentence(
        shimasu,
        lessonOf(["わたしが する とおりに、して くださいね。"]),
      ),
    ).toBeNull();
    expect(
      marked(shimasu, lessonOf(["きょうは ネクタイを して います。"])),
    ).toBe("きょうは ネクタイを 【して】 います。");
    // 搭配名詞在後面不算
    expect(
      findExampleSentence(
        shimasu,
        lessonOf(["して ください。ネクタイを 忘れないで。"]),
      ),
    ).toBeNull();
    const kimasu = verb("来(き)ます", "動III");
    expect(
      findExampleSentence(
        kimasu,
        rubyLesson(["日本(にほん)へ 来(き)ました。"]),
      ),
    ).toBeNull();
  });

  it("同課同表面形(L46 出ます×2):各自須有 note 的搭配名詞", () => {
    const bus = verb("出(で)ます", "動II", {
      id: "L46-V004",
      note: "［バスが〜］",
    });
    const hon = verb("出(で)ます", "動II", {
      id: "L46-V032",
      note: "［本が〜］",
    });
    const l = rubyLesson(
      ["たった 今(いま) バスが 出(で)た ところです。"],
      [bus, hon],
    );
    expect(marked(bus, l)).toBe("たった 今 バスが 【出た】 ところです。");
    expect(findExampleSentence(hon, l)).toBeNull();
  });

  it("同課同表面形:語幹 2 字以上(会います×2)也須有各自 note 的搭配名詞", () => {
    const tomodachi = verb("会(あ)います", "動I", {
      id: "L13-V001",
      note: "［友達に〜］",
    });
    const jiko = verb("会(あ)います", "動I", {
      id: "L13-V002",
      note: "［事故に〜］",
    });
    const noNoun = rubyLesson(
      ["駅(えき)で 会(あ)いましょう。"],
      [tomodachi, jiko],
    );
    expect(findExampleSentence(tomodachi, noNoun)).toBeNull();
    expect(findExampleSentence(jiko, noNoun)).toBeNull();
    const withNoun = rubyLesson(
      ["駅(えき)で 友達(ともだち)に 会(あ)いましょう。"],
      [tomodachi, jiko],
    );
    expect(marked(tomodachi, withNoun)).toBe("駅で 友達に 【会いましょう】。");
    expect(findExampleSentence(jiko, withNoun)).toBeNull();
    // 單獨一個 会います(非同形)則不要求名詞
    expect(
      marked(tomodachi, rubyLesson(["駅(えき)で 会(あ)いましょう。"])),
    ).toBe("駅で 【会いましょう】。");
  });

  it("note 有多個括號(［でんきが〜］［電気が〜］)時任一名詞皆可", () => {
    const tsukimasu = vocab("つきます", {
      pos: "動I",
      note: "［でんきが〜］［電気が〜］",
    });
    expect(
      marked(tsukimasu, rubyLesson(["電気(でんき)が ついて います。"])),
    ).toBe("電気が 【ついて】 います。");
  });

  it("沒有漢字、語幹不足 3 字的動詞:只收ます系(ありません),其他形須有搭配名詞(ある 日 ≠ あります)", () => {
    const arimasu = vocab("あります", { pos: "動I" });
    expect(marked(arimasu, rubyLesson(["時間(じかん)が ありませんか。"]))).toBe(
      "時間が 【ありません】か。",
    );
    expect(
      findExampleSentence(
        arimasu,
        rubyLesson([
          "ある 日(ひ)、町(まち)で 友達(ともだち)に 会(あ)いました。",
        ]),
      ),
    ).toBeNull();
    const tsukemasu = vocab("つけます", { pos: "動II" });
    expect(
      findExampleSentence(
        tsukemasu,
        rubyLesson(["車(くるま)に 気(き)を つけて ください。"]),
      ),
    ).toBeNull();
  });

  it("あります 不配名詞、形容詞否定的 〜じゃ/では/く ありません(不是「有/在」)", () => {
    const arimasu = vocab("あります", { pos: "動I" });
    for (const text of [
      "わたしは 学生(がくせい)じゃ ありません。",
      "これは 本(ほん)では ありません。",
      "きょうは 寒(さむ)く ありませんでした。",
    ]) {
      expect(findExampleSentence(arimasu, rubyLesson([text])), text).toBeNull();
    }
    expect(
      marked(
        arimasu,
        rubyLesson(["冷蔵庫(れいぞうこ)に 何(なに)も ありません。"]),
      ),
    ).toBe("冷蔵庫に 何も 【ありません】。");
  });

  it("沒有漢字的動詞在て形之後(補助動詞位置)不配:〜て しまいました ≠ しまいます", () => {
    const shimaimasu = vocab("しまいます", { pos: "動I" });
    expect(
      findExampleSentence(
        shimaimasu,
        rubyLesson(["電車(でんしゃ)に 傘(かさ)を 忘(わす)れて しまいました。"]),
      ),
    ).toBeNull();
    expect(
      marked(
        shimaimasu,
        rubyLesson(["はさみを 引(ひ)き出(だ)しに しまって ください。"]),
      ),
    ).toBe("はさみを 引き出しに 【しまって】 ください。");
  });

  it("不選含「→」的對照行、正規化後等於活用形本身的句子", () => {
    const nomimasu = verb("飲(の)みます", "動I");
    expect(
      findExampleSentence(
        nomimasu,
        rubyLesson(["飲(の)みます → 飲(の)んで", "飲(の)んで。"]),
      ),
    ).toBeNull();
  });

  it("非動詞不找活用形(形容詞的活用不比對);accept 可只收 exact", () => {
    const samui = verb("寒(さむ)い", "い形");
    expect(
      findExampleSentence(samui, rubyLesson(["きのうは 寒(さむ)かったです。"])),
    ).toBeNull();
    const l = rubyLesson(["駅(えき)で 会(あ)いましょう。"]);
    expect(
      findExampleMatch(aimasu, l, ({ kind }) => kind === "exact"),
    ).toBeNull();
  });
});
