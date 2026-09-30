/**
 * pnpm fix:content [--check]
 *
 * 宣告式、冪等的內容資料修正(稽核 2026-09 §D「資料修正清單・不需 PDF」)。public/data
 * 禁止手改;不需對照 PDF 的修正一律列在 `CORRECTIONS`,由本腳本寫回(DATA_MODEL §4-2 的
 * fixture)。每筆宣告現值 from 與修正值 to:現值為 to = 已套用、不動作;為 from = 套用;
 * 其他 = 報錯中止(資料已被改動,需人工判斷,不猜)。日文與 enum 欄位(pos、kana、
 * ruby.<i>.b)比對整值;中文欄位(meaning、explanation、translation)比對子字串——from 恰
 * 出現一次 = 套用,不含 from 且含 to = 已套用,故與 T12.6 標點正規化的先後互不影響。
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
import { LessonSchema, type Lesson, type RubySeg } from "../src/schemas/lesson";
import { findObjectById, replaceStringValue } from "./lib/rawJson";

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

/** 修正種類(T12.4 加会話標題、T12.5 加 ruby 分段) */
export type Correction = FieldCorrection;

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
];

// ---------- 宣告檢查 ----------

const SUBSTRING_FIELDS: ReadonlySet<string> = new Set<SubstringField>([
  "meaning",
  "explanation",
  "translation",
]);
const isSubstring = (c: FieldCorrection) => SUBSTRING_FIELDS.has(c.field);

const RUBY_B_RE = /^ruby\.(0|[1-9]\d*)\.b$/;
const ID_RE = /^L(\d{2})-([VGSD])\d+$/;

/** 各種 id 可修正的欄位(ruby 以 ruby.<i>.b 表示) */
const FIELDS_BY_KIND: Record<string, readonly string[]> = {
  V: ["pos", "kana", "meaning", "ruby"],
  G: ["explanation"],
  S: ["translation", "ruby"],
  D: ["translation", "ruby"],
};

export const labelOf = (c: Correction) =>
  `${c.id} ${c.field}「${c.from}」→「${c.to}」`;

/**
 * CORRECTIONS 的宣告錯誤(課號與 id、欄位與 id 種類、from/to、重複);空陣列 = 合法。
 * 同一欄位:整值只能宣告一筆;子字串可有多筆(from 不同),彼此干擾由 fixLesson 套用後的
 * 冪等核對攔下。
 */
export function validateCorrections(cs: readonly Correction[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const c of cs) {
    const where = `${c.id} ${c.field}`;
    const key = isSubstring(c) ? `${where}「${c.from}」` : where;
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
    if (seen.has(key)) errors.push(`${where}:重複宣告`);
    seen.add(key);
  }
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

/** 新增修正種類時,各 switch 漏寫的 case 在這裡成為型別錯誤 */
function unknownKind(kind: never): never {
  throw new Error(`未知的修正種類:${String(kind)}`);
}

/** 一筆修正在課程上的狀態;現值既非修正前也非修正後即丟錯 */
export function statusOf(lesson: Lesson, c: Correction): Status {
  switch (c.kind) {
    case "field":
      return fieldStatus(lesson, c);
    default:
      return unknownKind(c.kind);
  }
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
    default:
      unknownKind(c.kind);
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
    throw new Error(`${other.id}:不屬於第 ${lesson.id} 課`);
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
