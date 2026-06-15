/**
 * pnpm build:index
 * 掃描 public/data/lessons/L01–L50.json,產生 public/data/index.json。
 * 缺漏的課以佔位資料補上(title「第 N 課」、計數 0),確保索引恆為 50 筆。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = "public/data";
const LESSONS_DIR = join(DATA_DIR, "lessons");

interface IndexEntry {
  id: number;
  title: string;
  vocabCount: number;
  grammarCount: number;
}

function lessonFile(id: number): string {
  return join(LESSONS_DIR, `L${String(id).padStart(2, "0")}.json`);
}

const lessons: IndexEntry[] = [];
let placeholders = 0;

for (let id = 1; id <= 50; id++) {
  const file = lessonFile(id);
  if (existsSync(file)) {
    const lesson = JSON.parse(readFileSync(file, "utf8")) as {
      title: string;
      vocab: unknown[];
      grammar: unknown[];
    };
    lessons.push({
      id,
      title: lesson.title,
      vocabCount: lesson.vocab.length,
      grammarCount: lesson.grammar.length,
    });
  } else {
    placeholders += 1;
    lessons.push({ id, title: `第 ${id} 課`, vocabCount: 0, grammarCount: 0 });
  }
}

writeFileSync(
  join(DATA_DIR, "index.json"),
  JSON.stringify({ lessons }, null, 2) + "\n",
);

console.log(
  `index.json 已產生:50 課(佔位 ${placeholders})、單字 ${lessons.reduce(
    (a, l) => a + l.vocabCount,
    0,
  )}、文法 ${lessons.reduce((a, l) => a + l.grammarCount, 0)}`,
);
