import { describe, expect, it } from "vitest";
import { normalizeZhPunct as n } from "./lib/zhPunct";
import {
  changesOf,
  normalizeLesson,
  parseArgs,
  report,
  summarize,
} from "./normalize-zh-punct";

/** [輸入, 預期] 逐條驗證,並驗證冪等 */
const expectAll = (cases: readonly (readonly [string, string])[]) => {
  for (const [input, want] of cases) {
    expect(n(input), input).toBe(want);
    expect(n(want), `冪等:${want}`).toBe(want);
  }
};

describe("normalizeZhPunct", () => {
  it("R1 , → ，;千分位 \\d,\\d{3}(?!\\d) 保留(多組亦同),「12,34」與數字旁的中文逗號要轉", () => {
    expectAll([
      ["是書,也是筆", "是書，也是筆"],
      ["找您3,200日圓。", "找您3,200日圓。"],
      ["之後必須付15,000日圓。", "之後必須付15,000日圓。"],
      ["1,000,000 日圓", "1,000,000 日圓"],
      ["12,34", "12，34"],
      ["1,0000", "1，0000"],
      ["是 5 萬日圓,5……。", "是 5 萬日圓，5……。"],
      ["也可以先陳述句2,再以句1", "也可以先陳述句2，再以句1"],
    ]);
  });

  it("R2 ; → ；、R3 : → ：(左右皆為數字的時刻 10:00 才保留)、R4 ? ! → ？ ！", () => {
    expectAll([
      ["現在;過去", "現在；過去"],
      ["過去:肯定", "過去：肯定"],
      ["10:00 出發", "10:00 出發"],
      ["例:1", "例：1"],
      ["句1:表示", "句1：表示"],
      ["好嗎?", "好嗎？"],
      ["那可不行啊!", "那可不行啊！"],
      ["呢?(第26課)", "呢？（第26課）"],
    ]);
  });

  it("R5 ( ) → （ ）不論是否成對:1) 與 (1) 列舉、巢狀、寬度不一的括號對", () => {
    expectAll([
      ["(他人的)丈夫", "（他人的）丈夫"],
      ["1)「から」表示起點。2)", "1）「から」表示起點。2）"],
      ["(1)說話人;(2)對看到", "（1）說話人；（2）對看到"],
      [
        "去世（しにます(第39課)的鄭重說法）",
        "去世（しにます（第39課）的鄭重說法）",
      ],
      ["庫克船長（1728〜79)", "庫克船長（1728〜79）"],
    ]);
  });

  it("R6 刪除轉換標點兩側的 ASCII 空白(含連續空白);分かち書き、數字旁與既有全形標點旁的空白保留", () => {
    expectAll([
      ["形容詞有 1) 成為受詞,和 2) 修飾", "形容詞有 1）成為受詞，和 2）修飾"],
      ["動詞。 (2) お動詞", "動詞。（2）お動詞"],
      ["好嗎 ? 是 , 的", "好嗎？是，的"],
      ["是書   ,   也是筆", "是書，也是筆"],
      ["動詞て形 あげます:表現", "動詞て形 あげます：表現"],
      ["的形式。 「できます」", "的形式。 「できます」"],
      ["利用 ﹐ 用", "利用，用"],
      ['不如 "わたし" 禮貌', "不如 “わたし” 禮貌"],
    ]);
  });

  it("R7 小型變體 ﹐﹑﹖(與 ﹔﹕﹗﹙﹚)→ 一般全形", () => {
    expectAll([
      ["利用﹐用", "利用，用"],
      ["助詞(例如:で﹑に﹑へ等)", "助詞（例如：で、に、へ等）"],
      ["〜怎麼樣﹖", "〜怎麼樣？"],
      ["﹙甲﹚﹔乙﹕丙﹗", "（甲）；乙：丙！"],
    ]);
  });

  it("R8 成對的 ASCII 引號 → “ ”;奇數個不動", () => {
    expectAll([
      ['不如"わたし"禮貌', "不如“わたし”禮貌"],
      ['表示"不能輕易……","不像期望中"。', "表示“不能輕易……”，“不像期望中”。"],
      ['只有一個"引號', '只有一個"引號'],
      ['"甲"乙"', '"甲"乙"'],
    ]);
  });

  it("R9 ～(U+FF5E)→ 〜(U+301C);不算 R6 的轉換標點,兩側空白保留", () => {
    expectAll([
      ["表示“作為～的證明”", "表示“作為〜的證明”"],
      ["將「～だ」改成「～な」", "將「〜だ」改成「〜な」"],
      ["作為 ～ 的證明", "作為 〜 的證明"],
    ]);
  });

  it("不動:. - / … 、 全形英數 U+2011 與已是全形的標點;空字串", () => {
    expectAll([
      ["電話號碼是 871-6813。", "電話號碼是 871-6813。"],
      ["參考本書第8課7.助詞", "參考本書第8課7.助詞"],
      ["我向卡莉娜小姐借了 ＣＤ。", "我向卡莉娜小姐借了 ＣＤ。"],
      ["「はい/いいえ」", "「はい/いいえ」"],
      ["「ウチ\u2011ソト」……、", "「ウチ\u2011ソト」……、"],
      [
        "（自己的）丈夫，妻子；哪？好！“這”〜",
        "（自己的）丈夫，妻子；哪？好！“這”〜",
      ],
      ["", ""],
    ]);
  });
});

/** 合成課程檔:單行 ruby(單字、会話)與逐段換行 ruby(文法例句、会話標題)兩種排版並存 */
const RAW = `{
  "id": 1,
  "title": "N(場所)を 出ます",
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "お" }, { "b": "名前", "r": "なまえ" }, { "b": "は?" }],
      "kana": "おなまえは",
      "accent": 2,
      "meaning": "(您的)姓名?",
      "pos": "慣用",
      "note": "〔〜を します:做作業〕"
    },
    {
      "id": "L01-V002",
      "ruby": [{ "b": "IMC" }],
      "kana": "アイエムシー",
      "meaning": "IMC(公司名)",
      "pos": "名",
      "note": "補充單字(自行練習發音)"
    },
    {
      "id": "L01-V003",
      "ruby": [{ "b": "本", "r": "ほん" }],
      "kana": "ほん",
      "meaning": "書",
      "pos": "名"
    }
  ],
  "grammar": [
    {
      "id": "L01-G01",
      "pattern": "N(場所)を 出ます",
      "explanation": "1) 表示\\"離開\\"的場所,如 15,000;2)參考～",
      "examples": [
        {
          "id": "L01-S01",
          "ruby": [
            { "b": "7時", "r": "しちじ" },
            { "b": "に " },
            { "b": "家", "r": "うち" },
            { "b": "を 出ます。" }
          ],
          "translation": "7 點出門(第 1 課)?"
        },
        {
          "id": "L01-S02",
          "ruby": [{ "b": "はい。" }],
          "translation": "是。"
        }
      ]
    }
  ],
  "dialogueTitle": {
    "ruby": [
      { "b": "ご" },
      { "b": "家族", "r": "かぞく" },
      { "b": "は?" }
    ],
    "translation": "您的家人呢?"
  },
  "dialogues": [
    {
      "id": "L01-D01",
      "ruby": [{ "b": "A:どうぞ。" }],
      "translation": "請,10:00 見﹐好!",
      "speaker": "A:"
    }
  ]
}
`;

describe("normalizeLesson:原始 JSON 手術式改寫", () => {
  const result = normalizeLesson(RAW);
  const before = RAW.split("\n");
  const after = result.text.split("\n");
  const changedLines = () =>
    before.flatMap((line, i) => (line === after[i] ? [] : [i]));

  it("只改中文鍵的值:每筆改動恰一行、行數與其他位元不變", () => {
    expect(after).toHaveLength(before.length);
    expect(changedLines().map((i) => after[i].trim())).toEqual([
      '"meaning": "（您的）姓名？",',
      '"note": "〔〜を します：做作業〕"',
      '"meaning": "IMC（公司名）",',
      '"explanation": "1）表示“離開”的場所，如 15,000；2）參考〜",',
      '"translation": "7 點出門（第 1 課）？"',
      '"translation": "您的家人呢？"',
      '"translation": "請，10:00 見，好！",',
    ]);
  });

  it("日文欄位(課名、文型、ruby、kana、speaker)與段落標記 note 不動", () => {
    const json = JSON.parse(result.text);
    expect(json.title).toBe("N(場所)を 出ます");
    expect(json.grammar[0].pattern).toBe("N(場所)を 出ます");
    expect(json.vocab[0].ruby[2]).toEqual({ b: "は?" });
    expect(json.dialogueTitle.ruby[2]).toEqual({ b: "は?" });
    expect(json.dialogues[0].ruby[0].b).toBe("A:どうぞ。");
    expect(json.dialogues[0].speaker).toBe("A:");
    expect(json.vocab[1].note).toBe("補充單字(自行練習發音)");
    expect(result.skippedMarkers).toBe(1);
    expect(result.values.map((v) => `${v.id} ${v.field}`)).not.toContain(
      "L01-V002 note",
    );
  });

  it("改動清單(含会話標題的 id「L01:dialogueTitle」);未改動的值不列", () => {
    expect(changesOf(result).map((v) => `${v.id} ${v.field}`)).toEqual([
      "L01-V001 meaning",
      "L01-V001 note",
      "L01-V002 meaning",
      "L01-G01 explanation",
      "L01-S01 translation",
      "L01:dialogueTitle translation",
      "L01-D01 translation",
    ]);
    expect(result.values).toHaveLength(9);
  });

  it("重跑 0 變動、逐位元相同", () => {
    const again = normalizeLesson(result.text);
    expect(again.text).toBe(result.text);
    expect(changesOf(again)).toEqual([]);
  });

  it("原文的字串編碼與資料不符(\\u 跳脫)即丟錯,不猜", () => {
    const escaped = RAW.replace('"meaning": "書"', '"meaning": "\\u66f8,"');
    expect(() => normalizeLesson(escaped)).toThrow("0 處");
  });

  it("課程檔有 LessonSchema 不認得、會被丟棄的 key 即丟錯", () => {
    const extra = RAW.replace(
      '"pos": "名"\n',
      '"pos": "名",\n      "memo": "x"\n',
    );
    expect(() => normalizeLesson(extra)).toThrow("會被丟棄的 key");
  });

  it("CRLF 課程檔:有待改項即明確報換行格式(含只有会話標題待改);全部已正規化則原文不變", () => {
    const crlf = (text: string) => text.replace(/\n/g, "\r\n");
    expect(() => normalizeLesson(crlf(RAW))).toThrow(
      "課程檔為 CRLF 換行,請轉為 LF",
    );
    const titleOnly = result.text.replace('"您的家人呢？"', '"您的家人呢?"');
    expect(changesOf(normalizeLesson(titleOnly)).map((v) => v.id)).toEqual([
      "L01:dialogueTitle",
    ]);
    expect(() => normalizeLesson(crlf(titleOnly))).toThrow(
      "課程檔為 CRLF 換行,請轉為 LF",
    );
    expect(normalizeLesson(crlf(result.text)).text).toBe(crlf(result.text));
  });
});

describe("摘要與 --check", () => {
  const pending = [normalizeLesson(RAW)];
  const done = [normalizeLesson(pending[0].text)];

  it("summarize:各組筆數、各規則字數(R6 為刪除的空白)、保留的千分位與時刻", () => {
    const s = summarize(pending);
    expect(s.groups).toEqual([
      { group: "meaning", values: 3, changed: 2 },
      { group: "note", values: 1, changed: 1 },
      { group: "explanation", values: 1, changed: 1 },
      { group: "examples", values: 2, changed: 1 },
      { group: "dialogues", values: 2, changed: 2 },
    ]);
    expect(s.chars.map((c) => `${c.rule} ${c.ch} ${c.n}`)).toEqual([
      "R1 , 2",
      "R2 ; 1",
      "R3 : 1",
      "R4 ? 3",
      "R4 ! 1",
      "R5 ( 3",
      "R5 ) 5",
      "R6   1",
      "R7 ﹐ 1",
      'R8 " 2',
      "R9 ～ 1",
    ]);
    expect(s.preserved.map((p) => `${p.kind} ${p.id}`)).toEqual([
      "千分位 L01-G01",
      "時刻 L01-D01",
    ]);
    expect([s.total, s.changed, s.files, s.skippedMarkers]).toEqual([
      9, 7, 1, 1,
    ]);
  });

  it("--check:有待改項 exit 1;全部已正規化 exit 0;寫入模式 exit 0", () => {
    const check = report(pending, { check: true, list: false });
    expect(check.exitCode).toBe(1);
    expect(check.lines.at(-1)).toBe(
      "待正規化 7/9 筆(1 個檔);執行 pnpm normalize:zh-punct 寫入",
    );
    expect(check.lines).toContain(
      "  千分位 L01-G01 explanation「…所，如 15,000；2）…」",
    );
    const clean = report(done, { check: true, list: false });
    expect(clean.exitCode).toBe(0);
    expect(clean.lines.at(-1)).toBe("中文值 9 筆皆已正規化,沒有變動");
    const write = report(pending, { check: false, list: false });
    expect(write.exitCode).toBe(0);
    expect(write.lines.at(-1)).toBe("正規化 7/9 筆、寫入 1 個檔");
  });

  it("--list 逐筆列出改動;奇數個引號列為特例", () => {
    const { lines } = report(pending, { check: true, list: true });
    expect(lines.slice(0, 2)).toEqual([
      "L01-V001 meaning:(您的)姓名?",
      "  → （您的）姓名？",
    ]);
    const odd = normalizeLesson(
      RAW.replace('"meaning": "書"', '"meaning": "書\\""'),
    );
    expect(report([odd], { check: true, list: false }).lines).toContain(
      "ASCII 引號為奇數個、未轉換 1 筆:L01-V003 meaning",
    );
  });

  it("parseArgs:--check、--list;略過 pnpm 轉傳的 --;其他參數報錯", () => {
    expect(parseArgs([])).toEqual({ check: false, list: false });
    expect(parseArgs(["--", "--check", "--list"])).toEqual({
      check: true,
      list: true,
    });
    expect(parseArgs(["--dry"])).toEqual({
      error: expect.stringContaining("不認得的參數「--dry」"),
    });
  });
});
