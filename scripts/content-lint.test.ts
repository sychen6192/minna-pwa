import { describe, expect, it } from "vitest";
import type {
  GrammarPoint,
  Lesson,
  RubySeg,
  Sentence,
  VocabItem,
} from "../src/schemas/lesson";
import {
  big5Charset,
  formatReport,
  JA_GLYPH_BLACKLIST,
  lintContent,
  parseReportArgs,
  PENDING_FIXES,
  punctuationSummary,
  RULES,
  stripQuotedJapanese,
  type LintContext,
  type LintIssue,
} from "./content-lint";

const big5 = big5Charset();
const pad2 = (n: number) => String(n).padStart(2, "0");

/** 最小的合法課程:1 字、1 個文法點(1 句例句)、1 行会話;全部規則 0 筆 */
function lesson(id: number): Lesson {
  const L = `L${pad2(id)}`;
  return {
    id,
    title: `第${id}課`,
    vocab: [
      {
        id: `${L}-V001`,
        ruby: [{ b: "本", r: "ほん" }],
        kana: "ほん",
        meaning: `書(${id})`,
        pos: "名",
      },
    ],
    grammar: [
      {
        id: `${L}-G01`,
        pattern: "N です",
        explanation: "表示斷定。",
        examples: [
          {
            id: `${L}-S01`,
            ruby: [{ b: "本", r: "ほん" }, { b: "です。" }],
            translation: "是書。",
          },
        ],
      },
    ],
    dialogues: [
      {
        id: `${L}-D01`,
        speaker: "ミラー",
        ruby: [{ b: "はい。" }],
        translation: "是的。",
      },
    ],
  };
}

const fifty = () => Array.from({ length: 50 }, (_, i) => lesson(i + 1));

function ctxOf(
  lessons: Lesson[],
  over: Partial<LintContext> = {},
): LintContext {
  return {
    lessons,
    files: lessons.map((l) => `L${pad2(l.id)}.json`),
    index: {
      lessons: lessons.map((l) => ({
        id: l.id,
        title: l.title,
        vocabCount: l.vocab.length,
        grammarCount: l.grammar.length,
      })),
    },
    big5,
    ...over,
  };
}

/** 第 1 課,單字依序編為 V001… */
function withVocab(...items: Partial<VocabItem>[]): Lesson {
  const l = lesson(1);
  l.vocab = items.map((v, i) => ({
    ...l.vocab[0],
    id: `L01-V${String(i + 1).padStart(3, "0")}`,
    ...v,
  }));
  return l;
}
/** 第 1 課,例句依序編為 S01…(全在 G01) */
function withExamples(...items: Partial<Sentence>[]): Lesson {
  const l = lesson(1);
  const base = l.grammar[0].examples[0];
  l.grammar[0].examples = items.map((s, i) => ({
    ...base,
    id: `L01-S${pad2(i + 1)}`,
    ...s,
  }));
  return l;
}
/** 第 1 課,会話依序編為 D01… */
function withDialogues(...items: Partial<Sentence>[]): Lesson {
  const l = lesson(1);
  l.dialogues = items.map((d, i) => ({
    ...l.dialogues[0],
    id: `L01-D${pad2(i + 1)}`,
    ...d,
  }));
  return l;
}
function withGrammar(...items: Partial<GrammarPoint>[]): Lesson {
  const l = lesson(1);
  l.grammar = items.map((g, i) => ({
    ...l.grammar[0],
    id: `L01-G${pad2(i + 1)}`,
    ...g,
  }));
  return l;
}

function issues(ruleId: string, ctx: LintContext): LintIssue[] {
  const rule = RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`沒有規則 ${ruleId}`);
  return rule.check(ctx);
}
/** 對指定課程執行一條規則,回傳命中的 id */
const ids = (ruleId: string, ...lessons: Lesson[]) =>
  issues(ruleId, ctxOf(lessons)).map((i) => i.id);
const messages = (ruleId: string, ...lessons: Lesson[]) =>
  issues(ruleId, ctxOf(lessons)).map((i) => `${i.id} ${i.message}`);

const seg = (b: string, r?: string): RubySeg =>
  r === undefined ? { b } : { b, r };

describe("RULES", () => {
  it("error 15 條、warning 10 條(T12.5 把 ruby-r-scope 升為 error、T12.6 加 zh-punct)", () => {
    const of = (s: string) =>
      RULES.filter((r) => r.severity === s).map((r) => r.id);
    expect(of("error")).toEqual([
      "lesson-set",
      "index-match",
      "id-format",
      "id-unique",
      "id-sequence",
      "ruby-han-has-r",
      "ruby-r-hiragana",
      "ruby-r-target",
      "text-hygiene",
      "ja-lookalike-dash",
      "kana-no-han-latin",
      "verb-class-shape",
      "adjective-shape",
      "dialogue-speaker",
      "zh-glyph",
    ]);
    expect(of("warning")).toEqual([
      "kana-symbols",
      "kana-vs-ruby",
      "ruby-r-scope",
      "verb-not-masu",
      "na-adjective-marker",
      "cross-lesson-duplicate",
      "pos-inconsistent",
      "sentence-id-order",
      "speaker-alias",
      "zh-lookalike",
    ]);
  });

  it("50 課基準資料:全部規則 0 筆", () => {
    const result = lintContent(ctxOf(fifty()), { pending: {} });
    expect(result.rules.flatMap((r) => r.issues)).toEqual([]);
    expect([
      result.errorCount,
      result.pendingCount,
      result.warningCount,
    ]).toEqual([0, 0, 0]);
  });
});

describe("error:課與 id", () => {
  it("lesson-set:1–50 依序、檔名 = 課號", () => {
    expect(ids("lesson-set", ...fifty())).toEqual([]);
    expect(ids("lesson-set", ...fifty().slice(0, 49))).toEqual(["lessons"]);
    const swapped = fifty();
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(ids("lesson-set", ...swapped)).toEqual(["L03", "L02"]);
    const files = fifty().map((l) => `L${pad2(l.id)}.json`);
    files[4] = "L5.json";
    expect(
      issues("lesson-set", ctxOf(fifty(), { files })).map((i) => i.id),
    ).toEqual(["L5.json"]);
    // 檔名與課程數不一致(課程檔 parse 失敗時 validate:content 已先 exit)
    expect(
      issues(
        "lesson-set",
        ctxOf(fifty(), { files: ctxOf(fifty()).files.slice(0, 49) }),
      ).map((i) => i.id),
    ).toEqual(["files"]);
  });

  it("index-match:index.json 的 title / vocabCount / grammarCount = 課程檔、依課號排列", () => {
    expect(ids("index-match", ...fifty())).toEqual([]);
    const ctx = ctxOf(fifty());
    ctx.index.lessons[0].title = "別的課名";
    ctx.index.lessons[1].vocabCount = 99;
    ctx.index.lessons[2].grammarCount = 0;
    ctx.index.lessons[3].id = 99; // 順序錯、也找不到課程檔
    expect(
      issues("index-match", ctx).map((i) => `${i.id} ${i.message}`),
    ).toEqual([
      "index:L01 title「別的課名」≠ 課程檔「第1課」",
      "index:L02 vocabCount 99 ≠ 課程檔 1",
      "index:L03 grammarCount 0 ≠ 課程檔 1",
      "index:L99 第 4 筆的課號為 99",
      "index:L99 找不到對應的課程檔",
    ]);
  });

  it("id-format:S、D 也要符合格式(Zod 只檢查 V、G),前綴 = 所在課", () => {
    expect(ids("id-format", lesson(1), lesson(37))).toEqual([]);
    expect(ids("id-format", withExamples({ id: "L01-S00" }))).toEqual([]); // L37 從 S00 起
    expect(ids("id-format", withExamples({ id: "L01-S1" }))).toEqual([
      "L01-S1",
    ]);
    expect(ids("id-format", withDialogues({ id: "L01-D001" }))).toEqual([
      "L01-D001",
    ]);
    expect(ids("id-format", withDialogues({ id: "1-D01" }))).toEqual(["1-D01"]);
    expect(ids("id-format", withVocab({ id: "L02-V001" }))).toEqual([
      "L02-V001",
    ]);
    expect(ids("id-format", withGrammar({ id: "L01-G1" }))).toEqual(["L01-G1"]);
  });

  it("id-unique:V/G/S/D 全域唯一", () => {
    expect(ids("id-unique", lesson(1), lesson(2))).toEqual([]);
    expect(
      ids("id-unique", withExamples({ id: "L01-S01" }, { id: "L01-S01" })),
    ).toEqual(["L01-S01"]);
    const dup = lesson(2);
    dup.dialogues[0].id = "L01-D01";
    expect(ids("id-unique", lesson(1), dup)).toEqual(["L01-D01"]);
  });

  it("id-sequence:V、G、D 自 01 連號;S 不要求", () => {
    expect(
      ids(
        "id-sequence",
        withExamples({ id: "L01-S01" }, { id: "L01-S03" }, { id: "L01-S02" }),
      ),
    ).toEqual([]);
    expect(messages("id-sequence", withVocab({}, { id: "L01-V003" }))).toEqual([
      "L01-V003 應為 L01-V002",
    ]);
    expect(ids("id-sequence", withDialogues({ id: "L01-D02" }))).toEqual([
      "L01-D02",
    ]);
    expect(ids("id-sequence", withGrammar({ id: "L01-G02" }))).toEqual([
      "L01-G02",
    ]);
  });
});

describe("error:ruby", () => {
  it("ruby-han-has-r:含漢字的段(單字、例句、会話)必有 r", () => {
    expect(ids("ruby-han-has-r", lesson(1))).toEqual([]);
    expect(ids("ruby-han-has-r", withVocab({ ruby: [seg("本")] }))).toEqual([
      "L01-V001",
    ]);
    expect(
      ids("ruby-han-has-r", withExamples({ ruby: [seg("本"), seg("です")] })),
    ).toEqual(["L01-S01"]);
    expect(
      ids(
        "ruby-han-has-r",
        withDialogues({ ruby: [seg("行"), seg("きます")] }),
      ),
    ).toEqual(["L01-D01"]);
  });

  it("ruby-r-hiragana:r 只含平假名", () => {
    expect(
      ids("ruby-r-hiragana", withVocab({ ruby: [seg("本", "ほん")] })),
    ).toEqual([]);
    expect(
      ids("ruby-r-hiragana", withVocab({ ruby: [seg("本", "ホン")] })),
    ).toEqual(["L01-V001"]);
    expect(
      ids("ruby-r-hiragana", withExamples({ ruby: [seg("本", "ほーん")] })),
    ).toEqual(["L01-S01"]);
  });

  it("ruby-r-target:帶 r 的段須含漢字或數字", () => {
    expect(
      ids(
        "ruby-r-target",
        withVocab(
          { ruby: [seg("1", "ひと"), seg("つ")] },
          { ruby: [seg("２", "ふつ"), seg("か")] },
        ),
      ),
    ).toEqual([]);
    expect(
      ids("ruby-r-target", withVocab({ ruby: [seg("です", "です")] })),
    ).toEqual(["L01-V001"]);
    expect(
      ids("ruby-r-target", withDialogues({ ruby: [seg("〜", "から")] })),
    ).toEqual(["L01-D01"]);
  });
});

describe("error:字元", () => {
  it('text-hygiene:{b:" "} 分隔段合法(檢查串接後的表面)', () => {
    const sep = [seg("本", "ほん"), seg(" "), seg("です。")];
    expect(
      ids(
        "text-hygiene",
        withExamples({ ruby: sep }),
        withVocab({ ruby: sep }),
      ),
    ).toEqual([]);
    expect(
      ids(
        "text-hygiene",
        withDialogues({ ruby: [seg("はい"), seg(" "), seg("、そうです。")] }),
      ),
    ).toEqual([]);
  });

  it("text-hygiene:首尾/連續空白、全形空白、NBSP、tab、換行、零寬字元、半形片假名", () => {
    expect(
      messages(
        "text-hygiene",
        withVocab(
          { meaning: "書 " },
          { ruby: [seg(" "), seg("本", "ほん")] },
          { ruby: [seg("本", "ほん"), seg(" "), seg(" "), seg("です")] },
          { kana: "ﾎﾝ" },
          { note: "\u00a0補充" },
        ),
        withExamples(
          { translation: "是\u3000書。" },
          { translation: "是書。\n" },
        ),
        withGrammar({ explanation: "表示\t斷定。" }),
        withDialogues({ speaker: "ミラー\u200b" }),
      ),
    ).toEqual([
      "L01-V001 meaning:首尾空白",
      "L01-V002 surface:首尾空白",
      "L01-V003 surface:連續空白",
      "L01-V004 kana:半形片假名",
      "L01-V005 note:首尾空白、空白/控制字元 U+00A0",
      "L01-S01 translation:空白/控制字元 U+3000",
      "L01-S02 translation:首尾空白、空白/控制字元 U+000A",
      "L01-G01 explanation:空白/控制字元 U+0009",
      "L01-D01 speaker:空白/控制字元 U+200B",
    ]);
  });

  it("ja-lookalike-dash:日文欄位的ー/〜近似字(ruby 與 kana 各算一筆)", () => {
    expect(
      messages(
        "ja-lookalike-dash",
        withVocab({ ruby: [seg("え―と")], kana: "え―と" }),
      ),
    ).toEqual(["L01-V001 ruby「え―と」U+2015", "L01-V001 kana「え―と」U+2015"]);
    expect(
      ids(
        "ja-lookalike-dash",
        withGrammar({ pattern: "N は ～です" }),
        withDialogues({ speaker: "ミラ－" }),
        withVocab({ note: "〔～を〕" }),
        { ...lesson(2), title: "ど―ぞ" },
      ),
    ).toEqual(["L01-G01", "L01-D01", "L01-V001", "L02"]);
    // 正確的ー、〜;中文欄位的～不在此規則(見 warning zh-lookalike)
    expect(
      ids(
        "ja-lookalike-dash",
        withVocab({ ruby: [seg("えーと")], kana: "えーと", meaning: "嗯～" }),
        withGrammar({ pattern: "N は 〜です", explanation: "「～だ」" }),
      ),
    ).toEqual([]);
  });

  it("kana-no-han-latin:kana 不含漢字、英數字、空白;記號留給 warning", () => {
    expect(
      ids(
        "kana-no-han-latin",
        withVocab({ kana: "すき［な］" }, { kana: "コーヒー" }),
      ),
    ).toEqual([]);
    expect(
      ids(
        "kana-no-han-latin",
        withVocab(
          { kana: "本" },
          { kana: "CD" },
          { kana: "２かい" },
          { kana: "ほ ん" },
        ),
      ),
    ).toEqual(["L01-V001", "L01-V002", "L01-V003", "L01-V004"]);
  });
});

describe("error:詞性形狀", () => {
  const verb = (
    pos: VocabItem["pos"],
    kana: string,
    ruby: RubySeg[] = [seg(kana)],
  ) => ({
    pos,
    kana,
    ruby,
  });

  it("verb-class-shape:合法形狀不報(借ります 這類 い段 動II 無法以形狀判斷)", () => {
    expect(
      ids(
        "verb-class-shape",
        withVocab(
          verb("動I", "かきます"),
          verb("動I", "かります"),
          verb("動II", "かります"),
          verb("動II", "たべます"),
          verb("動II", "みます"),
          verb("動III", "べんきょうします"),
          verb("動III", "きます", [seg("来", "き"), seg("ます")]),
          verb("動III", "きます"),
          verb("動III", "もってきます", [
            seg("持", "も"),
            seg("って"),
            seg(" "),
            seg("来", "き"),
            seg("ます"),
          ]),
          verb("動II", "はなれた"), // 非ます形:見 warning verb-not-masu
          verb("慣用", "おねがいします"),
        ),
      ),
    ).toEqual([]);
  });

  it("verb-class-shape:ます前的段不符、動III 不是します也不是来ます、末詞します/来ます 不是動III", () => {
    expect(
      messages(
        "verb-class-shape",
        withVocab(
          verb("動I", "たべます"),
          verb("動II", "たべるます"),
          verb("動III", "たべます"),
          { ...verb("動I", "します"), meaning: "有(聲音)" },
          verb("動II", "もってきます", [
            seg("持", "も"),
            seg("って"),
            seg(" "),
            seg("来", "き"),
            seg("ます"),
          ]),
          // 〜きます的動III只有来ます與其複合:働きます 標成動III 要抓到
          verb("動III", "はたらきます", [seg("働", "はたら"), seg("きます")]),
          verb("動I", "ます"),
        ),
      ),
    ).toEqual([
      "L01-V001 動I「たべます」ます前非い段",
      "L01-V002 動II「たべるます」ます前非い/え段",
      "L01-V003 動III「たべます」不是します,末詞也不是来ます",
      "L01-V004 動I「します」末詞為します,應為動III",
      "L01-V005 動II「持って 来ます」末詞為来ます,應為動III",
      "L01-V006 動III「働きます」不是します,末詞也不是来ます",
      "L01-V007 動I「ます」ます前沒有字",
    ]);
  });

  it("adjective-shape:い形 kana 以い結尾;含［な］〔な〕者須為な形", () => {
    expect(
      ids(
        "adjective-shape",
        withVocab(
          {
            pos: "い形",
            kana: "おおきい",
            ruby: [seg("大", "おお"), seg("きい")],
          },
          {
            pos: "な形",
            kana: "すき［な］",
            ruby: [seg("好", "す"), seg("き［な］")],
          },
          {
            pos: "な形",
            kana: "げんき",
            ruby: [seg("元気", "げんき"), seg("〔な〕")],
          },
        ),
      ),
    ).toEqual([]);
    expect(
      ids(
        "adjective-shape",
        withVocab(
          { pos: "い形", kana: "しずか", ruby: [seg("静", "しず"), seg("か")] },
          { pos: "名", kana: "すき", ruby: [seg("好", "す"), seg("き［な］")] },
        ),
      ),
    ).toEqual(["L01-V001", "L01-V002"]);
  });

  it("dialogue-speaker:每行 speaker 非空且不是標題標記", () => {
    expect(
      ids(
        "dialogue-speaker",
        withDialogues({ speaker: "ミラー" }, { speaker: "山田一郎" }),
      ),
    ).toEqual([]);
    expect(
      ids(
        "dialogue-speaker",
        withDialogues(
          { speaker: undefined },
          { speaker: "" },
          { speaker: " " },
          { speaker: "（標題）" },
          { speaker: "標題" },
        ),
      ),
    ).toEqual(["L01-D01", "L01-D02", "L01-D03", "L01-D04", "L01-D05"]);
  });
});

describe("error:zh-glyph 與 Big5", () => {
  it("Big5 字集:含正體字,不含 Big5 以外的日文字形", () => {
    expect(big5.size).toBeGreaterThan(13000);
    for (const c of "證邊為真並台一") expect(big5.has(c)).toBe(true);
    for (const c of "辺会来帰辞峯") expect(big5.has(c)).toBe(false);
    // 黑名單的字都在 Big5 內:只靠 Big5 檢查抓不到,才需要黑名單
    expect([...JA_GLYPH_BLACKLIST].filter((c) => !big5.has(c))).toEqual([]);
  });

  it("Big5 字集只列舉標準範圍,排除 HKSCS(WHATWG decoder 會解出香港字)", () => {
    const requested: number[] = [];
    // 模擬「每個位元組對都解得出漢字」的 decoder:只有被請求解碼的碼位會進字集
    const set = big5Charset(() => ({
      decode: (bytes: Uint8Array) => {
        const code = (bytes[0] << 8) | bytes[1];
        requested.push(code);
        return String.fromCodePoint(0x20000 + code);
      },
    }));
    const has = (code: number) => set.has(String.fromCodePoint(0x20000 + code));
    for (const code of [
      0xa140, 0xa3bf, 0xa440, 0xc67e, 0xc940, 0xf9d5, 0xf9fe,
    ]) {
      expect(has(code)).toBe(true);
    }
    // HKSCS 0x8740–0xA0FE、0xC6A1–0xC8FE、0xFA40–0xFEFE;保留區 0xA3C0–0xA3FE
    for (const code of [
      0x8840, 0x9def, 0xa0fe, 0xa3c0, 0xc6a1, 0xc8fe, 0xfa40, 0xfefe,
    ]) {
      expect(has(code)).toBe(false);
    }
    expect(
      requested.filter(
        (c) =>
          !(
            (c >= 0xa140 && c <= 0xa3bf) ||
            (c >= 0xa440 && c <= 0xc67e) ||
            (c >= 0xc940 && c <= 0xf9fe)
          ),
      ),
    ).toEqual([]);
  });

  it("無 big5 decoder(Node 缺完整 ICU)時明確丟錯", () => {
    expect(() =>
      big5Charset(() => {
        throw new RangeError('The "big5" encoding is not supported');
      }),
    ).toThrow(/ICU/);
    expect(() => big5Charset(() => ({ decode: () => "\uFFFD" }))).toThrow(
      /decoder 異常/,
    );
  });

  it("stripQuotedJapanese:剝除「」『』〔〕與含假名的漢字假名串", () => {
    expect(
      stripQuotedJapanese("「来ます」的「来」、帰ります,〔辞書形〕與『会』。"),
    ).toBe("的、,與。");
    // 整串含假名的漢字假名串都剝除;不含假名的漢字串保留(其中的日文字形照樣檢查)
    expect(stripQuotedJapanese("見面用会います,開会則否")).toBe(",開会則否");
  });

  it("zh-glyph:剝除引用的日文後 会/来/帰/辞 不誤報", () => {
    expect(
      ids(
        "zh-glyph",
        withGrammar({
          explanation:
            "「来ます」的「来」表示方向;帰ります、会います同樣;〔動詞辞書形〕+ こと。",
        }),
        withVocab({ meaning: "證明" }, { meaning: "「会」的意思" }),
        withExamples({ translation: "我在「会社」工作。" }),
      ),
    ).toEqual([]);
  });

  it("zh-glyph:日文字形黑名單與 Big5 以外的漢字;meaning/translation 只剝「」", () => {
    expect(
      messages(
        "zh-glyph",
        withVocab({ meaning: "簽証" }),
        withExamples({ translation: "渡辺先生來了。" }),
        withGrammar({ explanation: "作為証明;開会時" }),
        withDialogues({ translation: "是渡辺さん。" }),
      ),
    ).toEqual([
      "L01-V001 meaning:証",
      "L01-S01 translation:辺",
      "L01-G01 explanation:証会",
      "L01-D01 translation:辺",
    ]);
  });
});

describe("warning", () => {
  it("kana-symbols:kana 含假名以外的記號", () => {
    expect(
      ids("kana-symbols", withVocab({ kana: "コーヒー" }, { kana: "ほん" })),
    ).toEqual([]);
    expect(
      ids(
        "kana-symbols",
        withVocab(
          { kana: "すき［な］" },
          { kana: "スパイス・コーナー" },
          { kana: "おっと／しゅじん" },
        ),
      ),
    ).toEqual(["L01-V001", "L01-V002", "L01-V003"]);
  });

  it("kana-vs-ruby:正規化(空白、標點、［な］、片→平、／、（）)後比對", () => {
    expect(
      ids(
        "kana-vs-ruby",
        withVocab(
          { kana: "ちがいます", ruby: [seg("違", "ちが"), seg("います。")] },
          { kana: "すき［な］", ruby: [seg("好", "す"), seg("き［な］")] },
          { kana: "てれび", ruby: [seg("テレビ")] },
          {
            kana: "おっと／しゅじん",
            ruby: [seg("夫", "おっと"), seg("／"), seg("主人", "しゅじん")],
          },
          {
            kana: "トイレ",
            ruby: [
              seg("トイレ（お"),
              seg("手", "て"),
              seg("洗", "あら"),
              seg("い）"),
            ],
          },
          { kana: "しーでぃー", ruby: [seg("CD")] }, // 含英數字的讀音略過
        ),
      ),
    ).toEqual([]);
    expect(
      messages(
        "kana-vs-ruby",
        withVocab(
          { kana: "しごと", ruby: [seg("［お］"), seg("仕事", "しごと")] },
          { kana: "ほんや", ruby: [seg("本", "ほん")] },
        ),
      ),
    ).toEqual([
      "L01-V001 kana=しごと ruby=［お］しごと",
      "L01-V002 kana=ほんや ruby=ほん",
    ]);
  });

  it("ruby-r-scope:帶 r 的段只含漢字或數字", () => {
    expect(
      ids(
        "ruby-r-scope",
        withVocab(
          { ruby: [seg("違", "ちが"), seg("います。")] },
          { ruby: [seg("1,000", "せん")] },
        ),
      ),
    ).toEqual([]);
    expect(
      messages(
        "ruby-r-scope",
        withVocab(
          { ruby: [seg("違います。", "ちがいます")] },
          { ruby: [seg("〜語", "ご")] },
        ),
        withExamples({ ruby: [seg("…8", "やっ"), seg("つ")] }),
      ),
    ).toEqual([
      "L01-V001 「違います。」r=ちがいます",
      "L01-V002 「〜語」r=ご",
      "L01-S01 「…8」r=やっ",
    ]);
  });

  it("verb-not-masu:動詞 kana 不是ます形", () => {
    expect(
      ids(
        "verb-not-masu",
        withVocab(
          { pos: "動II", kana: "はなれます" },
          { pos: "名", kana: "はなれた" },
        ),
      ),
    ).toEqual([]);
    expect(
      ids("verb-not-masu", withVocab({ pos: "動II", kana: "はなれた" })),
    ).toEqual(["L01-V001"]);
  });

  it("na-adjective-marker:な形表面缺［な］/〔な〕", () => {
    const na = (b: string) => ({
      pos: "な形" as const,
      kana: "げんき",
      ruby: [seg(b)],
    });
    expect(
      ids(
        "na-adjective-marker",
        withVocab(na("げんき［な］"), na("げんき〔な〕")),
      ),
    ).toEqual([]);
    expect(ids("na-adjective-marker", withVocab(na("げんき")))).toEqual([
      "L01-V001",
    ]);
  });

  it("cross-lesson-duplicate:跨課「表面+讀音+釋義」相同,每組一筆", () => {
    const same = { ruby: [seg("空", "そら")], kana: "そら", meaning: "天空" };
    const other = lesson(2);
    other.vocab = [
      { ...other.vocab[0], ...same },
      { ...other.vocab[0], ...same, id: "L02-V002" },
    ];
    expect(messages("cross-lesson-duplicate", withVocab(same), other)).toEqual([
      "L01-V001 空:L01-V001 L02-V001 L02-V002",
    ]);
    // 同課重複、或釋義不同:不算
    const differ = lesson(2);
    differ.vocab = [{ ...differ.vocab[0], ...same, meaning: "天" }];
    expect(
      ids("cross-lesson-duplicate", withVocab(same, same), differ),
    ).toEqual([]);
  });

  it("pos-inconsistent:同「表面+讀音」詞性不一致", () => {
    const mata = { ruby: [seg("また")], kana: "また" };
    const l2 = lesson(2);
    l2.vocab = [{ ...l2.vocab[0], ...mata, pos: "接続" }];
    expect(
      messages("pos-inconsistent", withVocab({ ...mata, pos: "副" }), l2),
    ).toEqual(["L01-V001 また:L01-V001(副) L02-V001(接続)"]);
    l2.vocab[0].pos = "副";
    expect(
      ids("pos-inconsistent", withVocab({ ...mata, pos: "副" }), l2),
    ).toEqual([]);
  });

  it("sentence-id-order:S 依文件順序自 S01 連號", () => {
    const l = withGrammar(
      { examples: [{ ...lesson(1).grammar[0].examples[0], id: "L01-S01" }] },
      { examples: [{ ...lesson(1).grammar[0].examples[0], id: "L01-S02" }] },
    );
    expect(ids("sentence-id-order", l)).toEqual([]);
    expect(
      messages(
        "sentence-id-order",
        withExamples({ id: "L01-S00" }, { id: "L01-S01" }),
      ),
    ).toEqual(["L01 2 句不在原位:L01-S00,L01-S01"]);
    expect(
      ids(
        "sentence-id-order",
        withExamples({ id: "L01-S01" }, { id: "L01-S03" }, { id: "L01-S02" }),
      ),
    ).toEqual(["L01"]);
  });

  it("speaker-alias:同課一個 speaker 是另一個的前綴", () => {
    expect(
      ids(
        "speaker-alias",
        withDialogues(
          { speaker: "山田" },
          { speaker: "田中" },
          { speaker: "山田" },
        ),
      ),
    ).toEqual([]);
    expect(
      messages(
        "speaker-alias",
        withDialogues({ speaker: "山田一郎" }, { speaker: "山田" }),
      ),
    ).toEqual(["L01 山田 / 山田一郎"]);
  });

  it("zh-lookalike:～(U+FF5E)、U+2010–2015、中譯的日文中點・", () => {
    expect(
      ids(
        "zh-lookalike",
        withGrammar({ explanation: "「〜だ」改成「〜です」" }),
        withExamples({ translation: "漢斯·施密特" }),
      ),
    ).toEqual([]);
    expect(
      ids(
        "zh-lookalike",
        withGrammar({ explanation: "「～だ」" }),
        withExamples({ translation: "漢斯・施密特" }),
        withVocab({ meaning: "「ウチ\u2011ソト」" }),
      ),
    ).toEqual(["L01-G01", "L01-S01", "L01-V001"]);
  });
});

describe("lintContent:待修清單", () => {
  // L01-V001 動I「します」:verb-class-shape 命中
  const broken = () =>
    withVocab({ pos: "動I", kana: "します", ruby: [seg("します")] });

  it("命中待修清單者標為待修、不算失敗;未列入者照常失敗", () => {
    const pending = { "verb-class-shape": ["L01-V001"] };
    const result = lintContent(ctxOf([broken()]), { pending });
    const shape = result.rules.find((r) => r.rule.id === "verb-class-shape");
    expect(shape?.issues).toEqual([]);
    expect(shape?.pending.map((i) => i.id)).toEqual(["L01-V001"]);
    expect(result.stalePending).toEqual([]);
    expect(result.pendingCount).toBe(1);
    // 只有 1 課:lesson-set 失敗(未列入待修)
    expect(result.errorCount).toBe(1);
    expect(
      result.rules.filter((r) => r.issues.length > 0).map((r) => r.rule.id),
    ).toEqual(["lesson-set"]);
  });

  it("待修清單多一項(已修好、重複、warning 規則或不存在的規則)即失敗", () => {
    const result = lintContent(
      ctxOf([...fifty().slice(1), broken()].sort((a, b) => a.id - b.id)),
      {
        pending: {
          "verb-class-shape": ["L01-V001", "L01-V002", "L01-V001"],
          "kana-symbols": ["L01-V001"],
          "no-such-rule": ["L01-V001"],
        },
      },
    );
    expect(result.stalePending).toEqual([
      { rule: "verb-class-shape", id: "L01-V002", reason: "沒有命中(已修好)" },
      { rule: "verb-class-shape", id: "L01-V001", reason: "重複列出" },
      { rule: "kana-symbols", id: "L01-V001", reason: "不是 error 規則" },
      { rule: "no-such-rule", id: "L01-V001", reason: "沒有這條規則" },
    ]);
    expect(result.errorCount).toBe(4);
    expect(result.pendingCount).toBe(1);
  });

  it("PENDING_FIXES:只列 error 規則,11 個 id 不重複", () => {
    const errorRules = new Set(
      RULES.filter((r) => r.severity === "error").map((r) => r.id),
    );
    expect(
      Object.keys(PENDING_FIXES).filter((k) => !errorRules.has(k)),
    ).toEqual([]);
    const all = Object.values(PENDING_FIXES).flat();
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11);
  });
});

describe("formatReport", () => {
  const many = () =>
    withVocab(...Array.from({ length: 7 }, () => ({ kana: "すき［な］" })));

  it("每條規則「N 筆 — 說明」與前 5 筆、「…另 N 筆」;✗ error、⏳ 待修、⚠ warning,最後一行總結", () => {
    const l = many();
    l.dialogues[0].speaker = undefined;
    l.grammar[0].examples[0].ruby = [seg("本")];
    const rules = RULES.filter((r) =>
      ["ruby-han-has-r", "dialogue-speaker", "kana-symbols"].includes(r.id),
    );
    const result = lintContent(ctxOf([l]), {
      rules,
      pending: { "dialogue-speaker": ["L01-D01"] },
    });
    const lines = formatReport(result);
    expect(lines).toEqual([
      "✗ [ruby-han-has-r] 1 筆 — 含漢字的 ruby 段必有讀音 r(單字、例句、会話)",
      "    L01-S01 「本」 缺 r",
      "⏳ [dialogue-speaker] 待修 1 筆 — 会話每行 speaker 非空,且不是標題標記(含「標題」)",
      "    L01-D01 speaker=(無) はい。",
      "⚠ [kana-symbols] 7 筆 — kana 含假名以外的記號(［］／〜・、…;kana 契約待定)",
      "    L01-V001 すき［な］",
      "    L01-V002 すき［な］",
      "    L01-V003 すき［な］",
      "    L01-V004 すき［な］",
      "    L01-V005 すき［な］",
      "    …另 2 筆",
      "✗ content-lint:error 2 條 1 筆未通過(待修 1 筆);warning 1 條 7 筆(不影響結束碼)",
    ]);
  });

  it("all 與 rule 列出完整清單;rule 只印該規則;待修清單多餘項印為 ✗", () => {
    const rules = RULES.filter((r) =>
      ["kana-symbols", "zh-glyph"].includes(r.id),
    );
    const result = lintContent(ctxOf([many()]), {
      rules,
      pending: { "zh-glyph": ["L01-G01"] },
    });
    expect(
      formatReport(result, { all: true }).filter((s) => s.includes("すき")),
    ).toHaveLength(7);
    expect(formatReport(result, { rule: "zh-glyph" })).toEqual([
      "✗ [待修清單] 1 筆多餘 — 已修好、重複或不是 error 規則,須自 PENDING_FIXES 刪除",
      "    L01-G01 (zh-glyph)沒有命中(已修好)",
      "✗ content-lint:error 1 條 1 筆未通過(待修 0 筆);warning 1 條 7 筆(不影響結束碼)",
    ]);
  });

  it("rule 篩掉的 error 仍影響結束碼:提示其他規則的 error 筆數", () => {
    const l = many();
    l.grammar[0].examples[0].ruby = [seg("本")];
    const rules = RULES.filter((r) =>
      ["ruby-han-has-r", "kana-symbols"].includes(r.id),
    );
    const result = lintContent(ctxOf([l]), {
      rules,
      pending: { "ruby-han-has-r": ["L01-V001"] },
    });
    expect(result.errorCount).toBe(2);
    expect(
      formatReport(result, { rule: "kana-symbols" }).filter(
        (s) => !s.includes("すき"),
      ),
    ).toEqual([
      "⚠ [kana-symbols] 7 筆 — kana 含假名以外的記號(［］／〜・、…;kana 契約待定)",
      "(其他規則另有 2 筆 error 未列出;不加 --rule 執行查看)",
      "✗ content-lint:error 1 條 2 筆未通過(待修 0 筆);warning 1 條 7 筆(不影響結束碼)",
    ]);
    // 不篩選、或篩到有 error 的規則時不提示
    expect(formatReport(result).some((s) => s.startsWith("(其他"))).toBe(false);
    expect(
      formatReport(result, { rule: "ruby-han-has-r" }).some((s) =>
        s.startsWith("(其他"),
      ),
    ).toBe(false);
  });
});

describe("parseReportArgs", () => {
  it("--all、--rule <id>、--rule=<id>;略過 pnpm 轉傳的 --", () => {
    expect(parseReportArgs([])).toEqual({ all: false });
    expect(parseReportArgs(["--", "--all"])).toEqual({ all: true });
    expect(parseReportArgs(["--rule", "zh-glyph"])).toEqual({
      all: false,
      rule: "zh-glyph",
    });
    expect(parseReportArgs(["--rule=zh-glyph", "--all"])).toEqual({
      all: true,
      rule: "zh-glyph",
    });
  });

  it("未知規則、缺值與不認得的參數回傳錯誤(不默默印預設報告)", () => {
    for (const argv of [
      ["--rule"],
      ["--rule", "no-such-rule"],
      ["--rule="],
      ["--rul", "zh-glyph"],
      ["zh-glyph"],
    ]) {
      expect(parseReportArgs(argv)).toHaveProperty("error");
    }
  });
});

describe("punctuationSummary", () => {
  it("各中文欄位的半形:全形個數;逗號不計千分位,只列有半形的標點", () => {
    const l = withVocab({ meaning: "書,本(冊)" });
    l.grammar[0].explanation = "表示;斷定：例如 1,000。";
    l.grammar[0].examples[0].translation = "是書，1,000日圓,好嗎?";
    l.dialogues[0].translation = "是的！";
    expect(punctuationSummary([l])).toEqual([
      "meaning:逗號 1:0、括號 2:0",
      "explanation:分號 1:0",
      "translation:逗號 1:1、問號 1:0",
    ]);
  });
});
