/**
 * pnpm fix:content [--check]
 *
 * 宣告式、冪等的內容資料修正(稽核 2026-09 §D「資料修正清單・不需 PDF」)。public/data
 * 禁止手改;不需對照 PDF 的修正一律列在 `CORRECTIONS`,由本腳本寫回(DATA_MODEL §4-2 的
 * fixture)。每筆宣告現值 from 與修正值 to:現值為 to = 已套用、不動作;為 from = 套用;
 * 其他 = 報錯中止(資料已被改動,需人工判斷,不猜)。日文與 enum 欄位(pos、kana、
 * ruby.<i>.b)比對整值;中文欄位(meaning、explanation、translation)比對子字串——from 恰
 * 出現一次 = 套用,不含 from 且含 to = 已套用。中文(含会話標題的中譯)以 T12.6 標點正規化
 * 後的寫法宣告(fix-content.data.test.ts 把關):先跑 normalize:zh-punct 必比對得到。
 * 会話標題(kind "dialogueTitle",T12.4):会話第一行完全等於宣告的 D01 且尚無 dialogueTitle
 * = 套用——ruby 與 translation 移入 `Lesson.dialogueTitle`(置於 dialogues 前)、刪除該行、
 * 後續 D id 自 D01 遞補;dialogueTitle 等於預期、D 自 01 連號且会話不含該句 = 已套用。
 * ruby 分段(kind "rubySplit",T12.5):一段換成多段(furigana 不跨越記號與送り仮名),宣告時
 * 須串接的 b 不變、讀音只取假名後不變;第 i 段完全等於 from = 套用,自第 i 段起等於 to = 已套用。
 *
 * 寫法比照 enrich-accents.ts:純函式核心、直接執行才跑 main。課程檔排版不一,不得整檔
 * 重寫:以 scripts/lib/rawJson.ts 定位物件、只替換目標字串;套用後每筆須呈已套用(冪等);
 * 寫入前重新 parse,與「記憶體中套用修正的預期模型」核對值與 key 順序,並以 LessonSchema
 * 驗證(不得有被丟棄的 key)。全部課程核對通過才寫檔;--check 只列狀態,有待套用項 exit 1。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  LessonSchema,
  type Lesson,
  type RubySeg,
  type Sentence,
} from "../src/schemas/lesson";
import {
  findObjectById,
  replaceStringValue,
  type ObjectSpan,
} from "./lib/rawJson";

const LESSONS_DIR = "public/data/lessons";

// ---------- 宣告 ----------

/** 整值比對的欄位:日文與 enum */
type WholeField = "pos" | "kana" | `ruby.${number}.b`;
/** 子字串比對的欄位:中文 */
type SubstringField = "meaning" | "explanation" | "translation";

/** 單一字串欄位的修正 */
export interface FieldCorrection {
  kind: "field";
  lesson: number;
  /** VocabItem、GrammarPoint 或 Sentence(例句、会話)的 id */
  id: string;
  field: WholeField | SubstringField;
  from: string;
  to: string;
  /** 修正理由(commit 逐筆列出) */
  reason: string;
}

/**
 * 会話標題行(speaker 為標題標記或缺漏的第一行)移入 `Lesson.dialogueTitle`,後續 D id 遞補。
 * 同課 D 的欄位修正須排在其後,id 以遞補後為準(validateCorrections 檢查)。
 */
export interface DialogueTitleCorrection {
  kind: "dialogueTitle";
  lesson: number;
  /** 現值:会話第一行(D01)的完整內容,speaker 為「標題」「（標題）」或缺漏(不寫 key) */
  from: Sentence;
  /** 修正理由(commit 逐筆列出) */
  reason: string;
}

/**
 * ruby 分段:第 i 段(from)換成多段(to),讀音不變——furigana 只標在漢字/數字上,記號與
 * 送り仮名不併入帶 r 的段({違います。/ちがいます} → {違/ちが}{います。})。宣告檢查
 * (validateCorrections):to 至少兩段、串接的 b 等於 from.b、讀音只取假名後相同(有 r 取 r,
 * 否則取 b 中的假名),且各段合 content-lint 的 ruby 規則(含漢字者帶 r、帶 r 者只含漢字或數字)。
 * 分段使其後的段號位移:同一項目的 ruby 只能有這一筆修正(不與其他分段或 ruby.<i>.b 並用)。
 */
export interface RubySplitCorrection {
  kind: "rubySplit";
  lesson: number;
  /** VocabItem 或 Sentence(例句、会話)的 id */
  id: string;
  /** 被分段的是 ruby 第幾段(0 起算) */
  field: `ruby.${number}`;
  from: RubySeg;
  to: RubySeg[];
  /** 修正理由(commit 逐筆列出) */
  reason: string;
}

/** 修正種類 */
export type Correction =
  | FieldCorrection
  | DialogueTitleCorrection
  | RubySplitCorrection;

export const CORRECTIONS: readonly Correction[] = [
  // ---- T12.2:資料修正清單 2、3 + 偵察補列 1 筆 ----
  {
    kind: "field",
    lesson: 4,
    id: "L04-V050",
    field: "ruby.0.b",
    from: "え―と",
    to: "えーと",
    reason:
      "長音誤用 ―(U+2015 HORIZONTAL BAR),改為長音符ー(U+30FC);資料中其餘 L24、L29、L48 会話的えーと皆為長音符",
  },
  {
    kind: "field",
    lesson: 4,
    id: "L04-V050",
    field: "kana",
    from: "え―と",
    to: "えーと",
    reason: "同上(kana 與 ruby 一致)",
  },
  {
    kind: "field",
    lesson: 41,
    id: "L41-G04",
    field: "explanation",
    from: "証明",
    to: "證明",
    reason:
      "中文解說的日文字形「証」正規化為正體「證」(取自 PDF 中文版,原文可能即印如此)",
  },
  {
    kind: "field",
    lesson: 48,
    id: "L48-V011",
    field: "meaning",
    from: "簽証",
    to: "簽證",
    reason:
      "中文釋義的日文字形「証」正規化為正體「證」(取自 PDF 中文版,原文可能即印如此)",
  },
  {
    kind: "field",
    lesson: 43,
    id: "L43-D08",
    field: "translation",
    from: "渡辺",
    to: "渡邊",
    reason:
      "自譯中文的日文字形「辺」→「邊」(其餘 7 處中譯皆為渡邊;speaker 與日文 ruby 的渡辺不動)",
  },
  {
    kind: "field",
    lesson: 49,
    id: "L49-D02",
    field: "translation",
    from: "漢斯・施密特",
    to: "漢斯·施密特",
    reason:
      "自譯中文人名的日文中點・(U+30FB)→ ·(U+00B7),與 L01「邁克·米勒」一致",
  },
  // ---- T12.3:資料修正清單 1(動詞分類) ----
  {
    kind: "field",
    lesson: 7,
    id: "L07-V006",
    field: "pos",
    from: "動I",
    to: "動II",
    reason:
      "借ります(辞書形 借りる)為Ⅱ類;誤標為動I 會推導出「借らない」「借って」(形狀規則無法區分い段的動I/動II,只靠資料測試釘住)",
  },
  {
    kind: "field",
    lesson: 47,
    id: "L47-V004",
    field: "pos",
    from: "動I",
    to: "動III",
    reason:
      "〔音／声が〜〕します 即 する,為Ⅲ類(與 L06-V010 します 同一動詞);誤標為動I 會推導出「さない」「す」",
  },
  {
    kind: "field",
    lesson: 47,
    id: "L47-V005",
    field: "pos",
    from: "動I",
    to: "動III",
    reason: "〔味が〜〕します:同上",
  },
  {
    kind: "field",
    lesson: 47,
    id: "L47-V006",
    field: "pos",
    from: "動I",
    to: "動III",
    reason: "〔においが〜〕します:同上",
  },
  // ---- T12.4:資料修正清單 4(会話標題行) ----
  {
    kind: "dialogueTitle",
    lesson: 15,
    from: {
      id: "L15-D01",
      ruby: [{ b: "ご" }, { b: "家族", r: "かぞく" }, { b: "は?" }],
      translation: "您的家人呢？",
      speaker: "（標題）",
    },
    reason:
      "会話標題(speaker「（標題）」)不是台詞:移入 dialogueTitle,D02..D12 遞補為 D01..D11",
  },
  {
    kind: "dialogueTitle",
    lesson: 23,
    from: {
      id: "L23-D01",
      ruby: [{ b: "どうやって " }, { b: "行", r: "い" }, { b: "きますか" }],
      translation: "怎麼去呢",
    },
    reason:
      "会話標題(無 speaker)不是台詞:移入 dialogueTitle,D02..D12 遞補為 D01..D11",
  },
  {
    kind: "dialogueTitle",
    lesson: 24,
    from: {
      id: "L24-D01",
      ruby: [{ b: "手伝", r: "てつだ" }, { b: "って くれますか" }],
      translation: "可以幫我嗎",
      speaker: "標題",
    },
    reason:
      "会話標題(speaker「標題」)不是台詞:移入 dialogueTitle,D02..D12 遞補為 D01..D11",
  },
  {
    kind: "dialogueTitle",
    lesson: 41,
    from: {
      id: "L41-D01",
      ruby: [
        { b: "荷物", r: "にもつ" },
        { b: "を " },
        { b: "預", r: "あず" },
        { b: "かって いただけませんか" },
      ],
      translation: "能不能請您幫我保管行李呢",
    },
    reason:
      "会話標題(無 speaker)不是台詞:移入 dialogueTitle,D02..D13 遞補為 D01..D12",
  },
  // ---- T12.5:PDF 校讀清單第 4 項(furigana 跨越記號;content-lint ruby-r-scope 的 9 段) ----
  {
    kind: "rubySplit",
    lesson: 2,
    id: "L02-V036",
    field: "ruby.0",
    from: { b: "〜語", r: "ご" },
    to: [{ b: "〜" }, { b: "語", r: "ご" }],
    reason:
      "furigana 跨越接尾記號〜:〜 獨立成段(無讀音),ご 只標在「語」上(同 L01-V009 〜人 的分段)",
  },
  {
    kind: "rubySplit",
    lesson: 2,
    id: "L02-V039",
    field: "ruby.0",
    from: { b: "違います。", r: "ちがいます" },
    to: [{ b: "違", r: "ちが" }, { b: "います。" }],
    reason:
      "furigana 蓋住送り仮名與句號(全部單字中唯一):ちが 只標在「違」上,います。獨立成段",
  },
  {
    kind: "rubySplit",
    lesson: 11,
    id: "L11-S05",
    field: "ruby.0",
    from: { b: "…8", r: "やっ" },
    to: [{ b: "…" }, { b: "8", r: "やっ" }],
    reason:
      "furigana 跨越答句開頭的「…」:… 獨立成段(無讀音),讀音只標在數字上(同 L01-V023 …歳 的分段)",
  },
  {
    kind: "rubySplit",
    lesson: 11,
    id: "L11-S07",
    field: "ruby.0",
    from: { b: "…5", r: "ご" },
    to: [{ b: "…" }, { b: "5", r: "ご" }],
    reason: "同上",
  },
  {
    kind: "rubySplit",
    lesson: 11,
    id: "L11-S09",
    field: "ruby.0",
    from: { b: "…2", r: "に" },
    to: [{ b: "…" }, { b: "2", r: "に" }],
    reason: "同上",
  },
  {
    kind: "rubySplit",
    lesson: 11,
    id: "L11-S11",
    field: "ruby.0",
    from: { b: "…3", r: "さん" },
    to: [{ b: "…" }, { b: "3", r: "さん" }],
    reason: "同上",
  },
  {
    kind: "rubySplit",
    lesson: 21,
    id: "L21-S12",
    field: "ruby.1",
    from: { b: "「来週", r: "らいしゅう" },
    to: [{ b: "「" }, { b: "来週", r: "らいしゅう" }],
    reason:
      "furigana 跨越引號「:「 獨立成段(無讀音),らいしゅう 只標在「来週」上(同 L37-S10「源氏物語」的分段)",
  },
  {
    kind: "rubySplit",
    lesson: 23,
    id: "L23-V013",
    field: "ruby.0",
    from: { b: "〜屋", r: "や" },
    to: [{ b: "〜" }, { b: "屋", r: "や" }],
    reason:
      "furigana 跨越接尾記號〜:〜 獨立成段(無讀音),や 只標在「屋」上(同 L10-V027 〜屋)",
  },
  {
    kind: "rubySplit",
    lesson: 37,
    id: "L37-V030",
    field: "ruby.0",
    from: { b: "〜中", r: "じゅう" },
    to: [{ b: "〜" }, { b: "中", r: "じゅう" }],
    reason:
      "furigana 跨越接尾記號〜:〜 獨立成段(無讀音),じゅう 只標在「中」上(同 L33-V028 〜中(ちゅう)的分段)",
  },
];

// ---------- 宣告檢查 ----------

const SUBSTRING_FIELDS: ReadonlySet<string> = new Set<SubstringField>([
  "meaning",
  "explanation",
  "translation",
]);
const isSubstring = (c: FieldCorrection) => SUBSTRING_FIELDS.has(c.field);

const RUBY_B_RE = /^ruby\.(0|[1-9]\d*)\.b$/;
/** ruby 分段修正的欄位:ruby.<i> */
const RUBY_SEG_RE = /^ruby\.(0|[1-9]\d*)$/;
const HAN_RE = /\p{Script=Han}/u;
/** 帶 r 的段不得含漢字、數字以外的字(同 content-lint ruby-r-scope) */
const OUT_OF_R_SCOPE_RE = /[^\p{Script=Han}々〆ヶ0-9０-９,]/u;
const ID_RE = /^L(\d{2})-([VGSD])\d+$/;
const TITLE_ID_RE = /^L(\d{2})-D01$/;
/** 教材資料中会話標題行的 speaker 寫法(另有缺漏者) */
const TITLE_SPEAKERS: ReadonlySet<string> = new Set(["標題", "（標題）"]);

/** 各種 id 可修正的欄位(ruby 以 ruby.<i>.b 或分段的 ruby.<i> 表示) */
const FIELDS_BY_KIND: Record<string, readonly string[]> = {
  V: ["pos", "kana", "meaning", "ruby"],
  G: ["explanation"],
  S: ["translation", "ruby"],
  D: ["translation", "ruby"],
};

const surfaceOf = (ruby: readonly RubySeg[]) => ruby.map((s) => s.b).join("");
/** 讀音只取假名:有 r 取 r,否則取 b 中的假名(記號、句讀、空白不計) */
const kanaReadingOf = (ruby: readonly RubySeg[]) =>
  ruby.map((s) => s.r ?? s.b.replace(/[^ぁ-ゖァ-ヺー]/g, "")).join("");
/** ruby 段的標示:{b} 或 {b/r} */
const segsLabel = (ruby: readonly RubySeg[]) =>
  ruby
    .map((s) => (s.r === undefined ? `{${s.b}}` : `{${s.b}/${s.r}}`))
    .join("");
const pad2 = (n: number) => String(n).padStart(2, "0");

export function labelOf(c: Correction): string {
  switch (c.kind) {
    case "field":
      return `${c.id} ${c.field}「${c.from}」→「${c.to}」`;
    case "dialogueTitle":
      // 套用後 D id 遞補,原 id 已指向另一行:以課號標示,原 id 只作註記
      return `L${pad2(c.lesson)} 会話標題「${surfaceOf(c.from.ruby)}」(原 ${c.from.id})→ dialogueTitle`;
    case "rubySplit":
      return `${c.id} ${c.field} ${segsLabel([c.from])} → ${segsLabel(c.to)}`;
    default:
      return unknownKind(c);
  }
}

/** 一筆宣告的錯誤;key 用於偵測重複宣告 */
interface Declaration {
  where: string;
  key: string;
  errors: string[];
}

function fieldDeclaration(c: FieldCorrection): Declaration {
  const errors: string[] = [];
  const where = `${c.id} ${c.field}`;
  const m = ID_RE.exec(c.id);
  if (!m) {
    errors.push(`${where}:id 格式不符`);
  } else {
    if (Number(m[1]) !== c.lesson) {
      errors.push(`${where}:id 課號 ≠ lesson ${c.lesson}`);
    }
    const field = RUBY_B_RE.test(c.field) ? "ruby" : c.field;
    if (!FIELDS_BY_KIND[m[2]].includes(field)) {
      errors.push(`${where}:${m[2]} 沒有可修正的欄位 ${c.field}`);
    }
  }
  if (c.from === "" || c.to === "") errors.push(`${where}:from/to 不得為空`);
  if (c.from === c.to) errors.push(`${where}:from 與 to 相同`);
  if (isSubstring(c) && c.from !== "" && c.to.includes(c.from)) {
    errors.push(`${where}:子字串修正的 to 含 from,重跑不冪等`);
  }
  if (c.reason.trim() === "") errors.push(`${where}:缺 reason`);
  const key = isSubstring(c) ? `${where}「${c.from}」` : where;
  return { where, key, errors };
}

function titleDeclaration(c: DialogueTitleCorrection): Declaration {
  const errors: string[] = [];
  const where = `${c.from.id} 会話標題`;
  const m = TITLE_ID_RE.exec(c.from.id);
  if (!m) {
    errors.push(`${where}:標題須為会話第一行 D01`);
  } else if (Number(m[1]) !== c.lesson) {
    errors.push(`${where}:id 課號 ≠ lesson ${c.lesson}`);
  }
  if (c.from.ruby.length === 0 || c.from.translation === "") {
    errors.push(`${where}:ruby/translation 不得為空`);
  }
  if ("speaker" in c.from && !TITLE_SPEAKERS.has(c.from.speaker ?? "")) {
    errors.push(
      `${where}:speaker ${JSON.stringify(c.from.speaker)} 不是標題標記(應為「標題」「（標題）」或不寫 key)`,
    );
  }
  if (c.reason.trim() === "") errors.push(`${where}:缺 reason`);
  // 每課只有一段会話,至多一筆
  return { where, key: `L${c.lesson} dialogueTitle`, errors };
}

function rubySplitDeclaration(c: RubySplitCorrection): Declaration {
  const errors: string[] = [];
  const where = `${c.id} ${c.field}`;
  const m = ID_RE.exec(c.id);
  if (!m) {
    errors.push(`${where}:id 格式不符`);
  } else {
    if (Number(m[1]) !== c.lesson) {
      errors.push(`${where}:id 課號 ≠ lesson ${c.lesson}`);
    }
    if (!FIELDS_BY_KIND[m[2]].includes("ruby")) {
      errors.push(`${where}:${m[2]} 沒有 ruby`);
    }
  }
  if (!RUBY_SEG_RE.test(c.field)) errors.push(`${where}:欄位應為 ruby.<i>`);
  if (c.to.length < 2) errors.push(`${where}:to 至少兩段`);
  if ([c.from, ...c.to].some((s) => s.b === "" || s.r === "")) {
    errors.push(`${where}:段的 b、r 不得為空`);
  }
  const surface = surfaceOf(c.to);
  if (surface !== c.from.b) {
    errors.push(`${where}:to 串接的 b「${surface}」≠ from「${c.from.b}」`);
  }
  const reading = kanaReadingOf(c.to);
  const fromReading = kanaReadingOf([c.from]);
  if (reading !== fromReading) {
    errors.push(
      `${where}:to 的讀音(只取假名)「${reading}」≠ from「${fromReading}」`,
    );
  }
  // 分段結果須合 content-lint 的 ruby-han-has-r、ruby-r-scope(error):寫入前擋下,不留給
  // verify(空的 r 已報「不得為空」,不重複報)
  for (const s of c.to) {
    if (s.r === undefined && HAN_RE.test(s.b)) {
      errors.push(`${where}:to 的「${s.b}」含漢字卻沒有 r`);
    } else if (s.r && OUT_OF_R_SCOPE_RE.test(s.b)) {
      errors.push(
        `${where}:to 的「${s.b}」帶 r 卻含漢字、數字以外的字(furigana 不跨越記號與送り仮名)`,
      );
    }
  }
  if (c.reason.trim() === "") errors.push(`${where}:缺 reason`);
  return { where, key: where, errors };
}

/** 改動 ruby 的修正所指的項目 id(会話標題不算:它不改段,只整行移走) */
const rubyTargetOf = (c: Correction): string | null =>
  (c.kind === "field" && RUBY_B_RE.test(c.field)) || c.kind === "rubySplit"
    ? c.id
    : null;

/**
 * CORRECTIONS 的宣告錯誤(課號與 id、欄位與 id 種類、from/to、重複、先後);空陣列 = 合法。
 * 同一欄位:整值只能宣告一筆;子字串可有多筆(from 不同),彼此干擾由 fixLesson 套用後的
 * 冪等核對攔下。会話標題修正會遞補同課的 D id,該課 D 的欄位與分段修正須排在其後(id 以遞補後
 * 為準)。ruby 分段使其後的段號位移:有分段的項目,ruby 不得再有其他修正(分段或 ruby.<i>.b)。
 */
export function validateCorrections(cs: readonly Correction[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  cs.forEach((c, i) => {
    let decl: Declaration;
    switch (c.kind) {
      case "field":
        decl = fieldDeclaration(c);
        break;
      case "dialogueTitle":
        decl = titleDeclaration(c);
        break;
      case "rubySplit":
        decl = rubySplitDeclaration(c);
        break;
      default:
        return unknownKind(c);
    }
    errors.push(...decl.errors);
    if (seen.has(decl.key)) errors.push(`${decl.where}:重複宣告`);
    seen.add(decl.key);
    // 同一段的重複分段已報「重複宣告」
    if (
      c.kind === "rubySplit" &&
      cs.some(
        (t, k) =>
          k !== i &&
          rubyTargetOf(t) === c.id &&
          !(t.kind === "rubySplit" && t.field === c.field),
      )
    ) {
      errors.push(
        `${decl.where}:同一項目的 ruby 另有修正(分段使其後的段號位移,有分段的項目 ruby 只能有這一筆修正)`,
      );
    }
    if (
      c.kind !== "dialogueTitle" &&
      ID_RE.exec(c.id)?.[2] === "D" &&
      cs
        .slice(i + 1)
        .some((t) => t.kind === "dialogueTitle" && t.lesson === c.lesson)
    ) {
      errors.push(
        `${decl.where}:排在同課的会話標題修正之前(標題修正會遞補 D id,D 的欄位修正須排在其後、id 以遞補後為準)`,
      );
    }
  });
  return errors;
}

// ---------- 模型(語意) ----------

type Target = Record<string, unknown>;

function findTarget(lesson: Lesson, id: string): Target {
  const all: { id: string }[] = [
    ...lesson.vocab,
    ...lesson.grammar,
    ...lesson.grammar.flatMap((g) => g.examples),
    ...lesson.dialogues,
  ];
  const hits = all.filter((o) => o.id === id);
  if (hits.length !== 1) {
    throw new Error(`${id}:課程中有 ${hits.length} 個物件(應恰為 1)`);
  }
  return hits[0] as Target;
}

function readField(t: Target, field: string): unknown {
  const m = RUBY_B_RE.exec(field);
  if (!m) return t[field];
  const ruby = t.ruby as RubySeg[] | undefined;
  return ruby?.[Number(m[1])]?.b;
}

function writeField(t: Target, field: string, value: string): void {
  const m = RUBY_B_RE.exec(field);
  if (m) (t.ruby as RubySeg[])[Number(m[1])].b = value;
  else t[field] = value;
}

/** 欄位現值(不存在或不是字串即丟錯) */
function currentValue(lesson: Lesson, c: FieldCorrection): string {
  const value = readField(findTarget(lesson, c.id), c.field);
  if (typeof value !== "string") {
    throw new Error(`${c.id} ${c.field}:欄位不存在`);
  }
  return value;
}

const occurrences = (text: string, sub: string) => text.split(sub).length - 1;

/** pending = 待套用;applied = 已套用 */
export type Status = "pending" | "applied";

/** 整值:現值 = to 已套用、= from 待套用;子字串:from 恰一處待套用、不含 from 且含 to 已套用 */
function fieldStatus(lesson: Lesson, c: FieldCorrection): Status {
  const cur = currentValue(lesson, c);
  const where = `${c.id} ${c.field}`;
  if (isSubstring(c)) {
    const n = occurrences(cur, c.from);
    if (n === 1) return "pending";
    if (n === 0 && cur.includes(c.to)) return "applied";
    throw new Error(
      `${where}:「${c.from}」出現 ${n} 次${n === 0 ? `且不含「${c.to}」` : ""}(應恰為 1),拒絕修改;現值 ${JSON.stringify(cur)}`,
    );
  }
  if (cur === c.to) return "applied";
  if (cur === c.from) return "pending";
  throw new Error(
    `${where}:現值 ${JSON.stringify(cur)} 既非 from ${JSON.stringify(c.from)} 也非 to,拒絕修改`,
  );
}

/** 修正後的欄位值(子字串只換那一處) */
const correctedValue = (cur: string, c: FieldCorrection) =>
  isSubstring(c) ? cur.replace(c.from, () => c.to) : c.to;

/** 第 n 行会話的 id(自 D01 連號) */
const dialogueId = (lesson: number, n: number) =>
  `L${pad2(lesson)}-D${pad2(n)}`;
/** 比對用:去掉值為 undefined 的 key(宣告與 JSON.parse 的結果一致) */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/**
 * 会話標題:無 dialogueTitle 且会話第一行完全等於 from = 待套用;dialogueTitle 等於
 * from 的 ruby 與 translation、D 自 01 連號、会話不含標題句 = 已套用;其他丟錯。
 */
function titleStatus(lesson: Lesson, c: DialogueTitleCorrection): Status {
  const first = lesson.dialogues[0];
  if (
    lesson.dialogueTitle === undefined &&
    first !== undefined &&
    isDeepStrictEqual(plain(first), plain(c.from))
  ) {
    return "pending";
  }
  const title = { ruby: c.from.ruby, translation: c.from.translation };
  const sameAsTitle = (d: Sentence) =>
    isDeepStrictEqual(plain(d.ruby), plain(c.from.ruby)) &&
    d.translation === c.from.translation;
  if (
    lesson.dialogueTitle !== undefined &&
    isDeepStrictEqual(plain(lesson.dialogueTitle), plain(title)) &&
    lesson.dialogues.every((d, i) => d.id === dialogueId(lesson.id, i + 1)) &&
    !lesson.dialogues.some(sameAsTitle)
  ) {
    return "applied";
  }
  throw new Error(
    `${labelOf(c)}:既非修正前(無 dialogueTitle、会話第一行完全等於 from)也非修正後(dialogueTitle 等於預期、D 自 01 連號、会話不含標題句),拒絕修改;dialogueTitle ${JSON.stringify(lesson.dialogueTitle)}、第一行 ${JSON.stringify(first)}`,
  );
}

/** 項目(單字、例句、会話)的 ruby */
function rubyOf(lesson: Lesson, id: string): RubySeg[] {
  const ruby = findTarget(lesson, id).ruby;
  if (!Array.isArray(ruby)) throw new Error(`${id}:沒有 ruby`);
  return ruby as RubySeg[];
}

const segIndexOf = (c: RubySplitCorrection) =>
  Number(c.field.slice("ruby.".length));
/** 與課程檔相同的 key 順序(b、r;無讀音者不寫 r) */
const normSeg = (s: RubySeg): RubySeg =>
  s.r === undefined ? { b: s.b } : { b: s.b, r: s.r };

/** ruby 分段:第 i 段完全等於 from = 待套用;自第 i 段起完全等於 to = 已套用;其他丟錯 */
function rubySplitStatus(lesson: Lesson, c: RubySplitCorrection): Status {
  const ruby = rubyOf(lesson, c.id);
  const i = segIndexOf(c);
  if (i < ruby.length && isDeepStrictEqual(plain(ruby[i]), plain(c.from))) {
    return "pending";
  }
  if (isDeepStrictEqual(plain(ruby.slice(i, i + c.to.length)), plain(c.to))) {
    return "applied";
  }
  throw new Error(
    `${labelOf(c)}:第 ${i} 段起既非 from 也非 to,拒絕修改;現值 ${segsLabel(ruby)}`,
  );
}

/** 新增修正種類時,各 switch 漏寫的 case 在這裡成為型別錯誤 */
function unknownKind(c: never): never {
  throw new Error(`未知的修正種類:${JSON.stringify(c)}`);
}

/** 一筆修正在課程上的狀態;現值既非修正前也非修正後即丟錯 */
export function statusOf(lesson: Lesson, c: Correction): Status {
  switch (c.kind) {
    case "field":
      return fieldStatus(lesson, c);
    case "dialogueTitle":
      return titleStatus(lesson, c);
    case "rubySplit":
      return rubySplitStatus(lesson, c);
    default:
      return unknownKind(c);
  }
}

/** 物件第一層各屬性的行範圍:屬性首行為「欄位縮排 + `"key": `」,延續到下一個屬性之前 */
function propertySpans(
  lines: readonly string[],
  span: ObjectSpan,
): { key: string; start: number; end: number }[] {
  const indent = `${/^ */.exec(lines[span.open])?.[0] ?? ""}  `;
  const props: { key: string; start: number; end: number }[] = [];
  for (let i = span.open + 1; i < span.close; i++) {
    const m = /^"([^"\\]*)": /.exec(
      lines[i].startsWith(indent) ? lines[i].slice(indent.length) : "",
    );
    if (m) props.push({ key: m[1], start: i, end: i });
    else if (props.length > 0) props[props.length - 1].end = i;
    else throw new Error(`第 ${i + 1} 行不是屬性開頭`);
  }
  return props;
}

/**
 * 原文:剪下会話第一行物件,其 ruby 與 translation 屬性(原樣、內縮 2 格、依原順序)組成
 * `"dialogueTitle": { … },` 插在 `"dialogues": [` 之前;其後各行的 id 依序改為 D01…。
 * `oldIds` 為其後各行原本的 id。前提不符(不是 dialogues 的第一個元素、只有這一行、
 * 缺屬性、縮排不符)即丟錯。
 */
function moveTitleLines(
  lines: string[],
  lesson: number,
  c: DialogueTitleCorrection,
  oldIds: readonly string[],
): void {
  const span = findObjectById(lines, c.from.id);
  const list = /^( *)"dialogues": \[$/.exec(lines[span.open - 1] ?? "");
  if (!list) throw new Error(`${c.from.id}:不是 dialogues 的第一個元素`);
  if (!lines[span.close].endsWith(",")) {
    throw new Error(`${c.from.id}:会話只有這一行,拒絕修改`);
  }
  const fieldIndent = `${/^ */.exec(lines[span.open])?.[0] ?? ""}  `;
  const titleIndent = `${list[1]}  `;
  const props = propertySpans(lines, span).filter(
    (p) => p.key === "ruby" || p.key === "translation",
  );
  if (props.length !== 2) {
    throw new Error(`${c.from.id}:找不到 ruby 與 translation 屬性`);
  }
  const body = props.flatMap((p, k) => {
    const out = lines.slice(p.start, p.end + 1).map((line) => {
      if (!line.startsWith(fieldIndent)) {
        throw new Error(`${c.from.id}:縮排不符「${line}」`);
      }
      return titleIndent + line.slice(fieldIndent.length);
    });
    // 屬性間的逗號:最後一個屬性不帶
    const last = out.length - 1;
    out[last] = out[last].replace(/,$/, "") + (k < props.length - 1 ? "," : "");
    return out;
  });
  lines.splice(span.open, span.close - span.open + 1);
  lines.splice(
    span.open - 1,
    0,
    `${list[1]}"dialogueTitle": {`,
    ...body,
    `${list[1]}},`,
  );
  // 依序遞補:前一行的舊 id 已讓出,不會與尚未改的 id 撞號(撞號時 findObjectById 丟錯)
  oldIds.forEach((oldId, i) => {
    const newId = dialogueId(lesson, i + 1);
    if (oldId !== newId) {
      replaceStringValue(
        lines,
        findObjectById(lines, oldId),
        "id",
        oldId,
        newId,
      );
    }
  });
}

/** ruby 段在課程檔中的寫法:`{ "b": …, "r": … }`(無讀音者不寫 r) */
const segToken = (s: RubySeg) =>
  `{ "b": ${JSON.stringify(s.b)}${s.r === undefined ? "" : `, "r": ${JSON.stringify(s.r)}`} }`;

/** ruby 屬性的原文行:單行 `"ruby": [{ … }, { … }]` 或逐段換行(每段一行、內縮 2 格) */
function rubyPropertyLines(
  indent: string,
  ruby: readonly RubySeg[],
  multiline: boolean,
  comma: string,
): string[] {
  const tokens = ruby.map(segToken);
  return multiline
    ? [
        `${indent}"ruby": [`,
        ...tokens.map(
          (t, k) => `${indent}  ${t}${k < tokens.length - 1 ? "," : ""}`,
        ),
        `${indent}]${comma}`,
      ]
    : [`${indent}"ruby": [${tokens.join(", ")}]${comma}`];
}

/**
 * 原文:物件 id 的 ruby 屬性由 before 改寫為 after,沿用原排版(單行或逐段換行,課程檔兩種
 * 並存)與其後的逗號。原文須與 before 依其中一種排版逐字相同,否則丟錯(不猜)。
 */
function rewriteRubyLines(
  lines: string[],
  id: string,
  before: readonly RubySeg[],
  after: readonly RubySeg[],
): void {
  const span = findObjectById(lines, id);
  const props = propertySpans(lines, span).filter((p) => p.key === "ruby");
  if (props.length !== 1) throw new Error(`${id}:找不到 ruby 屬性`);
  const { start, end } = props[0];
  const indent = `${/^ */.exec(lines[span.open])?.[0] ?? ""}  `;
  const actual = lines.slice(start, end + 1);
  const comma = actual[actual.length - 1].endsWith(",") ? "," : "";
  const multiline = [false, true].find((ml) =>
    isDeepStrictEqual(actual, rubyPropertyLines(indent, before, ml, comma)),
  );
  if (multiline === undefined) {
    throw new Error(
      `${id}:ruby 原文與資料不符,或排版既非單行也非逐段換行,拒絕修改`,
    );
  }
  lines.splice(
    start,
    end - start + 1,
    ...rubyPropertyLines(indent, after, multiline, comma),
  );
}

/** 模型:第一行的 ruby 與 translation(保留原 key 順序)成為 dialogueTitle,插在 dialogues 前;其後各行 id 遞補 */
function moveTitleModel(model: Lesson): void {
  const [first, ...rest] = model.dialogues;
  const title = Object.fromEntries(
    Object.entries(first).filter(([k]) => k === "ruby" || k === "translation"),
  );
  rest.forEach((d, i) => {
    d.id = dialogueId(model.id, i + 1);
  });
  const entries = Object.entries(model).flatMap(
    ([k, v]): [string, unknown][] =>
      k === "dialogues"
        ? [
            ["dialogueTitle", title],
            ["dialogues", rest],
          ]
        : [[k, v]],
  );
  const target = model as Record<string, unknown>;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, Object.fromEntries(entries));
}

/** 套用一筆待套用的修正:原文行(手術式)與記憶體模型同步修改 */
function applyCorrection(lines: string[], model: Lesson, c: Correction): void {
  switch (c.kind) {
    case "field": {
      const cur = currentValue(model, c);
      const next = correctedValue(cur, c);
      const key = RUBY_B_RE.test(c.field) ? "b" : c.field;
      replaceStringValue(lines, findObjectById(lines, c.id), key, cur, next);
      writeField(findTarget(model, c.id), c.field, next);
      return;
    }
    case "dialogueTitle": {
      const oldIds = model.dialogues.slice(1).map((d) => d.id);
      moveTitleLines(lines, model.id, c, oldIds);
      moveTitleModel(model);
      return;
    }
    case "rubySplit": {
      const ruby = rubyOf(model, c.id);
      const i = segIndexOf(c);
      const after = [
        ...ruby.slice(0, i),
        ...c.to.map(normSeg),
        ...ruby.slice(i + 1),
      ];
      rewriteRubyLines(lines, c.id, ruby, after);
      ruby.splice(0, ruby.length, ...after);
      return;
    }
    default:
      unknownKind(c);
  }
}

// ---------- 套用 ----------

/** 解析課程檔並以 LessonSchema 驗證;回傳 JSON.parse 的結果(保留原檔 key 順序) */
export function parseLesson(raw: string): Lesson {
  const json: unknown = JSON.parse(raw);
  LessonSchema.parse(json);
  return json as Lesson; // 型別由上一行的 parse 保證;不用 Zod 輸出,因其 key 依 schema 順序
}

export interface CorrectionResult {
  correction: Correction;
  /** 本次執行前的狀態 */
  status: Status;
}

export interface LessonFix {
  lesson: number;
  /** 套用後的全文;沒有待套用項時與原文逐位元相同 */
  text: string;
  results: CorrectionResult[];
}

/**
 * 寫入前核對:改好的原文重新 parse,須與預期模型的值與 key 順序完全相同、通過
 * LessonSchema,且沒有 LessonSchema 不認得、會被丟棄的 key(Zod 預設丟棄未知 key,
 * content.ts 以 safeParse 載入,被丟棄的資料在 App 裡默默消失)。不符即丟錯。
 */
export function verifyWritten(
  tag: string,
  text: string,
  expected: Lesson,
): void {
  const actual: unknown = JSON.parse(text);
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${tag}:寫入核對失敗(文字修改與預期模型不符)`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${tag}:寫入核對失敗(key 順序與預期模型不符)`);
  }
  const parsed = LessonSchema.safeParse(actual);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}:${i.message}`)
      .join("; ");
    throw new Error(`${tag}:寫入核對失敗(不符 LessonSchema:${issues})`);
  }
  if (!isDeepStrictEqual(parsed.data, actual)) {
    throw new Error(
      `${tag}:寫入核對失敗(有 LessonSchema 不認得、會被丟棄的 key)`,
    );
  }
}

/**
 * 對一課的原文套用修正(純函式,不寫檔)。依序判定狀態:待套用者同時改原文(手術式)與
 * 記憶體模型;全部套用後每筆須呈已套用(否則重跑會再改,不冪等),再以 verifyWritten
 * 核對改好的原文,否則丟錯。
 */
export function fixLesson(
  raw: string,
  corrections: readonly Correction[],
): LessonFix {
  const errors = validateCorrections(corrections);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const lesson = parseLesson(raw);
  const other = corrections.find((c) => c.lesson !== lesson.id);
  if (other) {
    throw new Error(`${labelOf(other)}:不屬於第 ${lesson.id} 課`);
  }

  const lines = raw.split("\n");
  const expected = structuredClone(lesson);
  const results = corrections.map((c): CorrectionResult => {
    const status = statusOf(expected, c);
    if (status === "pending") applyCorrection(lines, expected, c);
    return { correction: c, status };
  });
  // 套用後逐筆重判:自身重跑會再改(如 的的 → 的)或被其他修正改掉者,拒絕寫入
  for (const c of corrections) {
    let why = "仍為待套用";
    try {
      if (statusOf(expected, c) === "applied") continue;
    } catch (e: unknown) {
      why = e instanceof Error ? e.message : String(e);
    }
    throw new Error(
      `${labelOf(c)}:套用後未呈已套用,重跑不冪等或與其他修正互相干擾(${why})`,
    );
  }

  const text = lines.join("\n");
  verifyWritten(`L${String(lesson.id).padStart(2, "0")}`, text, expected);
  return { lesson: lesson.id, text, results };
}

// ---------- 報告 ----------

export interface FixArgs {
  check: boolean;
}

/** 參數:`--check`;pnpm 轉傳的 `--` 略過,其他參數回傳錯誤訊息 */
export function parseArgs(
  argv: readonly string[],
): FixArgs | { error: string } {
  const args: FixArgs = { check: false };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--check") args.check = true;
    else
      return {
        error: `不認得的參數「${arg}」;用法:pnpm fix:content [--check]`,
      };
  }
  return args;
}

/**
 * 輸出與結束碼。--check:逐筆列狀態(⏳ 待套用 / ✓ 已套用),有待套用項 exit 1;
 * 套用:列出本次套用的各筆與理由,exit 0。最後一行為總結。
 */
export function summarize(
  fixes: readonly LessonFix[],
  { check }: FixArgs,
): { lines: string[]; exitCode: 0 | 1 } {
  const results = fixes.flatMap((f) => f.results);
  const pending = results.filter((r) => r.status === "pending");
  const lines = check
    ? results.map(
        (r) =>
          `${r.status === "pending" ? "⏳ 待套用" : "✓ 已套用"} ${labelOf(r.correction)}`,
      )
    : pending.map(
        (r) => `✓ 套用 ${labelOf(r.correction)}:${r.correction.reason}`,
      );
  const total = results.length;
  if (pending.length === 0) {
    lines.push(`全部 ${total} 筆修正皆已套用,沒有變動`);
    return { lines, exitCode: 0 };
  }
  if (check) {
    lines.push(
      `待套用 ${pending.length}/${total} 筆;執行 pnpm fix:content 套用`,
    );
    return { lines, exitCode: 1 };
  }
  const files = fixes.filter((f) =>
    f.results.some((r) => r.status === "pending"),
  ).length;
  const rest = total - pending.length;
  lines.push(
    `套用 ${pending.length} 筆、寫入 ${files} 個檔${rest > 0 ? `;其餘 ${rest} 筆先前已套用` : ""}`,
  );
  return { lines, exitCode: 0 };
}

// ---------- 主流程 ----------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) throw new Error(args.error);
  const errors = validateCorrections(CORRECTIONS);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const lessons = [...new Set(CORRECTIONS.map((c) => c.lesson))].sort(
    (a, b) => a - b,
  );
  // 全部課程核對通過才寫檔,不留下只改一半的資料
  const fixes = lessons.map((n) => {
    const file = join(LESSONS_DIR, `L${String(n).padStart(2, "0")}.json`);
    const raw = readFileSync(file, "utf8");
    const fix = fixLesson(
      raw,
      CORRECTIONS.filter((c) => c.lesson === n),
    );
    return { file, raw, fix };
  });
  if (!args.check) {
    for (const { file, raw, fix } of fixes) {
      if (fix.text !== raw) writeFileSync(file, fix.text, "utf8");
    }
  }
  const { lines, exitCode } = summarize(
    fixes.map((f) => f.fix),
    args,
  );
  for (const line of lines) console.log(line);
  process.exitCode = exitCode;
}

// 直接執行才跑 main(測試 import 純函式時不觸發)
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
