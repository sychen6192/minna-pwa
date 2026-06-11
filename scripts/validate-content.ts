/**
 * pnpm validate:content
 * 掃描 public/data/** 全部 JSON,以 Zod schema(唯一真相)驗證。
 * 任一失敗即印出「檔案 + 欄位路徑 + 訊息」並以 exit code 1 結束。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodError } from "zod";
import { LessonIndexSchema, LessonSchema } from "../src/schemas/lesson";

const DATA_DIR = "public/data";
const LESSONS_DIR = join(DATA_DIR, "lessons");

function formatIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".") || "(root)";
    return `  ${path}: ${issue.message}`;
  });
}

type CheckResult = { file: string; errors: string[] };

/** 讀檔 + JSON.parse + Zod 驗證;回傳錯誤訊息陣列(空 = 通過) */
function validateFile(
  file: string,
  schema: typeof LessonIndexSchema | typeof LessonSchema,
): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [`  讀取失敗(檔案不存在或無法開啟)`];
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return [`  JSON 解析失敗:${(e as Error).message}`];
  }

  const result = schema.safeParse(data);
  return result.success ? [] : formatIssues(result.error);
}

/** 檢查課程檔名的課號與檔內 id 是否一致(資料契約不變式) */
function checkLessonIdMatchesFilename(file: string, name: string): string[] {
  const m = name.match(/^L(\d{2})\.json$/);
  if (!m) return [`  檔名不符 Lxx.json 規約`];
  const expected = Number(m[1]);
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown };
    if (data.id !== expected) {
      return [`  id 與檔名不符:檔名=${expected}, 資料 id=${String(data.id)}`];
    }
  } catch {
    // JSON 錯誤已在 validateFile 報過,這裡略過
  }
  return [];
}

function main(): void {
  const results: CheckResult[] = [];

  // 1. index.json
  const indexFile = join(DATA_DIR, "index.json");
  results.push({
    file: indexFile,
    errors: existsSync(indexFile)
      ? validateFile(indexFile, LessonIndexSchema)
      : [`  缺少 index.json`],
  });

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
      results.push({
        file,
        errors: [
          ...validateFile(file, LessonSchema),
          ...checkLessonIdMatchesFilename(file, name),
        ],
      });
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
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
