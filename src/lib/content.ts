import { z } from "zod";
import {
  LessonIndexSchema,
  LessonSchema,
  type Lesson,
  type LessonIndex,
} from "@/schemas/lesson";

// 記憶體快取:同一次 app 生命週期內每份資料只 fetch + parse 一次。
// 快取 Promise 以去重併發呼叫;失敗時清除,讓後續呼叫可重試。
let indexCache: Promise<LessonIndex> | undefined;
const lessonCache = new Map<number, Promise<Lesson>>();

function lessonPath(id: number): string {
  return `/data/lessons/L${String(id).padStart(2, "0")}.json`;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".") || "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`載入${label}失敗:HTTP ${res.status}(${url})`);
  }
  return res.json();
}

async function loadIndex(): Promise<LessonIndex> {
  const data = await fetchJson("/data/index.json", "課程索引");
  const result = LessonIndexSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`課程索引資料格式錯誤 → ${formatIssues(result.error)}`);
  }
  return result.data;
}

async function loadLesson(id: number): Promise<Lesson> {
  const data = await fetchJson(lessonPath(id), `第 ${id} 課`);
  const result = LessonSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`第 ${id} 課資料格式錯誤 → ${formatIssues(result.error)}`);
  }
  return result.data;
}

/** 載入課程索引(index.json),帶記憶體快取。 */
export function getLessonIndex(): Promise<LessonIndex> {
  if (!indexCache) {
    indexCache = loadIndex().catch((error) => {
      indexCache = undefined;
      throw error;
    });
  }
  return indexCache;
}

/** 載入單一課程(Lxx.json),帶記憶體快取。 */
export function getLesson(id: number): Promise<Lesson> {
  const cached = lessonCache.get(id);
  if (cached) return cached;

  const promise = loadLesson(id).catch((error) => {
    lessonCache.delete(id);
    throw error;
  });
  lessonCache.set(id, promise);
  return promise;
}

/** 清空記憶體快取(測試與開發期 HMR 用)。 */
export function clearContentCache(): void {
  indexCache = undefined;
  lessonCache.clear();
}
