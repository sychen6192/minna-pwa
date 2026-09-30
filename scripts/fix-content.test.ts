import { describe, expect, it } from "vitest";
import type { RubySeg } from "../src/schemas/lesson";
import {
  fixLesson,
  parseArgs,
  parseLesson,
  statusOf,
  summarize,
  validateCorrections,
  verifyWritten,
  type DialogueTitleCorrection,
  type FieldCorrection,
  type RubySplitCorrection,
} from "./fix-content";

/** 合成課程檔:單行 ruby(單字、会話)與逐段換行 ruby(文法例句)兩種排版並存 */
const RAW = `{
  "id": 1,
  "title": "はじめまして",
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "え―と" }],
      "kana": "え―と",
      "meaning": "嗯，我看看",
      "pos": "慣用"
    },
    {
      "id": "L01-V002",
      "ruby": [{ "b": "再入国", "r": "さいにゅうこく" }, { "b": "ビザ" }],
      "kana": "さいにゅうこくビザ",
      "accent": 6,
      "meaning": "再入境簽証",
      "pos": "名"
    }
  ],
  "grammar": [
    {
      "id": "L01-G01",
      "pattern": "名詞に 動詞",
      "explanation": "表示“作為～的証明”、“作為～的紀念”的意思。",
      "examples": [
        {
          "id": "L01-S01",
          "ruby": [
            { "b": "記念", "r": "きねん" },
            { "b": "に " },
            { "b": "写真", "r": "しゃしん" },
            { "b": "を " },
            { "b": "撮", "r": "と" },
            { "b": "ります。" }
          ],
          "translation": "拍照作為紀念。"
        }
      ]
    }
  ],
  "dialogues": [
    {
      "id": "L01-D01",
      "ruby": [{ "b": "渡辺", "r": "わたなべ" }, { "b": "さんと いうんです。" }],
      "translation": "他也姓渡辺呢。漢斯・施密特也是。",
      "speaker": "渡辺"
    }
  ]
}
`;

const fc = (
  c: Pick<FieldCorrection, "id" | "field" | "from" | "to"> &
    Partial<FieldCorrection>,
): FieldCorrection => ({ kind: "field", lesson: 1, reason: "測試", ...c });

/** 整值 3 種(ruby 單行與逐段換行、kana)+ 子字串 3 種(meaning、explanation、translation) */
const SIX = [
  fc({ id: "L01-V001", field: "ruby.0.b", from: "え―と", to: "えーと" }),
  fc({ id: "L01-V001", field: "kana", from: "え―と", to: "えーと" }),
  fc({ id: "L01-S01", field: "ruby.5.b", from: "ります。", to: "りました。" }),
  fc({ id: "L01-V002", field: "meaning", from: "簽証", to: "簽證" }),
  fc({ id: "L01-G01", field: "explanation", from: "証明", to: "證明" }),
  fc({ id: "L01-D01", field: "translation", from: "渡辺", to: "渡邊" }),
];

const changedLines = (a: string, b: string) => {
  const x = a.split("\n");
  const y = b.split("\n");
  expect(y).toHaveLength(x.length);
  return x.flatMap((line, i) => (line === y[i] ? [] : [`${line} → ${y[i]}`]));
};

describe("fixLesson:套用", () => {
  it("只有目標行改變,其餘逐位元相同", () => {
    const fix = fixLesson(RAW, SIX);
    expect(fix.results.map((r) => r.status)).toEqual(Array(6).fill("pending"));
    expect(changedLines(RAW, fix.text)).toEqual([
      '      "ruby": [{ "b": "え―と" }], →       "ruby": [{ "b": "えーと" }],',
      '      "kana": "え―と", →       "kana": "えーと",',
      '      "meaning": "再入境簽証", →       "meaning": "再入境簽證",',
      '      "explanation": "表示“作為～的証明”、“作為～的紀念”的意思。", →       "explanation": "表示“作為～的證明”、“作為～的紀念”的意思。",',
      '            { "b": "ります。" } →             { "b": "りました。" }',
      '      "translation": "他也姓渡辺呢。漢斯・施密特也是。", →       "translation": "他也姓渡邊呢。漢斯・施密特也是。",',
    ]);
    // 子字串修正只換那一處;speaker 與 ruby 的渡辺(日文)不動
    const d = JSON.parse(fix.text).dialogues[0];
    expect(d.speaker).toBe("渡辺");
    expect(d.ruby[0].b).toBe("渡辺");
  });

  it("重跑 0 變動、逐位元相同,狀態皆為已套用", () => {
    const once = fixLesson(RAW, SIX).text;
    const twice = fixLesson(once, SIX);
    expect(twice.text).toBe(once);
    expect(twice.results.map((r) => r.status)).toEqual(
      Array(6).fill("applied"),
    );
  });

  it("key 順序不變(含選填的 accent)", () => {
    const keys = (text: string) => {
      const l = JSON.parse(text);
      return [
        Object.keys(l),
        ...l.vocab.map(Object.keys),
        ...l.grammar.map(Object.keys),
        ...l.grammar[0].examples.map(Object.keys),
        ...l.dialogues.map(Object.keys),
      ];
    };
    expect(keys(fixLesson(RAW, SIX).text)).toEqual(keys(RAW));
  });

  it('值含「"」與 $ 替換樣式時以 JSON 編碼寫入', () => {
    const fix = fixLesson(RAW, [
      fc({
        id: "L01-D01",
        field: "translation",
        from: "漢斯・施密特",
        to: '"漢斯·施密特" $&',
      }),
    ]);
    expect(changedLines(RAW, fix.text)).toEqual([
      '      "translation": "他也姓渡辺呢。漢斯・施密特也是。", →       "translation": "他也姓渡辺呢。\\"漢斯·施密特\\" $&也是。",',
    ]);
  });
});

describe("fixLesson:狀態與拒絕", () => {
  const lesson = () => JSON.parse(RAW);

  it("整值:現值 = to 已套用、= from 待套用、其他丟錯", () => {
    const c = fc({
      id: "L01-V001",
      field: "kana",
      from: "え―と",
      to: "えーと",
    });
    expect(statusOf(lesson(), c)).toBe("pending");
    expect(statusOf(lesson(), { ...c, from: "x", to: "え―と" })).toBe(
      "applied",
    );
    expect(() => fixLesson(RAW, [{ ...c, from: "えと" }])).toThrow("既非 from");
  });

  it("子字串出現 0 次(且不含 to)或 2 次即丟錯;0 次且含 to = 已套用", () => {
    const g = (from: string, to: string) =>
      fc({ id: "L01-G01", field: "explanation", from, to });
    expect(() => fixLesson(RAW, [g("作為～", "作為〜")])).toThrow("出現 2 次");
    expect(() => fixLesson(RAW, [g("證書", "証書")])).toThrow(
      "出現 0 次且不含",
    );
    expect(statusOf(lesson(), g("証書", "紀念"))).toBe("applied");
  });

  it("物件或欄位不存在、課號不符、修正後不符 Zod 即丟錯", () => {
    expect(() =>
      fixLesson(RAW, [
        fc({ id: "L01-V009", field: "kana", from: "a", to: "b" }),
      ]),
    ).toThrow("0 個物件");
    expect(() =>
      fixLesson(RAW, [
        fc({ id: "L01-V001", field: "ruby.1.b", from: "a", to: "b" }),
      ]),
    ).toThrow("欄位不存在");
    expect(() =>
      fixLesson(RAW, [
        fc({ lesson: 2, id: "L02-V001", field: "kana", from: "a", to: "b" }),
      ]),
    ).toThrow("不屬於第 1 課");
    expect(() =>
      fixLesson(RAW, [
        fc({ id: "L01-V002", field: "pos", from: "名", to: "名詞" }),
      ]),
    ).toThrow(/^L01:寫入核對失敗\(不符 LessonSchema:vocab\.1\.pos:/);
  });

  it("套用後仍非已套用(重跑會再改)即丟錯:子字串修正在結果中再生 from", () => {
    const raw = RAW.replace("再入境簽証", "再入境的的的");
    const c = fc({ id: "L01-V002", field: "meaning", from: "的的", to: "的" });
    expect(validateCorrections([c])).toEqual([]);
    expect(() => fixLesson(raw, [c])).toThrow(
      "L01-V002 meaning「的的」→「的」:套用後未呈已套用",
    );
  });

  it("同一欄位的子字串修正:互不干擾者皆套用;後一筆改掉前一筆的結果即丟錯", () => {
    const t = (from: string, to: string) =>
      fc({ id: "L01-D01", field: "translation", from, to });
    const both = [t("渡辺", "渡邊"), t("漢斯・施密特", "漢斯·施密特")];
    const fix = fixLesson(RAW, both);
    expect(JSON.parse(fix.text).dialogues[0].translation).toBe(
      "他也姓渡邊呢。漢斯·施密特也是。",
    );
    expect(fixLesson(fix.text, both).text).toBe(fix.text);
    // 後一筆把前一筆的 to 改回 from:第一次就拒絕,不留下每次重跑都會變的資料
    expect(() =>
      fixLesson(RAW, [t("渡辺", "渡邊"), t("姓渡邊", "姓渡辺")]),
    ).toThrow("L01-D01 translation「渡辺」→「渡邊」:套用後未呈已套用");
  });

  it("課程檔有 LessonSchema 不認得的 key 即丟錯(即使沒有待套用項)", () => {
    const raw = RAW.replace(
      '"pos": "慣用"',
      '"pos": "慣用",\n      "extra": 1',
    );
    expect(() => fixLesson(raw, [])).toThrow(
      "L01:寫入核對失敗(有 LessonSchema 不認得、會被丟棄的 key)",
    );
  });
});

/** 合成課程檔:会話第一行是標題(L24 寫法:speaker「標題」);台詞有逐段換行與單行兩種 ruby 排版 */
const RAW_T = `{
  "id": 1,
  "title": "はじめまして",
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "手伝", "r": "てつだ" }, { "b": "います" }],
      "kana": "てつだいます",
      "meaning": "幫忙",
      "pos": "動I"
    }
  ],
  "grammar": [],
  "dialogues": [
    {
      "id": "L01-D01",
      "ruby": [
        { "b": "手伝", "r": "てつだ" },
        { "b": "って くれますか" }
      ],
      "translation": "可以幫我嗎",
      "speaker": "標題"
    },
    {
      "id": "L01-D02",
      "ruby": [{ "b": "何", "r": "なん" }, { "b": "ですか。" }],
      "translation": "什麼事呢？",
      "speaker": "ワン"
    },
    {
      "id": "L01-D03",
      "ruby": [
        { "b": "引", "r": "ひ" },
        { "b": "っ" },
        { "b": "越", "r": "こ" },
        { "b": "しです。" }
      ],
      "translation": "搬家。",
      "speaker": "カリナ"
    }
  ]
}
`;

/** RAW_T 修正後:標題移入 dialogueTitle(置於 dialogues 前、內縮 2 格),其餘台詞 id 遞補,其他位元不動 */
const FIXED_T = `{
  "id": 1,
  "title": "はじめまして",
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "手伝", "r": "てつだ" }, { "b": "います" }],
      "kana": "てつだいます",
      "meaning": "幫忙",
      "pos": "動I"
    }
  ],
  "grammar": [],
  "dialogueTitle": {
    "ruby": [
      { "b": "手伝", "r": "てつだ" },
      { "b": "って くれますか" }
    ],
    "translation": "可以幫我嗎"
  },
  "dialogues": [
    {
      "id": "L01-D01",
      "ruby": [{ "b": "何", "r": "なん" }, { "b": "ですか。" }],
      "translation": "什麼事呢？",
      "speaker": "ワン"
    },
    {
      "id": "L01-D02",
      "ruby": [
        { "b": "引", "r": "ひ" },
        { "b": "っ" },
        { "b": "越", "r": "こ" },
        { "b": "しです。" }
      ],
      "translation": "搬家。",
      "speaker": "カリナ"
    }
  ]
}
`;

const tc = (
  from: DialogueTitleCorrection["from"],
  over: Partial<DialogueTitleCorrection> = {},
): DialogueTitleCorrection => ({
  kind: "dialogueTitle",
  lesson: 1,
  from,
  reason: "測試",
  ...over,
});

/** RAW_T 的標題行 */
const TITLE = tc({
  id: "L01-D01",
  ruby: [{ b: "手伝", r: "てつだ" }, { b: "って くれますか" }],
  translation: "可以幫我嗎",
  speaker: "標題",
});

describe("fixLesson:会話標題移入 dialogueTitle", () => {
  it("標題移入 dialogueTitle(置於 dialogues 前)、刪除該行、後續 D id 遞補;其他位元不動", () => {
    const fix = fixLesson(RAW_T, [TITLE]);
    expect(fix.results.map((r) => r.status)).toEqual(["pending"]);
    expect(fix.text).toBe(FIXED_T);
    const l = JSON.parse(fix.text);
    expect(Object.keys(l)).toEqual([
      "id",
      "title",
      "vocab",
      "grammar",
      "dialogueTitle",
      "dialogues",
    ]);
    expect(Object.keys(l.dialogueTitle)).toEqual(["ruby", "translation"]);
    expect(l.dialogues.map((d: { speaker: string }) => d.speaker)).toEqual([
      "ワン",
      "カリナ",
    ]);
  });

  it("重跑 0 變動、逐位元相同,狀態為已套用", () => {
    const twice = fixLesson(FIXED_T, [TITLE]);
    expect(twice.text).toBe(FIXED_T);
    expect(twice.results.map((r) => r.status)).toEqual(["applied"]);
  });

  it("無 speaker(L23/L41 寫法)且單行 ruby 的標題:translation 原為最後一個屬性、ruby 單行帶逗號,逗號隨之調整", () => {
    const raw = RAW_T.replace(
      `      "ruby": [
        { "b": "手伝", "r": "てつだ" },
        { "b": "って くれますか" }
      ],
      "translation": "可以幫我嗎",
      "speaker": "標題"`,
      `      "ruby": [{ "b": "手伝", "r": "てつだ" }, { "b": "って くれますか" }],
      "translation": "可以幫我嗎"`,
    );
    const { speaker: _omit, ...from } = TITLE.from;
    void _omit;
    const fix = fixLesson(raw, [tc(from)]);
    expect(fix.text).toBe(
      FIXED_T.replace(
        `    "ruby": [
      { "b": "手伝", "r": "てつだ" },
      { "b": "って くれますか" }
    ],`,
        `    "ruby": [{ "b": "手伝", "r": "てつだ" }, { "b": "って くれますか" }],`,
      ),
    );
    expect(fixLesson(fix.text, [tc(from)]).text).toBe(fix.text);
  });

  it("同課 D 的欄位修正排在標題之後、以遞補後的 id 宣告:第一次與重跑都指向同一行", () => {
    const cs = [
      TITLE,
      fc({ id: "L01-D01", field: "translation", from: "呢", to: "啊" }),
    ];
    const fix = fixLesson(RAW_T, cs);
    expect(JSON.parse(fix.text).dialogues[0]).toMatchObject({
      speaker: "ワン",
      translation: "什麼事啊？",
    });
    const again = fixLesson(fix.text, cs);
    expect(again.text).toBe(fix.text);
    expect(again.results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("狀態:修正前 = 待套用、修正後 = 已套用;第一行不完全等於 from、已有標題但 D 未連號或仍含標題句即丟錯", () => {
    const before = JSON.parse(RAW_T);
    const after = JSON.parse(FIXED_T);
    expect(statusOf(before, TITLE)).toBe("pending");
    expect(statusOf(after, TITLE)).toBe("applied");
    // 第一行只差 speaker(資料已被改動):不猜
    expect(() =>
      fixLesson(RAW_T, [tc({ ...TITLE.from, speaker: "（標題）" })]),
    ).toThrow("既非修正前");
    expect(() =>
      fixLesson(RAW_T.replace("可以幫我嗎", "可以幫我嗎?"), [TITLE]),
    ).toThrow("既非修正前");
    // 已有 dialogueTitle,但 D 沒有自 01 連號
    const unnumbered = structuredClone(after);
    unnumbered.dialogues[0].id = "L01-D02";
    unnumbered.dialogues[1].id = "L01-D03";
    expect(() => statusOf(unnumbered, TITLE)).toThrow("既非修正前");
    // 已有 dialogueTitle,重新抽取又把標題放回第一行
    const readded = structuredClone(after);
    readded.dialogues = [
      { ...TITLE.from, id: "L01-D01" },
      ...after.dialogues.map((d: { id: string }, i: number) => ({
        ...d,
        id: `L01-D0${i + 2}`,
      })),
    ];
    expect(() => statusOf(readded, TITLE)).toThrow("既非修正前");
    // 已有 dialogueTitle 但內容不同
    const other = structuredClone(after);
    other.dialogueTitle.translation = "幫忙";
    expect(() => statusOf(other, TITLE)).toThrow("既非修正前");
  });

  it("前提不符即丟錯:会話只有標題一行", () => {
    const only = RAW_T.replace(
      /,\n    \{\n      "id": "L01-D02"[\s\S]*\n    \}\n  \]/,
      "\n  ]",
    );
    expect(JSON.parse(only).dialogues).toHaveLength(1);
    expect(() => fixLesson(only, [TITLE])).toThrow("会話只有這一行");
  });

  it("--check 與套用的標籤", () => {
    expect(summarize([fixLesson(RAW_T, [TITLE])], { check: true })).toEqual({
      lines: [
        "⏳ 待套用 L01 会話標題「手伝って くれますか」(原 L01-D01)→ dialogueTitle",
        "待套用 1/1 筆;執行 pnpm fix:content 套用",
      ],
      exitCode: 1,
    });
  });
});

describe("verifyWritten:寫入前核對", () => {
  const expected = () => JSON.parse(RAW);

  it("原文與預期模型相同即通過", () => {
    expect(() => verifyWritten("L01", RAW, expected())).not.toThrow();
  });

  it("值不同、key 順序不同、不符 LessonSchema、有會被丟棄的 key 各自丟錯", () => {
    expect(() =>
      verifyWritten("L01", RAW.replace("嗯，我看看", "嗯"), expected()),
    ).toThrow("L01:寫入核對失敗(文字修改與預期模型不符)");
    const swapped = RAW.replace(
      '"title": "はじめまして",\n  "vocab"',
      '"vocab"',
    ).replace('  "grammar": [', '  "title": "はじめまして",\n  "grammar": [');
    expect(JSON.parse(swapped)).toEqual(expected());
    expect(() => verifyWritten("L01", swapped, expected())).toThrow(
      "L01:寫入核對失敗(key 順序與預期模型不符)",
    );
    const bad = RAW.replace('"pos": "名"', '"pos": "名詞"');
    expect(() => verifyWritten("L01", bad, JSON.parse(bad))).toThrow(
      "L01:寫入核對失敗(不符 LessonSchema:vocab.1.pos:",
    );
    // 巢狀物件裡的未知 key 同樣會被 Zod 丟棄
    const extra = RAW.replace(
      '"translation": "拍照作為紀念。"',
      '"translation": "拍照作為紀念。",\n          "unknownKey": { "b": "x" }',
    );
    expect(() => verifyWritten("L01", extra, JSON.parse(extra))).toThrow(
      "L01:寫入核對失敗(有 LessonSchema 不認得、會被丟棄的 key)",
    );
  });
});

describe("validateCorrections", () => {
  it("合法的宣告回傳空陣列", () => {
    expect(validateCorrections(SIX)).toEqual([]);
  });

  it("id 格式與課號、欄位與 id 種類、from/to、子字串冪等、理由、重複", () => {
    expect(
      validateCorrections([
        fc({ id: "L1-V001", field: "kana", from: "a", to: "b" }),
        fc({ id: "L02-V001", field: "kana", from: "a", to: "b" }),
        fc({ id: "L01-G01", field: "translation", from: "a", to: "b" }),
        fc({ id: "L01-S01", field: "kana", from: "a", to: "b" }),
        fc({ id: "L01-V001", field: "ruby.01.b", from: "a", to: "b" }),
        fc({ id: "L01-V001", field: "pos", from: "名", to: "名" }),
        fc({ id: "L01-V001", field: "meaning", from: "", to: "b" }),
        fc({ id: "L01-D01", field: "translation", from: "辺", to: "渡辺呢" }),
        fc({ id: "L01-V002", field: "kana", from: "a", to: "b", reason: " " }),
        fc({ id: "L01-V002", field: "kana", from: "c", to: "d" }),
      ]),
    ).toEqual([
      "L1-V001 kana:id 格式不符",
      "L02-V001 kana:id 課號 ≠ lesson 1",
      "L01-G01 translation:G 沒有可修正的欄位 translation",
      "L01-S01 kana:S 沒有可修正的欄位 kana",
      "L01-V001 ruby.01.b:V 沒有可修正的欄位 ruby.01.b",
      "L01-V001 pos:from 與 to 相同",
      "L01-V001 meaning:from/to 不得為空",
      "L01-D01 translation:子字串修正的 to 含 from,重跑不冪等",
      "L01-V002 kana:缺 reason",
      "L01-V002 kana:重複宣告",
    ]);
  });

  it("同一欄位:子字串以 from 區分可有多筆,整值只能一筆", () => {
    expect(
      validateCorrections([
        fc({ id: "L01-D01", field: "translation", from: "渡辺", to: "渡邊" }),
        fc({ id: "L01-D01", field: "translation", from: "・", to: "·" }),
        fc({ id: "L01-D01", field: "translation", from: "渡辺", to: "渡部" }),
        fc({ id: "L01-V001", field: "ruby.0.b", from: "え―と", to: "えーと" }),
        fc({ id: "L01-V001", field: "ruby.0.b", from: "えと", to: "えーと" }),
      ]),
    ).toEqual(["L01-D01 translation:重複宣告", "L01-V001 ruby.0.b:重複宣告"]);
  });

  it("fixLesson 拒絕不合法的宣告", () => {
    expect(() =>
      fixLesson(RAW, [
        fc({ id: "L01-V001", field: "kana", from: "a", to: "a" }),
      ]),
    ).toThrow("from 與 to 相同");
  });
});

describe("validateCorrections:会話標題", () => {
  it("合法的宣告回傳空陣列(speaker 為標題標記或不寫 key)", () => {
    const { speaker: _omit, ...noSpeaker } = TITLE.from;
    void _omit;
    expect(
      validateCorrections(
        [
          TITLE,
          tc({ ...TITLE.from, speaker: "（標題）" }, { lesson: 2 }),
          tc(noSpeaker, { lesson: 3 }),
        ].map((c) => ({ ...c, from: { ...c.from, id: `L0${c.lesson}-D01` } })),
      ),
    ).toEqual([]);
  });

  it("id 須為同課 D01、ruby/translation 非空、speaker 為標題標記、理由、每課一筆", () => {
    expect(
      validateCorrections([
        tc({ ...TITLE.from, id: "L01-D02" }),
        tc({ ...TITLE.from, id: "L02-D01" }),
        tc(
          { ...TITLE.from, id: "L03-D01", ruby: [], translation: "" },
          { lesson: 3 },
        ),
        tc({ ...TITLE.from, id: "L04-D01", speaker: "ミラー" }, { lesson: 4 }),
        tc({ ...TITLE.from, id: "L05-D01", speaker: undefined }, { lesson: 5 }),
        tc({ ...TITLE.from, id: "L06-D01" }, { lesson: 6, reason: "" }),
        tc({ ...TITLE.from, id: "L06-D01" }, { lesson: 6 }),
      ]),
    ).toEqual([
      "L01-D02 会話標題:標題須為会話第一行 D01",
      "L02-D01 会話標題:id 課號 ≠ lesson 1",
      "L02-D01 会話標題:重複宣告", // 與第一筆同為第 1 課
      "L03-D01 会話標題:ruby/translation 不得為空",
      'L04-D01 会話標題:speaker "ミラー" 不是標題標記(應為「標題」「（標題）」或不寫 key)',
      "L05-D01 会話標題:speaker undefined 不是標題標記(應為「標題」「（標題）」或不寫 key)",
      "L06-D01 会話標題:缺 reason",
      "L06-D01 会話標題:重複宣告",
    ]);
  });

  it("同課 D 的欄位修正須排在標題修正之後(id 以遞補後為準);他課或 S 不受限", () => {
    const d = fc({ id: "L01-D01", field: "translation", from: "呢", to: "啊" });
    expect(validateCorrections([TITLE, d])).toEqual([]);
    expect(validateCorrections([d, TITLE])).toEqual([
      "L01-D01 translation:排在同課的会話標題修正之前(標題修正會遞補 D id,D 的欄位修正須排在其後、id 以遞補後為準)",
    ]);
    expect(
      validateCorrections([
        fc({ id: "L01-S01", field: "translation", from: "呢", to: "啊" }),
        fc({
          lesson: 2,
          id: "L02-D01",
          field: "translation",
          from: "呢",
          to: "啊",
        }),
        TITLE,
      ]),
    ).toEqual([]);
    // 宣告錯誤時 fixLesson 拒絕
    expect(() => fixLesson(RAW_T, [d, TITLE])).toThrow(
      "排在同課的会話標題修正之前",
    );
  });
});

/**
 * 合成課程檔:furigana 跨越記號與送り仮名的 ruby 段。單字為單行 ruby(其後有逗號);例句為
 * 逐段換行,目標段在中間(S01)與最後一段(S02,無逗號);会話為單行 ruby 且是物件最後一個屬性(無逗號)
 */
const RAW_R = `{
  "id": 1,
  "title": "はじめまして",
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "〜語", "r": "ご" }],
      "kana": "ご",
      "accent": 1,
      "meaning": "〜語",
      "pos": "其他",
      "note": "接尾"
    },
    {
      "id": "L01-V002",
      "ruby": [{ "b": "違います。", "r": "ちがいます" }],
      "kana": "ちがいます",
      "meaning": "不對。/不是。",
      "pos": "慣用"
    }
  ],
  "grammar": [
    {
      "id": "L01-G01",
      "pattern": "数量詞",
      "explanation": "表示數量。",
      "examples": [
        {
          "id": "L01-S01",
          "ruby": [
            { "b": "ミラーさんは " },
            { "b": "「来週", "r": "らいしゅう" },
            { "b": " " },
            { "b": "行", "r": "い" },
            { "b": "きます」と " }
          ],
          "translation": "米勒先生說：「下週去」"
        },
        {
          "id": "L01-S02",
          "ruby": [
            { "b": "つ " },
            { "b": "…8", "r": "やっ" }
          ],
          "translation": "…8 個。"
        }
      ]
    }
  ],
  "dialogues": [
    {
      "id": "L01-D01",
      "translation": "不對。",
      "speaker": "ミラー",
      "ruby": [{ "b": "いいえ、" }, { "b": "違います。", "r": "ちがいます" }]
    }
  ]
}
`;

/** RAW_R 修正後:只有目標 ruby 屬性的行改變,各自沿用原排版;逐段換行者多一行 */
const FIXED_R = RAW_R.replace(
  `"ruby": [{ "b": "〜語", "r": "ご" }],`,
  `"ruby": [{ "b": "〜" }, { "b": "語", "r": "ご" }],`,
)
  .replace(
    `"ruby": [{ "b": "違います。", "r": "ちがいます" }],`,
    `"ruby": [{ "b": "違", "r": "ちが" }, { "b": "います。" }],`,
  )
  .replace(
    `            { "b": "「来週", "r": "らいしゅう" },\n`,
    `            { "b": "「" },\n            { "b": "来週", "r": "らいしゅう" },\n`,
  )
  .replace(
    `            { "b": "…8", "r": "やっ" }\n`,
    `            { "b": "…" },\n            { "b": "8", "r": "やっ" }\n`,
  )
  .replace(
    `"ruby": [{ "b": "いいえ、" }, { "b": "違います。", "r": "ちがいます" }]\n`,
    `"ruby": [{ "b": "いいえ、" }, { "b": "違", "r": "ちが" }, { "b": "います。" }]\n`,
  );

const rs = (
  c: Pick<RubySplitCorrection, "id" | "field" | "from" | "to"> &
    Partial<RubySplitCorrection>,
): RubySplitCorrection => ({
  kind: "rubySplit",
  lesson: 1,
  reason: "測試",
  ...c,
});

const SPLITS = [
  rs({
    id: "L01-V001",
    field: "ruby.0",
    from: { b: "〜語", r: "ご" },
    to: [{ b: "〜" }, { b: "語", r: "ご" }],
  }),
  rs({
    id: "L01-V002",
    field: "ruby.0",
    from: { b: "違います。", r: "ちがいます" },
    to: [{ b: "違", r: "ちが" }, { b: "います。" }],
  }),
  rs({
    id: "L01-S01",
    field: "ruby.1",
    from: { b: "「来週", r: "らいしゅう" },
    to: [{ b: "「" }, { b: "来週", r: "らいしゅう" }],
  }),
  rs({
    id: "L01-S02",
    field: "ruby.1",
    from: { b: "…8", r: "やっ" },
    to: [{ b: "…" }, { b: "8", r: "やっ" }],
  }),
  rs({
    id: "L01-D01",
    field: "ruby.1",
    from: { b: "違います。", r: "ちがいます" },
    to: [{ b: "違", r: "ちが" }, { b: "います。" }],
  }),
];

describe("fixLesson:ruby 分段", () => {
  it("一段換成多段:沿用單行/逐段換行排版與其後的逗號,其他位元不動", () => {
    // 逐段換行的兩句各多一行
    expect(FIXED_R.split("\n").length - RAW_R.split("\n").length).toBe(2);
    const fix = fixLesson(RAW_R, SPLITS);
    expect(fix.results.map((r) => r.status)).toEqual(Array(5).fill("pending"));
    expect(fix.text).toBe(FIXED_R);
  });

  it("重跑 0 變動、逐位元相同,狀態皆為已套用", () => {
    const twice = fixLesson(FIXED_R, SPLITS);
    expect(twice.text).toBe(FIXED_R);
    expect(twice.results.map((r) => r.status)).toEqual(
      Array(5).fill("applied"),
    );
  });

  it("串接的 b 與讀音(只取假名)不變;key 順序不變(含段內的 b、r)", () => {
    const before = parseLesson(RAW_R);
    const after = parseLesson(fixLesson(RAW_R, SPLITS).text);
    const items = (l: typeof before) => [
      ...l.vocab,
      ...l.grammar.flatMap((g) => g.examples),
      ...l.dialogues,
    ];
    const reading = (ruby: RubySeg[]) =>
      ruby.map((s) => s.r ?? s.b.replace(/[^ぁ-ゖァ-ヺー]/g, "")).join("");
    items(after).forEach((it, k) => {
      const orig = items(before)[k];
      expect(it.ruby.map((s) => s.b).join(""), it.id).toBe(
        orig.ruby.map((s) => s.b).join(""),
      );
      expect(reading(it.ruby), it.id).toBe(reading(orig.ruby));
      expect(Object.keys(it), it.id).toEqual(Object.keys(orig));
      for (const seg of it.ruby) {
        expect(Object.keys(seg)).toEqual(
          seg.r === undefined ? ["b"] : ["b", "r"],
        );
      }
    });
    // 宣告的段 key 順序不同(r 在前)時,寫入仍依課程檔的 b、r 順序
    const reversed = rs({
      ...SPLITS[0],
      to: [{ b: "〜" }, { r: "ご", b: "語" }],
    });
    expect(fixLesson(RAW_R, [reversed]).text).toBe(
      fixLesson(RAW_R, [SPLITS[0]]).text,
    );
  });

  it("狀態:第 i 段 = from 待套用、自第 i 段起 = to 已套用;其他丟錯(不猜)", () => {
    const before = parseLesson(RAW_R);
    const after = parseLesson(FIXED_R);
    expect(statusOf(before, SPLITS[2])).toBe("pending");
    expect(statusOf(after, SPLITS[2])).toBe("applied");
    // 讀音已被改動
    expect(() =>
      fixLesson(RAW_R.replace('"r": "らいしゅう"', '"r": "こんしゅう"'), [
        SPLITS[2],
      ]),
    ).toThrow(
      "L01-S01 ruby.1 {「来週/らいしゅう} → {「}{来週/らいしゅう}:第 1 段起既非 from 也非 to,拒絕修改;現值 {ミラーさんは }{「来週/こんしゅう}{ }{行/い}{きます」と }",
    );
    // 段號不符、超出範圍
    expect(() => fixLesson(RAW_R, [{ ...SPLITS[2], field: "ruby.0" }])).toThrow(
      "第 0 段起既非 from 也非 to",
    );
    expect(() => fixLesson(RAW_R, [{ ...SPLITS[2], field: "ruby.9" }])).toThrow(
      "第 9 段起既非 from 也非 to",
    );
    // 物件不存在
    expect(() => fixLesson(RAW_R, [{ ...SPLITS[2], id: "L01-S09" }])).toThrow(
      "L01-S09:課程中有 0 個物件",
    );
  });

  it("原文的 ruby 排版既非單行也非逐段換行(或與資料不符)即丟錯", () => {
    const packed = RAW_R.replace(
      `            { "b": "ミラーさんは " },\n            { "b": "「来週", "r": "らいしゅう" },`,
      `            { "b": "ミラーさんは " }, { "b": "「来週", "r": "らいしゅう" },`,
    );
    expect(JSON.parse(packed)).toEqual(JSON.parse(RAW_R));
    expect(() => fixLesson(packed, [SPLITS[2]])).toThrow(
      "L01-S01:ruby 原文與資料不符,或排版既非單行也非逐段換行,拒絕修改",
    );
    const spaced = RAW_R.replace(
      `[{ "b": "〜語", "r": "ご" }]`,
      `[{"b": "〜語", "r": "ご"}]`,
    );
    expect(() => fixLesson(spaced, [SPLITS[0]])).toThrow(
      "L01-V001:ruby 原文與資料不符",
    );
  });

  it("同課 D 的分段排在会話標題之後、以遞補後的 id 宣告:第一次與重跑都指向同一行", () => {
    // RAW_T 的 D02「何ですか。」遞補為 D01
    const split = rs({
      id: "L01-D01",
      field: "ruby.1",
      from: { b: "ですか。" },
      to: [{ b: "です" }, { b: "か。" }],
    });
    const cs = [TITLE, split];
    const fix = fixLesson(RAW_T, cs);
    expect(JSON.parse(fix.text).dialogues[0]).toMatchObject({
      speaker: "ワン",
      ruby: [{ b: "何", r: "なん" }, { b: "です" }, { b: "か。" }],
    });
    const again = fixLesson(fix.text, cs);
    expect(again.text).toBe(fix.text);
    expect(again.results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("--check 的標籤", () => {
    expect(
      summarize([fixLesson(RAW_R, SPLITS.slice(1, 2))], { check: true }),
    ).toEqual({
      lines: [
        "⏳ 待套用 L01-V002 ruby.0 {違います。/ちがいます} → {違/ちが}{います。}",
        "待套用 1/1 筆;執行 pnpm fix:content 套用",
      ],
      exitCode: 1,
    });
  });
});

describe("validateCorrections:ruby 分段", () => {
  it("合法的宣告回傳空陣列(記號〜…「與句號不算讀音)", () => {
    expect(validateCorrections(SPLITS)).toEqual([]);
  });

  it("串接的 b 須不變、讀音(只取假名)須不變,否則為宣告錯誤,fixLesson 拒絕", () => {
    const base = SPLITS[1]; // {違います。/ちがいます}
    const bad = [
      // b 少了句號
      rs({ ...base, to: [{ b: "違", r: "ちが" }, { b: "います" }] }),
      // 讀音多了假名:ちがい + います
      rs({
        ...base,
        id: "L01-V003",
        to: [{ b: "違", r: "ちがい" }, { b: "います。" }],
      }),
      // 送り仮名的い被 r 蓋掉(ちが + ます)
      rs({
        ...base,
        id: "L01-V004",
        to: [
          { b: "違", r: "ちが" },
          { b: "います。", r: "ます" },
        ],
      }),
    ];
    expect(validateCorrections(bad)).toEqual([
      "L01-V002 ruby.0:to 串接的 b「違います」≠ from「違います。」",
      "L01-V003 ruby.0:to 的讀音(只取假名)「ちがいいます」≠ from「ちがいます」",
      "L01-V004 ruby.0:to 的讀音(只取假名)「ちがます」≠ from「ちがいます」",
      "L01-V004 ruby.0:to 的「います。」帶 r 卻含漢字、數字以外的字(furigana 不跨越記號與送り仮名)",
    ]);
    expect(() => fixLesson(RAW_R, bad.slice(0, 1))).toThrow(
      "to 串接的 b「違います」≠ from「違います。」",
    );
  });

  it("分段結果須合 content-lint 的 ruby 規則:讀音移到記號上、假名段帶 r 即使串接與讀音不變也擋下", () => {
    expect(
      validateCorrections([
        // ご 移到〜上、語 沒有 r(ruby-r-scope、ruby-han-has-r)
        rs({
          ...SPLITS[0],
          to: [{ b: "〜", r: "ご" }, { b: "語" }],
        }),
        // 純假名段加上 r(ruby-r-scope)
        rs({
          id: "L01-V002",
          field: "ruby.0",
          from: { b: "ちがいます" },
          to: [{ b: "ちが", r: "ちが" }, { b: "います" }],
        }),
      ]),
    ).toEqual([
      "L01-V001 ruby.0:to 的「〜」帶 r 卻含漢字、數字以外的字(furigana 不跨越記號與送り仮名)",
      "L01-V001 ruby.0:to 的「語」含漢字卻沒有 r",
      "L01-V002 ruby.0:to 的「ちが」帶 r 卻含漢字、數字以外的字(furigana 不跨越記號與送り仮名)",
    ]);
  });

  it("id 與課號、欄位格式、段數與空值、理由、重複", () => {
    const ok = SPLITS[0];
    expect(
      validateCorrections([
        rs({ ...ok, id: "L1-V001" }),
        rs({ ...ok, id: "L02-V001" }),
        rs({ ...ok, id: "L01-G01" }),
        // 以 as 繞過型別的欄位(如 ruby.0.b)由宣告檢查擋下
        rs({ ...ok, id: "L01-V003", field: "ruby.0.b" as `ruby.${number}` }),
        rs({ ...ok, id: "L01-V004", field: "ruby.01" }),
        rs({ ...ok, id: "L01-V005", to: [{ b: "〜語", r: "ご" }] }),
        rs({
          ...ok,
          id: "L01-V006",
          to: [{ b: "" }, { b: "〜" }, { b: "語", r: "ご" }],
        }),
        rs({
          ...ok,
          id: "L01-V007",
          to: [
            { b: "〜", r: "" },
            { b: "語", r: "ご" },
          ],
        }),
        rs({ ...ok, id: "L01-V008", reason: " " }),
        rs({ ...ok, id: "L01-V008" }),
      ]),
    ).toEqual([
      "L1-V001 ruby.0:id 格式不符",
      "L02-V001 ruby.0:id 課號 ≠ lesson 1",
      "L01-G01 ruby.0:G 沒有 ruby",
      "L01-V003 ruby.0.b:欄位應為 ruby.<i>",
      "L01-V004 ruby.01:欄位應為 ruby.<i>",
      "L01-V005 ruby.0:to 至少兩段",
      "L01-V005 ruby.0:to 的「〜語」帶 r 卻含漢字、數字以外的字(furigana 不跨越記號與送り仮名)",
      "L01-V006 ruby.0:段的 b、r 不得為空",
      "L01-V007 ruby.0:段的 b、r 不得為空",
      "L01-V008 ruby.0:缺 reason",
      "L01-V008 ruby.0:重複宣告",
    ]);
  });

  it("有分段的項目,ruby 不得再有其他修正(段號位移);他項目的 ruby.<i>.b 不受限", () => {
    const split = SPLITS[4]; // L01-D01 ruby.1
    const other = rs({
      id: "L01-D01",
      field: "ruby.0",
      from: { b: "いいえ、" },
      to: [{ b: "いいえ" }, { b: "、" }],
    });
    const b = fc({
      id: "L01-D01",
      field: "ruby.0.b",
      from: "いいえ、",
      to: "いや、",
    });
    const conflict =
      "ruby 另有修正(分段使其後的段號位移,有分段的項目 ruby 只能有這一筆修正)";
    expect(validateCorrections([split, other])).toEqual([
      `L01-D01 ruby.1:同一項目的 ${conflict}`,
      `L01-D01 ruby.0:同一項目的 ${conflict}`,
    ]);
    expect(validateCorrections([b, split])).toEqual([
      `L01-D01 ruby.1:同一項目的 ${conflict}`,
    ]);
    expect(
      validateCorrections([
        split,
        fc({ id: "L01-V001", field: "ruby.0.b", from: "〜語", to: "〜語。" }),
        fc({ id: "L01-D01", field: "translation", from: "不對", to: "不是" }),
      ]),
    ).toEqual([]);
  });

  it("同課 D 的分段須排在会話標題修正之後", () => {
    const split = rs({
      id: "L01-D01",
      field: "ruby.1",
      from: { b: "ですか。" },
      to: [{ b: "です" }, { b: "か。" }],
    });
    expect(validateCorrections([split, TITLE])).toEqual([
      "L01-D01 ruby.1:排在同課的会話標題修正之前(標題修正會遞補 D id,D 的欄位修正須排在其後、id 以遞補後為準)",
    ]);
  });
});

describe("--check 判定", () => {
  it("parseArgs:--check;略過 pnpm 轉傳的 --;其他參數報錯", () => {
    expect(parseArgs([])).toEqual({ check: false });
    expect(parseArgs(["--check"])).toEqual({ check: true });
    expect(parseArgs(["--", "--check"])).toEqual({ check: true });
    expect(parseArgs(["--dry-run"])).toEqual({
      error: "不認得的參數「--dry-run」;用法:pnpm fix:content [--check]",
    });
  });

  it("--check:逐筆列狀態,有待套用項 exit 1", () => {
    const pending = fixLesson(RAW, SIX.slice(0, 2));
    expect(summarize([pending], { check: true })).toEqual({
      lines: [
        "⏳ 待套用 L01-V001 ruby.0.b「え―と」→「えーと」",
        "⏳ 待套用 L01-V001 kana「え―と」→「えーと」",
        "待套用 2/2 筆;執行 pnpm fix:content 套用",
      ],
      exitCode: 1,
    });
  });

  it("--check:全部已套用 exit 0", () => {
    const done = fixLesson(fixLesson(RAW, SIX).text, SIX.slice(0, 1));
    expect(summarize([done], { check: true })).toEqual({
      lines: [
        "✓ 已套用 L01-V001 ruby.0.b「え―と」→「えーと」",
        "全部 1 筆修正皆已套用,沒有變動",
      ],
      exitCode: 0,
    });
  });

  it("套用模式:列出本次套用的各筆與理由,exit 0", () => {
    const applied = fixLesson(fixLesson(RAW, SIX.slice(0, 1)).text, SIX);
    const { lines, exitCode } = summarize([applied], { check: false });
    expect(exitCode).toBe(0);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("✓ 套用 L01-V001 kana「え―と」→「えーと」:測試");
    expect(lines.at(-1)).toBe("套用 5 筆、寫入 1 個檔;其餘 1 筆先前已套用");
    expect(
      summarize([fixLesson(RAW, SIX)], { check: false }).lines.at(-1),
    ).toBe("套用 6 筆、寫入 1 個檔");
  });

  it("套用模式:沒有待套用項時全文不變、exit 0", () => {
    const once = fixLesson(RAW, SIX).text;
    const done = fixLesson(once, SIX);
    expect(done.text).toBe(once);
    expect(summarize([done], { check: false })).toEqual({
      lines: ["全部 6 筆修正皆已套用,沒有變動"],
      exitCode: 0,
    });
  });
});
