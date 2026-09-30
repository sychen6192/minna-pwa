/**
 * pnpm validate:content [--all] [--rule <id>]
 * 掃描 public/data/** 全部 JSON,以 Zod schema(唯一真相)驗證。
 * 任一失敗即印出「檔案 + 欄位路徑 + 訊息」並以 exit code 1 結束(略過 content-lint)。
 *
 * 全數通過後執行 content-lint(scripts/content-lint.ts):error 規則有命中即 exit 1(沒有例外清單);
 * warning(⚠)只列出、不影響結束碼。預設每條規則只印前 5 筆,
 * --all 印全部規則的完整清單、--rule <id> 只印該規則的完整清單(PDF 校讀用)。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ZodError, ZodType } from "zod";
import {
  LessonIndexSchema,
  LessonSchema,
  type Lesson,
  type LessonIndex,
} from "../src/schemas/lesson";
import {
  big5Charset,
  formatReport,
  lintContent,
  parseReportArgs,
  punctuationSummary,
} from "./content-lint";

const DATA_DIR = "public/data";
const LESSONS_DIR = join(DATA_DIR, "lessons");

function formatIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".") || "(root)";
    return `  ${path}: ${issue.message}`;
  });
}

type CheckResult = { file: string; errors: string[] };

/** 讀檔 + JSON.parse + Zod 驗證的結果:errors 空 = 通過(此時 data 為解析結果) */
interface Parsed<T> {
  errors: string[];
  /** JSON.parse 的結果(Zod 失敗時仍可用來檢查檔名) */
  json?: unknown;
  data?: T;
}

function validateFile<T>(file: string, schema: ZodType<T>): Parsed<T> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { errors: [`  讀取失敗(檔案不存在或無法開啟)`] };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { errors: [`  JSON 解析失敗:${(e as Error).message}`] };
  }

  const result = schema.safeParse(json);
  return result.success
    ? { errors: [], json, data: result.data }
    : { errors: formatIssues(result.error), json };
}

/** 檢查課程檔名的課號與檔內 id 是否一致(資料契約不變式) */
function checkLessonIdMatchesFilename(name: string, json: unknown): string[] {
  const m = name.match(/^L(\d{2})\.json$/);
  if (!m) return [`  檔名不符 Lxx.json 規約`];
  if (json === undefined) return []; // 讀取或 JSON 錯誤已在 validateFile 報過
  const expected = Number(m[1]);
  const id =
    typeof json === "object" && json !== null
      ? (json as { id?: unknown }).id
      : undefined;
  return id === expected
    ? []
    : [`  id 與檔名不符:檔名=${expected}, 資料 id=${String(id)}`];
}

function main(): void {
  const args = parseReportArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }

  const results: CheckResult[] = [];
  const lessons: Lesson[] = [];
  const lessonNames: string[] = [];

  // 1. index.json
  const indexFile = join(DATA_DIR, "index.json");
  const index: Parsed<LessonIndex> = existsSync(indexFile)
    ? validateFile(indexFile, LessonIndexSchema)
    : { errors: [`  缺少 index.json`] };
  results.push({ file: indexFile, errors: index.errors });

  // 2. lessons/*.json
  if (!existsSync(LESSONS_DIR)) {
    results.push({ file: LESSONS_DIR, errors: [`  缺少 lessons/ 目錄`] });
  } else {
    const lessonFiles = readdirSync(LESSONS_DIR)
      .filter((n) => n.endsWith(".json"))
      .sort();
    if (lessonFiles.length === 0) {
      results.push({ file: LESSONS_DIR, errors: [`  lessons/ 沒有任何 JSON`] });
    }
    for (const name of lessonFiles) {
      const file = join(LESSONS_DIR, name);
      const parsed = validateFile(file, LessonSchema);
      results.push({
        file,
        errors: [
          ...parsed.errors,
          ...checkLessonIdMatchesFilename(name, parsed.json),
        ],
      });
      if (parsed.data) {
        lessons.push(parsed.data);
        lessonNames.push(name);
      }
    }
  }

  // 輸出
  let failed = 0;
  for (const { file, errors } of results) {
    if (errors.length === 0) {
      console.log(`✓ ${file}`);
    } else {
      failed += 1;
      console.error(`✗ ${file}`);
      for (const line of errors) console.error(line);
    }
  }

  const total = results.length;
  console.log(`\n${total - failed}/${total} 檔通過驗證`);
  if (failed > 0 || !index.data) {
    console.error("略過 content-lint:先修正上列 Zod/檔名錯誤");
    process.exitCode = 1;
    return;
  }

  // 3. content-lint
  const lint = lintContent({
    lessons,
    files: lessonNames,
    index: index.data,
    big5: big5Charset(),
  });
  console.log("");
  for (const line of formatReport(lint, args)) console.log(line);
  if (args.rule === undefined) {
    console.log("\n中文欄位標點(半形:全形):");
    for (const line of punctuationSummary(lessons)) console.log(`  ${line}`);
  }
  if (lint.errorCount > 0) {
    process.exitCode = 1;
  }
}

// 直接執行才跑 main(測試只 import 純函式的 content-lint.ts,不 import 本檔)
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
