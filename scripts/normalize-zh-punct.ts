/**
 * pnpm normalize:zh-punct [--check] [--list]
 *
 * 教材中文欄位的標點統一為全形(DQ-08、SPEC F1.6)。建置期規則式改寫、冪等:public/data
 * 禁止手改,中文標點一律經本腳本寫回(DATA_MODEL §4-2 的 fixture)。fix-content 的中文修正
 * 以正規化後的寫法宣告(fix-content.data.test.ts 把關):重新抽取後先跑本腳本再跑
 * fix-content(会話標題修正比對整句中譯)。不在顯示層轉換:畫面、搜尋、測驗與資料測試
 * 看到的是同一份文字。
 *
 * 欄位:vocab.meaning、vocab.note(段落標記 SECTION_MARKER_NOTES 除外,那是 isSupplementary
 * 等判斷用的常數、不當提示顯示)、grammar.explanation、例句與会話的 translation、
 * dialogueTitle.translation。pattern、title、speaker、ruby、kana 不動(日文)。
 *
 * 寫法比照 fix-content.ts:純函式核心、直接執行才跑 main;課程檔排版不一,不得整檔重寫——
 * 以 scripts/lib/rawJson.ts 定位物件、只替換目標字串值;寫入前重新 parse,與「記憶體中
 * 正規化的預期模型」核對值與 key 順序並以 LessonSchema 驗證(fix-content 的 verifyWritten),
 * 另核對行數不變;50 課全部核對通過才寫檔。先印摘要(各欄位筆數、各規則字數、保留的千分位
 * 與特例);--check 不寫檔,有待改項 exit 1;--list 另逐筆列出改動。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Lesson } from "../src/schemas/lesson";
import { parseLesson, verifyWritten } from "./fix-content";
import {
  findObjectById,
  objectSpanAt,
  replaceStringValue,
  type ObjectSpan,
} from "./lib/rawJson";
import {
  dialogueTitleId,
  isSectionMarker,
  normalizeZhPunct,
  ZH_GROUPS,
  zhValues,
  type ZhField,
  type ZhGroup,
  type ZhValue,
} from "./lib/zhPunct";

const LESSONS_DIR = "public/data/lessons";

// ---------- 套用 ----------

/** 模型中的目標物件(寫入預期值用) */
function targetOf(l: Lesson, id: string): Record<string, unknown> {
  if (id === dialogueTitleId(l.id)) {
    if (l.dialogueTitle === undefined) throw new Error(`${id}:沒有会話標題`);
    return l.dialogueTitle;
  }
  const all: { id: string }[] = [
    ...l.vocab,
    ...l.grammar,
    ...l.grammar.flatMap((g) => g.examples),
    ...l.dialogues,
  ];
  const hits = all.filter((o) => o.id === id);
  if (hits.length !== 1) {
    throw new Error(`${id}:課程中有 ${hits.length} 個物件(應恰為 1)`);
  }
  return hits[0] as Record<string, unknown>;
}

const DIALOGUE_TITLE_LINE_RE = /^\s*"dialogueTitle": \{$/;

/** 原文中值所在物件的行範圍:以 id 行定位;会話標題以唯一的 `"dialogueTitle": {` 行定位 */
function spanOf(
  lines: readonly string[],
  lesson: number,
  id: string,
): ObjectSpan {
  if (id !== dialogueTitleId(lesson)) return findObjectById(lines, id);
  const hits = lines.flatMap((line, i) =>
    DIALOGUE_TITLE_LINE_RE.test(line) ? [i] : [],
  );
  if (hits.length !== 1) {
    throw new Error(`${id}:dialogueTitle 行有 ${hits.length} 處(應恰為 1)`);
  }
  return objectSpanAt(lines, hits[0]);
}

/** 一個中文值與其正規化結果 */
export interface ZhResult extends ZhValue {
  /** 正規化後的值(value 為原值;未改動者兩者相同) */
  to: string;
}

export interface LessonNormalization {
  lesson: number;
  /** 全部中文值(段落標記 note 不在其中) */
  values: ZhResult[];
  /** 跳過的段落標記 note 筆數 */
  skippedMarkers: number;
  /** 正規化後的全文;沒有改動時與原文逐位元相同 */
  text: string;
}

export const changesOf = (n: LessonNormalization) =>
  n.values.filter((v) => v.to !== v.value);

const lessonTag = (id: number) => `L${String(id).padStart(2, "0")}`;

/**
 * 對一課的原文正規化中文標點(純函式,不寫檔)。改動的值以 rawJson 手術式替換(物件範圍內
 * 恰好一處 `"key": "原值"`),同時改記憶體模型;改好的原文須與模型的值與 key 順序完全相同、
 * 通過 LessonSchema(verifyWritten)、行數不變,否則丟錯。
 */
export function normalizeLesson(raw: string): LessonNormalization {
  const lesson = parseLesson(raw);
  const tag = lessonTag(lesson.id);
  const values = zhValues(lesson).map(
    (v): ZhResult => ({ ...v, to: normalizeZhPunct(v.value) }),
  );
  // 冪等:結果再正規化須不變(否則重跑會再改),拒絕寫入
  const unstable = values.find((v) => normalizeZhPunct(v.to) !== v.to);
  if (unstable) {
    throw new Error(
      `${unstable.id} ${unstable.field}:正規化不冪等,拒絕寫入;${JSON.stringify(unstable.to)}`,
    );
  }
  const lines = raw.split("\n");
  const expected = structuredClone(lesson);
  for (const v of values) {
    if (v.to === v.value) continue;
    replaceStringValue(
      lines,
      spanOf(lines, lesson.id, v.id),
      v.field,
      v.value,
      v.to,
    );
    targetOf(expected, v.id)[v.field] = v.to;
  }
  const text = lines.join("\n");
  verifyWritten(tag, text, expected);
  if (lines.length !== raw.split("\n").length) {
    throw new Error(`${tag}:寫入核對失敗(行數改變)`);
  }
  const skippedMarkers = lesson.vocab.filter(
    (v) => v.note !== undefined && isSectionMarker(v.note),
  ).length;
  return { lesson: lesson.id, values, skippedMarkers, text };
}

// ---------- 摘要 ----------

/** R1 保留的千分位逗號、R3 保留的時刻冒號(只比對標點本身) */
const PRESERVED: readonly [kind: string, re: RegExp][] = [
  ["千分位", /(?<=\d),(?=\d{3}(?!\d))/g],
  ["時刻", /(?<=\d):(?=\d)/g],
];

/** 摘要逐字計數的來源字元:R1–R5、R7、R8、R9 轉換的字與 R6 刪除的空白 */
const COUNTED: readonly [rule: string, chars: string][] = [
  ["R1", ","],
  ["R2", ";"],
  ["R3", ":"],
  ["R4", "?!"],
  ["R5", "()"],
  ["R6", " "],
  ["R7", "﹐﹑﹔﹕﹖﹗﹙﹚"],
  ["R8", '"'],
  ["R9", "～"],
];

const count = (text: string, ch: string) => text.split(ch).length - 1;
const around = (text: string, index: number) =>
  text.slice(Math.max(0, index - 6), index + 7);

export interface Summary {
  /** 各組:值的筆數與改動筆數 */
  groups: { group: ZhGroup; values: number; changed: number }[];
  /** 各來源字元被轉換(R6 為被刪除的空白)的個數;0 者不列 */
  chars: { rule: string; ch: string; n: number }[];
  /** 正規化後保留半形的千分位與時刻 */
  preserved: { kind: string; id: string; field: ZhField; context: string }[];
  /** 特例:ASCII 引號為奇數個、R8 未轉換的值 */
  oddQuotes: { id: string; field: ZhField }[];
  skippedMarkers: number;
  /** 值的總數、改動的值與檔案數 */
  total: number;
  changed: number;
  files: number;
}

export function summarize(results: readonly LessonNormalization[]): Summary {
  const values = results.flatMap((r) => r.values);
  const changes = values.filter((v) => v.to !== v.value);
  return {
    groups: ZH_GROUPS.map((group) => ({
      group,
      values: values.filter((v) => v.group === group).length,
      changed: changes.filter((v) => v.group === group).length,
    })),
    chars: COUNTED.flatMap(([rule, chars]) =>
      [...chars].map((ch) => ({
        rule,
        ch,
        n: changes.reduce(
          (n, v) => n + count(v.value, ch) - count(v.to, ch),
          0,
        ),
      })),
    ).filter((c) => c.n !== 0),
    preserved: values.flatMap((v) =>
      PRESERVED.flatMap(([kind, re]) =>
        [...v.to.matchAll(re)].map((m) => ({
          kind,
          id: v.id,
          field: v.field,
          context: around(v.to, m.index),
        })),
      ),
    ),
    oddQuotes: values
      .filter((v) => count(v.to, '"') % 2 === 1)
      .map((v) => ({ id: v.id, field: v.field })),
    skippedMarkers: results.reduce((n, r) => n + r.skippedMarkers, 0),
    total: values.length,
    changed: changes.length,
    files: results.filter((r) => changesOf(r).length > 0).length,
  };
}

const GROUP_LABEL: Record<ZhGroup, string> = {
  meaning: "單字釋義 meaning",
  note: "單字 note",
  explanation: "文法解說 explanation",
  examples: "例句中譯 translation",
  dialogues: "会話中譯 translation(含 dialogueTitle)",
};
const charLabel = (ch: string) =>
  ch === " "
    ? "空白"
    : `${ch}(U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")})`;

export interface NormalizeArgs {
  check: boolean;
  list: boolean;
}

/** 參數:`--check`、`--list`;pnpm 轉傳的 `--` 略過,其他參數回傳錯誤訊息 */
export function parseArgs(
  argv: readonly string[],
): NormalizeArgs | { error: string } {
  const args: NormalizeArgs = { check: false, list: false };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--check") args.check = true;
    else if (arg === "--list") args.list = true;
    else
      return {
        error: `不認得的參數「${arg}」;用法:pnpm normalize:zh-punct [--check] [--list]`,
      };
  }
  return args;
}

/**
 * 輸出與結束碼:摘要(各欄位筆數、各規則字數、保留的千分位與時刻、特例);--list 先逐筆列出
 * 改動。--check:有待改項 exit 1(不寫檔);寫入模式 exit 0。最後一行為總結。
 */
export function report(
  results: readonly LessonNormalization[],
  { check, list }: NormalizeArgs,
): { lines: string[]; exitCode: 0 | 1 } {
  const s = summarize(results);
  const lines: string[] = [];
  if (list) {
    for (const v of results.flatMap(changesOf)) {
      lines.push(`${v.id} ${v.field}:${v.value}`, `  → ${v.to}`);
    }
  }
  lines.push("各欄位(改動 / 筆數):");
  for (const g of s.groups) {
    lines.push(`  ${GROUP_LABEL[g.group]}:${g.changed} / ${g.values}`);
  }
  lines.push(`  段落標記 note(不正規化):${s.skippedMarkers} 筆`);
  if (s.chars.length > 0) {
    lines.push("各規則(改動字數;R6 為刪除的空白):");
    for (const c of s.chars)
      lines.push(`  ${c.rule} ${charLabel(c.ch)}:${c.n}`);
  }
  lines.push(`保留半形 ${s.preserved.length} 處:`);
  for (const p of s.preserved) {
    lines.push(`  ${p.kind} ${p.id} ${p.field}「…${p.context}…」`);
  }
  if (s.oddQuotes.length > 0) {
    lines.push(
      `ASCII 引號為奇數個、未轉換 ${s.oddQuotes.length} 筆:${s.oddQuotes.map((q) => `${q.id} ${q.field}`).join("、")}`,
    );
  }
  if (s.changed === 0) {
    lines.push(`中文值 ${s.total} 筆皆已正規化,沒有變動`);
    return { lines, exitCode: 0 };
  }
  if (check) {
    lines.push(
      `待正規化 ${s.changed}/${s.total} 筆(${s.files} 個檔);執行 pnpm normalize:zh-punct 寫入`,
    );
    return { lines, exitCode: 1 };
  }
  lines.push(`正規化 ${s.changed}/${s.total} 筆、寫入 ${s.files} 個檔`);
  return { lines, exitCode: 0 };
}

// ---------- 主流程 ----------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) throw new Error(args.error);
  const files = readdirSync(LESSONS_DIR)
    .filter((n) => /^L\d{2}\.json$/.test(n))
    .sort();
  // 全部課程核對通過才寫檔,不留下只改一半的資料
  const all = files.map((name) => {
    const file = join(LESSONS_DIR, name);
    const raw = readFileSync(file, "utf8");
    return { file, raw, result: normalizeLesson(raw) };
  });
  const { lines, exitCode } = report(
    all.map((a) => a.result),
    args,
  );
  for (const line of lines) console.log(line);
  if (!args.check) {
    for (const { file, raw, result } of all) {
      if (result.text !== raw) writeFileSync(file, result.text, "utf8");
    }
  }
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
